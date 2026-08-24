import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import type {
  VerificationExecution,
  VerificationExecutionInput,
  VerificationExecutionOutput,
  VerificationExecutionProfile,
  VerificationExecutionReceipt,
  VerificationSandbox,
} from "./index.js";

const MAX_OUTPUT_BYTES = 1024 * 1024;
const DIGEST_PINNED_IMAGE = /^.+@sha256:([0-9a-f]{64})$/;

export interface ProcessExecution {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  startedAt: string;
  completedAt: string;
}

export interface ProcessRunner {
  run(input: {
    executable: string;
    arguments: readonly string[];
    stdin: string;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<ProcessExecution>;
}

export class SandboxExecutionError extends Error {
  constructor(
    message: string,
    readonly receipt: VerificationExecutionReceipt,
  ) {
    super(message);
    this.name = "SandboxExecutionError";
  }
}

export function createProcessRunner(
  now: () => string = () => new Date().toISOString(),
): ProcessRunner {
  return {
    run(input) {
      return new Promise((resolve, reject) => {
        const startedAt = now();
        const child = spawn(input.executable, [...input.arguments], {
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
        let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
        let timedOut = false;
        let settled = false;

        const append = (
          current: Buffer<ArrayBufferLike>,
          chunk: Buffer<ArrayBufferLike>,
        ): Buffer<ArrayBufferLike> => {
          if (current.length + chunk.length > MAX_OUTPUT_BYTES) {
            child.kill("SIGKILL");
            return current;
          }
          return Buffer.concat([current, chunk]);
        };
        child.stdout.on("data", (chunk: Buffer) => {
          stdout = append(stdout, chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = append(stderr, chunk);
        });
        const abort = () => child.kill("SIGKILL");
        input.signal.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, input.timeoutMs);

        child.once("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          input.signal.removeEventListener("abort", abort);
          reject(error);
        });
        child.once("close", (exitCode) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          input.signal.removeEventListener("abort", abort);
          resolve({
            exitCode,
            stdout: stdout.toString("utf8"),
            stderr: stderr.toString("utf8"),
            timedOut: timedOut || input.signal.aborted,
            startedAt,
            completedAt: now(),
          });
        });
        child.stdin.end(input.stdin);
      });
    },
  };
}

function parseOutput(
  serialized: string,
  requiredChecks: readonly string[],
): VerificationExecutionOutput {
  const value = JSON.parse(serialized) as Partial<VerificationExecutionOutput>;
  if (
    (value.result !== "Passed" && value.result !== "Failed") ||
    typeof value.summary !== "string" ||
    !value.summary.trim() ||
    !Array.isArray(value.checks) ||
    value.checks.length !== requiredChecks.length
  ) {
    throw new Error("Sandbox output does not match the verification contract.");
  }
  for (const [index, check] of value.checks.entries()) {
    if (
      check?.sequence !== index + 1 ||
      check.name !== requiredChecks[index] ||
      !["Passed", "Failed", "Skipped"].includes(check.status) ||
      typeof check.message !== "string"
    ) {
      throw new Error(
        "Sandbox check output does not match the requested checks.",
      );
    }
  }
  const allPassed = value.checks.every((check) => check.status === "Passed");
  if ((value.result === "Passed") !== allPassed) {
    throw new Error("Sandbox result is inconsistent with its check outcomes.");
  }
  if (
    value.result === "Failed" &&
    !value.checks.some((check) => check.status === "Failed")
  ) {
    throw new Error("Failed sandbox output requires a concrete failed check.");
  }
  return value as VerificationExecutionOutput;
}

export function signExecutionReceipt(
  receipt: Omit<VerificationExecutionReceipt, "signature">,
  signingKey: string,
): string {
  return createHmac("sha256", signingKey)
    .update(JSON.stringify(receipt))
    .digest("hex");
}

export function verifyExecutionReceipt(
  receipt: VerificationExecutionReceipt,
  signingKey: string,
): boolean {
  if (!/^[0-9a-f]{64}$/.test(receipt.signature)) return false;
  const { signature, ...unsigned } = receipt;
  const expected = signExecutionReceipt(unsigned, signingKey);
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expected, "hex"),
  );
}

export class DockerVerificationSandbox implements VerificationSandbox {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly signingKey: string,
    private readonly dockerExecutable = "docker",
  ) {
    if (signingKey.length < 32) {
      throw new Error(
        "Worker receipt signing key must be at least 32 characters.",
      );
    }
  }

  async execute(
    profile: VerificationExecutionProfile,
    input: VerificationExecutionInput,
    workerId: string,
    signal: AbortSignal,
  ): Promise<VerificationExecution> {
    const imageMatch = DIGEST_PINNED_IMAGE.exec(profile.image);
    if (
      !imageMatch ||
      profile.network !== "none" ||
      profile.command.length === 0
    ) {
      throw new Error("Verification profile is not safely sandboxable.");
    }
    const containerName = `remedence-${input.jobId}-${input.attempt}`
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, "-")
      .slice(0, 120);
    const result = await this.runner.run({
      executable: this.dockerExecutable,
      arguments: [
        "run",
        "--rm",
        "--name",
        containerName,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "64",
        "--memory",
        `${profile.memoryMegabytes}m`,
        "--cpus",
        String(profile.cpuCount),
        "--stop-timeout",
        "1",
        "--env",
        `REMEDENCE_SOURCE_REVISION=${input.sourceRevision}`,
        "--env",
        `REMEDENCE_PATCH_DIGEST=${input.patchDigest}`,
        profile.image,
        ...profile.command,
      ],
      stdin: JSON.stringify({ required_checks: input.requiredChecks }),
      timeoutMs: profile.timeoutSeconds * 1000,
      signal,
    });
    if (result.timedOut) {
      try {
        await this.runner.run({
          executable: this.dockerExecutable,
          arguments: ["rm", "--force", containerName],
          stdin: "",
          timeoutMs: 5_000,
          signal: new AbortController().signal,
        });
      } catch {
        // The container may already have honored --rm; the signed timeout
        // receipt still records the failed attempt for operator review.
      }
    }
    const unsigned: Omit<VerificationExecutionReceipt, "signature"> = {
      jobId: input.jobId,
      attempt: input.attempt,
      workerId,
      profileId: profile.id,
      imageDigest: `sha256:${imageMatch[1]!}`,
      commandDigest: createHash("sha256")
        .update(JSON.stringify(profile.command))
        .digest("hex"),
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      outputHash: createHash("sha256").update(result.stdout).digest("hex"),
    };
    const receipt: VerificationExecutionReceipt = {
      ...unsigned,
      signature: signExecutionReceipt(unsigned, this.signingKey),
    };
    if (result.timedOut || result.exitCode !== 0) {
      throw new SandboxExecutionError(
        result.timedOut
          ? "Verification sandbox timed out."
          : `Verification sandbox exited with code ${String(result.exitCode)}.`,
        receipt,
      );
    }
    try {
      return {
        output: parseOutput(result.stdout, input.requiredChecks),
        receipt,
      };
    } catch (error) {
      throw new SandboxExecutionError(
        error instanceof Error ? error.message : "Sandbox output is invalid.",
        receipt,
      );
    }
  }
}

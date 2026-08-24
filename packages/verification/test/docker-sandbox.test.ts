import { describe, expect, it } from "vitest";
import {
  DockerVerificationSandbox,
  SandboxExecutionError,
  verifyExecutionReceipt,
  type ProcessExecution,
  type ProcessRunner,
  type VerificationExecutionProfile,
} from "../src/index.js";

const profile: VerificationExecutionProfile = {
  id: "authorization-regression",
  image: `registry.example/remedence/verifier@sha256:${"a".repeat(64)}`,
  command: ["/opt/remedence/verify"],
  timeoutSeconds: 30,
  maxAttempts: 3,
  memoryMegabytes: 256,
  cpuCount: 1,
  network: "none",
};
const input = {
  jobId: "job-one",
  attempt: 1,
  sourceRevision: "commit-one",
  patchDigest: "b".repeat(64),
  requiredChecks: ["Primary path", "Regression suite"],
};

function execution(
  overrides: Partial<ProcessExecution> = {},
): ProcessExecution {
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      result: "Passed",
      summary: "All configured checks passed.",
      checks: [
        { sequence: 1, name: "Primary path", status: "Passed", message: "ok" },
        {
          sequence: 2,
          name: "Regression suite",
          status: "Passed",
          message: "ok",
        },
      ],
    }),
    stderr: "",
    timedOut: false,
    startedAt: "2026-08-23T12:00:00.000Z",
    completedAt: "2026-08-23T12:00:05.000Z",
    ...overrides,
  };
}

describe("Docker verification sandbox", () => {
  it("executes only a digest-pinned profile with restrictive container controls", async () => {
    let invocation: Parameters<ProcessRunner["run"]>[0] | undefined;
    const runner: ProcessRunner = {
      async run(value) {
        invocation = value;
        return execution();
      },
    };
    const sandbox = new DockerVerificationSandbox(runner, "k".repeat(32));

    const result = await sandbox.execute(
      profile,
      input,
      "worker-one",
      new AbortController().signal,
    );

    expect(invocation?.executable).toBe("docker");
    expect(invocation?.arguments).toEqual(
      expect.arrayContaining([
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "no-new-privileges",
        profile.image,
      ]),
    );
    expect(result.output.result).toBe("Passed");
    expect(result.receipt).toMatchObject({
      jobId: input.jobId,
      workerId: "worker-one",
      imageDigest: `sha256:${"a".repeat(64)}`,
      timedOut: false,
    });
    expect(result.receipt.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyExecutionReceipt(result.receipt, "k".repeat(32))).toBe(true);
    expect(
      verifyExecutionReceipt(
        { ...result.receipt, outputHash: "0".repeat(64) },
        "k".repeat(32),
      ),
    ).toBe(false);
  });

  it("rejects mutable images before starting a process", async () => {
    const runner: ProcessRunner = {
      run: () => Promise.reject(new Error("must not execute")),
    };
    const sandbox = new DockerVerificationSandbox(runner, "k".repeat(32));

    await expect(
      sandbox.execute(
        { ...profile, image: "registry.example/verifier:latest" },
        input,
        "worker-one",
        new AbortController().signal,
      ),
    ).rejects.toThrow("not safely sandboxable");
  });

  it("returns a signed failed-attempt receipt for timeout and invalid output", async () => {
    const results = [
      execution({ exitCode: null, timedOut: true, stdout: "" }),
      execution({ stdout: '{"result":"Passed","summary":"bad","checks":[]}' }),
    ];
    const runner: ProcessRunner = {
      async run(value) {
        if (value.arguments[0] === "rm") return execution();
        return results.shift()!;
      },
    };
    const sandbox = new DockerVerificationSandbox(runner, "k".repeat(32));

    for (const expected of ["timed out", "does not match"]) {
      const caught = await sandbox
        .execute(profile, input, "worker-one", new AbortController().signal)
        .catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(SandboxExecutionError);
      expect((caught as Error).message).toContain(expected);
      expect((caught as SandboxExecutionError).receipt.signature).toMatch(
        /^[0-9a-f]{64}$/,
      );
    }
  });

  it("force-removes a timed-out container using its deterministic name", async () => {
    const invocations: Parameters<ProcessRunner["run"]>[0][] = [];
    const runner: ProcessRunner = {
      async run(value) {
        invocations.push(value);
        return value.arguments[0] === "rm"
          ? execution()
          : execution({ exitCode: null, timedOut: true, stdout: "" });
      },
    };
    const sandbox = new DockerVerificationSandbox(runner, "k".repeat(32));

    await expect(
      sandbox.execute(
        profile,
        input,
        "worker-one",
        new AbortController().signal,
      ),
    ).rejects.toThrow("timed out");
    expect(invocations[1]?.arguments).toEqual([
      "rm",
      "--force",
      "remedence-job-one-1",
    ]);
  });
});

export type VerificationJobStatus =
  "Queued" | "Running" | "Succeeded" | "Failed" | "Cancelled" | "Dead letter";

export interface VerificationJob {
  organizationId: string;
  id: string;
  verificationId: string;
  profileId: string;
  status: VerificationJobStatus;
  attempt: number;
  maxAttempts: number;
  timeoutSeconds: number;
  availableAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  cancellationRequested: boolean;
  lastError: string;
  createdAt: string;
  updatedAt: string;
}

export interface VerificationExecutionProfile {
  id: string;
  image: string;
  command: readonly string[];
  timeoutSeconds: number;
  maxAttempts: number;
  memoryMegabytes: number;
  cpuCount: number;
  network: "none";
}

export interface VerificationExecutionInput {
  jobId: string;
  attempt: number;
  sourceRevision: string;
  patchDigest: string;
  requiredChecks: readonly string[];
}

export interface VerificationExecutionCheck {
  sequence: number;
  name: string;
  status: "Passed" | "Failed" | "Skipped";
  message: string;
}

export interface VerificationExecutionOutput {
  result: "Passed" | "Failed";
  summary: string;
  checks: VerificationExecutionCheck[];
}

export interface VerificationExecutionReceipt {
  jobId: string;
  attempt: number;
  workerId: string;
  profileId: string;
  imageDigest: string;
  commandDigest: string;
  startedAt: string;
  completedAt: string;
  exitCode: number | null;
  timedOut: boolean;
  outputHash: string;
  signature: string;
}

export interface VerificationExecution {
  output: VerificationExecutionOutput;
  receipt: VerificationExecutionReceipt;
}

export interface VerificationJobQueue {
  enqueue(job: VerificationJob): void;
  get(organizationId: string, jobId: string): VerificationJob | undefined;
  getByVerification(
    organizationId: string,
    verificationId: string,
  ): VerificationJob | undefined;
  listReceipts(
    organizationId: string,
    jobId: string,
  ): VerificationExecutionReceipt[];
  claim(input: {
    workerId: string;
    now: string;
    leaseExpiresAt: string;
  }): VerificationJob | undefined;
  renewLease(input: {
    organizationId: string;
    jobId: string;
    workerId: string;
    now: string;
    leaseExpiresAt: string;
  }): boolean;
  requestCancellation(
    organizationId: string,
    jobId: string,
    now: string,
    cancelRun?: () => void,
  ): boolean;
  retryDeadLetter(organizationId: string, jobId: string, now: string): boolean;
  complete(
    input: {
      organizationId: string;
      jobId: string;
      workerId: string;
      receipt: VerificationExecutionReceipt;
      now: string;
    },
    applyResult: () => void,
  ): void;
  fail(input: {
    organizationId: string;
    jobId: string;
    workerId: string;
    error: string;
    retryAt: string;
    receipt?: VerificationExecutionReceipt;
    now: string;
    onCancelled?: () => void;
  }): VerificationJobStatus;
}

export interface VerificationSandbox {
  execute(
    profile: VerificationExecutionProfile,
    input: VerificationExecutionInput,
    workerId: string,
    signal: AbortSignal,
  ): Promise<VerificationExecution>;
}

export {
  createProcessRunner,
  DockerVerificationSandbox,
  SandboxExecutionError,
  signExecutionReceipt,
  verifyExecutionReceipt,
  type ProcessExecution,
  type ProcessRunner,
} from "./docker-sandbox.js";
export {
  VerificationWorker,
  type VerificationWorkerOptions,
  type VerificationWorkerSource,
} from "./worker.js";

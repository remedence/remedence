export type VerificationCheckResultStatus = "Passed" | "Failed" | "Skipped";

export interface VerificationExpectedCheck {
  sequence: number;
  name: string;
}

export interface VerificationCheckResult {
  sequence: number;
  name: string;
  status: VerificationCheckResultStatus;
  message: string;
}

export interface VerificationEvidenceResult {
  kind: string;
  label: string;
  sourceReference: string;
  metadata: Record<string, unknown>;
}

export interface VerificationResult {
  result: "Passed" | "Failed";
  summary: string;
  checks: VerificationCheckResult[];
  evidence: VerificationEvidenceResult[];
}

import { AlertCircle, CheckCircle2, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import type { DashboardFinding } from "../findings/FindingQueue";
import { LoadingState, ProblemState } from "../shared/AsyncState";
import { api } from "../../lib/api/client";
import {
  ApiProblemError,
  problemFromResponse,
  type ApiProblem,
} from "../../lib/api/problems";
import type { components, operations } from "../../lib/api/schema";
import { useApiMutation } from "../../lib/api/useApiMutation";
import { useApiQuery } from "../../lib/api/useApiQuery";
import { DialogLayer } from "../../lib/dialogs/DialogLayer";

type FindingDetail = components["schemas"]["FindingDetail"];
type VerificationWithChecks = components["schemas"]["VerificationWithChecks"];
type VerificationCheck = components["schemas"]["VerificationCheck"];
type VerificationCompletion = components["schemas"]["VerificationCompletion"];
type CreateVerificationRequest =
  operations["createVerification"]["requestBody"]["content"]["application/json"];
type CreateVerificationCheckRequest =
  operations["createVerificationCheck"]["requestBody"]["content"]["application/json"];
type CompleteVerificationRequest =
  operations["completeVerification"]["requestBody"]["content"]["application/json"];
type CreateEvidenceItem = components["schemas"]["CreateEvidenceItem"];

interface VerificationDrawerProps {
  finding: DashboardFinding;
  restoreFocusRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onPersistedChange: (message: string) => void;
}

async function loadFindingDetail(
  findingKey: string,
  signal: AbortSignal,
): Promise<FindingDetail> {
  const { data, error, response } = await api.GET("/findings/{findingId}", {
    params: { path: { findingId: findingKey } },
    signal,
  });
  if (data !== undefined) return data;
  throw new ApiProblemError(problemFromResponse(error, response));
}

function MutationProblem({
  problem,
  focusRef,
}: {
  problem: ApiProblem;
  focusRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={focusRef} className="mutation-problem" role="alert" tabIndex={-1}>
      <AlertCircle aria-hidden="true" />
      <div>
        <strong>{problem.title}</strong>
        <p>{problem.detail}</p>
        {problem.request_id ? (
          <small className="request-id">
            Request ID: <code>{problem.request_id}</code>
          </small>
        ) : null}
      </div>
    </div>
  );
}

function splitExpectedChecks(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function latestRunningVerification(detail: FindingDetail | undefined) {
  return detail?.verifications
    .filter((item) => item.verification.status === "Running")
    .at(-1);
}

function latestCompletedRemediation(detail: FindingDetail | undefined) {
  return detail?.remediations
    .filter((item) => item.status === "Completed")
    .at(-1);
}

export function VerificationDrawer({
  finding,
  restoreFocusRef,
  onClose,
  onPersistedChange,
}: VerificationDrawerProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const createErrorRef = useRef<HTMLDivElement | null>(null);
  const completionErrorRef = useRef<HTMLDivElement | null>(null);
  const [method, setMethod] = useState("");
  const [verifier, setVerifier] = useState("");
  const [scope, setScope] = useState("");
  const [expectedChecks, setExpectedChecks] = useState("");
  const [resultSummary, setResultSummary] = useState("");
  const [evidenceKind, setEvidenceKind] = useState("verification-artifact");
  const [evidenceLabel, setEvidenceLabel] = useState("");
  const [evidenceSourceReference, setEvidenceSourceReference] = useState("");
  const [evidenceMetadata, setEvidenceMetadata] = useState("{}");
  const [localProblem, setLocalProblem] = useState<ApiProblem | undefined>();
  const [pendingCheckIds, setPendingCheckIds] = useState<Set<string>>(
    () => new Set(),
  );

  const detail = useApiQuery<FindingDetail>(
    (signal) => loadFindingDetail(finding.finding_key, signal),
    [finding.finding_key],
  );
  const completedRemediation = latestCompletedRemediation(detail.data);
  const persistedRunning = latestRunningVerification(detail.data);

  const createMutation = useApiMutation<
    CreateVerificationRequest,
    VerificationWithChecks
  >(async (body, signal) => {
    const { data, error, response } = await api.POST("/verifications", {
      body,
      signal,
    });
    if (data !== undefined) return data;
    throw new ApiProblemError(problemFromResponse(error, response));
  });
  const activeVerificationId =
    persistedRunning?.verification.id ??
    (createMutation.data?.verification.status === "Running"
      ? createMutation.data.verification.id
      : undefined);
  const completionMutation = useApiMutation<
    CompleteVerificationRequest,
    VerificationCompletion
  >(async (body, signal) => {
    if (!activeVerificationId) {
      throw new Error("No running verification is available to complete.");
    }
    const { data, error, response } = await api.POST(
      "/verifications/{verificationId}/complete",
      {
        params: { path: { verificationId: activeVerificationId } },
        body,
        signal,
      },
    );
    if (data !== undefined) return data;
    throw new ApiProblemError(problemFromResponse(error, response));
  });

  useEffect(() => {
    if (createMutation.status === "error") createErrorRef.current?.focus();
  }, [createMutation.status]);

  useEffect(() => {
    if (completionMutation.status === "error" || localProblem) {
      completionErrorRef.current?.focus();
    }
  }, [completionMutation.status, localProblem]);

  async function createVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!completedRemediation) return;
    const checks = splitExpectedChecks(expectedChecks);
    const result = await createMutation.mutate({
      finding_id: finding.id,
      remediation_id: completedRemediation.id,
      method: method.trim(),
      worker_name: verifier.trim(),
      scope: scope.trim(),
      checks,
    });
    if (!result) return;
    detail.reload();
    onPersistedChange(`Verification ${result.verification.id} created.`);
  }

  async function completeFailed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalProblem(undefined);
    const result = await completionMutation.mutate({
      result: "Failed",
      summary: resultSummary.trim(),
      evidence: [],
    });
    if (!result) return;
    detail.reload();
    onPersistedChange("Verification failed. A new remediation is required.");
  }

  function parsedEvidence(): CreateEvidenceItem | undefined {
    try {
      const parsed: unknown = JSON.parse(evidenceMetadata || "{}");
      if (
        parsed === null ||
        Array.isArray(parsed) ||
        typeof parsed !== "object"
      ) {
        throw new Error("Evidence metadata must be a JSON object.");
      }
      return {
        kind: evidenceKind.trim(),
        label: evidenceLabel.trim(),
        source_reference: evidenceSourceReference.trim(),
        metadata: parsed as Record<string, unknown>,
      };
    } catch (error: unknown) {
      setLocalProblem({
        type: "about:blank",
        title: "Evidence metadata is invalid",
        status: 0,
        detail:
          error instanceof Error
            ? error.message
            : "Evidence metadata must be valid JSON.",
        instance: "/api/v1/verifications",
        code: "INVALID_EVIDENCE_METADATA",
        request_id: "",
      });
      return undefined;
    }
  }

  async function completePassed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalProblem(undefined);
    const evidence = parsedEvidence();
    if (!evidence) return;
    const result = await completionMutation.mutate({
      result: "Passed",
      summary: resultSummary.trim(),
      evidence: [evidence],
    });
    if (!result) return;
    detail.reload();
    onPersistedChange("Verified fixed. Evidence bundle locked.");
  }

  const completedResult = completionMutation.data;
  const running = completedResult
    ? undefined
    : (persistedRunning ??
      (createMutation.data?.verification.status === "Running"
        ? createMutation.data
        : undefined));
  const checks = running?.checks ?? [];
  const hasFailedCheck = checks.some((check) => check.status === "Failed");
  const allChecksPassed =
    checks.length > 0 && checks.every((check) => check.status === "Passed");
  const currentState =
    completedResult?.finding.state ?? detail.data?.finding.state;
  const closeBlocked =
    createMutation.status === "pending" ||
    completionMutation.status === "pending" ||
    pendingCheckIds.size > 0;
  function setCheckPending(checkId: string, pending: boolean) {
    setPendingCheckIds((current) => {
      const next = new Set(current);
      if (pending) next.add(checkId);
      else next.delete(checkId);
      return next;
    });
  }

  return (
    <DialogLayer
      layerClassName="drawer-layer"
      dialogClassName="verification-drawer verification-workflow-drawer"
      labelledBy="verification-workflow-title"
      initialFocusRef={closeRef}
      restoreFocusRef={restoreFocusRef}
      onClose={onClose}
      closeDisabled={closeBlocked}
    >
      <div className="drawer-header">
        <div>
          <span className="mono">{finding.finding_key}</span>
          <h2 id="verification-workflow-title">Verification</h2>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="icon-button"
          aria-label="Close verification"
          disabled={closeBlocked}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </div>

      <div className="drawer-content">
        <div className="drawer-finding">
          <p className="section-kicker">
            Record independent verification result
          </p>
          <h3>{finding.title}</h3>
          <p>{finding.company_name}</p>
        </div>

        {detail.status === "loading" || detail.status === "idle" ? (
          <LoadingState />
        ) : null}
        {detail.status === "error" && detail.problem ? (
          <ProblemState problem={detail.problem} onRetry={detail.reload} />
        ) : null}

        {detail.data ? (
          <>
            <section aria-labelledby="remediation-history-title">
              <h3 id="remediation-history-title">Remediation history</h3>
              {detail.data.remediations.length ? (
                <div className="history-stack">
                  {detail.data.remediations.map((item) => (
                    <article key={item.id} className="history-record">
                      <div>
                        <strong>{item.status}</strong>
                        <span className="mono">{item.id}</span>
                      </div>
                      <p>{item.summary}</p>
                      <small>
                        Owner: {item.owner} · Reference:{" "}
                        <span className="mono">{item.reference}</span>
                      </small>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="workflow-copy">
                  No persisted remediation is available.
                </p>
              )}
            </section>

            <VerificationHistory verifications={detail.data.verifications} />
          </>
        ) : null}

        {detail.data &&
        currentState === "Awaiting verification" &&
        !persistedRunning &&
        createMutation.data?.verification.status !== "Running" ? (
          <section aria-labelledby="create-verification-title">
            <h3 id="create-verification-title">Create verification</h3>
            <p className="workflow-copy">
              Record the verifier, method, scope, and required checks. Remedence
              does not treat remediation as self-verification.
            </p>
            <form className="workflow-form" onSubmit={createVerification}>
              <label>
                <span>Verification method</span>
                <input
                  aria-label="Verification method"
                  name="verificationMethod"
                  required
                  value={method}
                  onChange={(event) => {
                    setMethod(event.target.value);
                    if (createMutation.status === "error")
                      createMutation.reset();
                  }}
                />
              </label>
              <label>
                <span>Verifier</span>
                <input
                  aria-label="Verifier"
                  name="verifier"
                  required
                  value={verifier}
                  onChange={(event) => {
                    setVerifier(event.target.value);
                    if (createMutation.status === "error")
                      createMutation.reset();
                  }}
                />
              </label>
              <label>
                <span>Verification scope</span>
                <textarea
                  aria-label="Verification scope"
                  name="verificationScope"
                  required
                  rows={2}
                  value={scope}
                  onChange={(event) => {
                    setScope(event.target.value);
                    if (createMutation.status === "error")
                      createMutation.reset();
                  }}
                />
              </label>
              <label>
                <span>Expected checks</span>
                <textarea
                  aria-label="Expected checks"
                  name="expectedChecks"
                  required
                  rows={4}
                  placeholder="One required check per line"
                  value={expectedChecks}
                  onChange={(event) => {
                    setExpectedChecks(event.target.value);
                    if (createMutation.status === "error")
                      createMutation.reset();
                  }}
                />
              </label>
              {createMutation.status === "error" && createMutation.problem ? (
                <MutationProblem
                  problem={createMutation.problem}
                  focusRef={createErrorRef}
                />
              ) : null}
              <p className="mutation-pending" role="status" aria-live="polite">
                {createMutation.status === "pending"
                  ? "Creating verification…"
                  : ""}
              </p>
              <div className="drawer-actions">
                <button
                  type="submit"
                  className="button primary"
                  disabled={
                    createMutation.status === "pending" || !completedRemediation
                  }
                >
                  Create verification
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {running ? (
          <section aria-labelledby="record-checks-title">
            <h3 id="record-checks-title">Required checks</h3>
            <dl className="verification-details">
              <div>
                <dt>Verification ID</dt>
                <dd className="mono">{running.verification.id}</dd>
              </div>
              <div>
                <dt>Verifier</dt>
                <dd>{running.verification.worker_name}</dd>
              </div>
              <div>
                <dt>Method</dt>
                <dd>{running.verification.method}</dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>{running.verification.scope}</dd>
              </div>
            </dl>
            <div className="verification-check-stack">
              {checks.map((check) => (
                <VerificationCheckForm
                  key={`${check.id}:${check.status}:${check.message}`}
                  check={check}
                  verificationId={running.verification.id}
                  onRecorded={() => detail.reload()}
                  onPendingChange={(pending) =>
                    setCheckPending(check.id, pending)
                  }
                />
              ))}
            </div>
          </section>
        ) : null}

        {running && hasFailedCheck ? (
          <section aria-labelledby="failed-completion-title">
            <h3 id="failed-completion-title">Complete Failed</h3>
            <p className="workflow-copy">
              A failed verification requires a concrete written summary and
              remains in verification history.
            </p>
            <form className="workflow-form" onSubmit={completeFailed}>
              <label>
                <span>Verification result summary</span>
                <textarea
                  aria-label="Verification result summary"
                  name="verificationResultSummary"
                  required
                  rows={3}
                  value={resultSummary}
                  onChange={(event) => {
                    setResultSummary(event.target.value);
                    setLocalProblem(undefined);
                    if (completionMutation.status === "error") {
                      completionMutation.reset();
                    }
                  }}
                />
              </label>
              {completionMutation.status === "error" &&
              completionMutation.problem ? (
                <MutationProblem
                  problem={completionMutation.problem}
                  focusRef={completionErrorRef}
                />
              ) : null}
              <p className="mutation-pending" role="status" aria-live="polite">
                {completionMutation.status === "pending"
                  ? "Recording verification result…"
                  : ""}
              </p>
              <div className="drawer-actions">
                <button
                  type="submit"
                  className="button primary"
                  disabled={completionMutation.status === "pending"}
                >
                  Complete failed verification
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {running && allChecksPassed ? (
          <section aria-labelledby="passed-completion-title">
            <h3 id="passed-completion-title">Complete Passed</h3>
            <p className="workflow-copy">
              Every required check is persisted as Passed. Completing this
              transaction also creates and locks the evidence bundle.
            </p>
            <form className="workflow-form" onSubmit={completePassed}>
              <label>
                <span>Verification result summary</span>
                <textarea
                  aria-label="Verification result summary"
                  name="verificationResultSummary"
                  required
                  rows={3}
                  value={resultSummary}
                  onChange={(event) => {
                    setResultSummary(event.target.value);
                    setLocalProblem(undefined);
                    if (completionMutation.status === "error") {
                      completionMutation.reset();
                    }
                  }}
                />
              </label>
              <label>
                <span>Evidence kind</span>
                <input
                  aria-label="Evidence kind"
                  name="evidenceKind"
                  required
                  value={evidenceKind}
                  onChange={(event) => setEvidenceKind(event.target.value)}
                />
              </label>
              <label>
                <span>Evidence label</span>
                <input
                  aria-label="Evidence label"
                  name="evidenceLabel"
                  required
                  value={evidenceLabel}
                  onChange={(event) => setEvidenceLabel(event.target.value)}
                />
              </label>
              <label>
                <span>Evidence source reference</span>
                <input
                  aria-label="Evidence source reference"
                  name="evidenceSourceReference"
                  required
                  value={evidenceSourceReference}
                  onChange={(event) =>
                    setEvidenceSourceReference(event.target.value)
                  }
                />
              </label>
              <label>
                <span>Evidence metadata</span>
                <textarea
                  className="mono"
                  aria-label="Evidence metadata"
                  name="evidenceMetadata"
                  required
                  rows={4}
                  value={evidenceMetadata}
                  onChange={(event) => {
                    setEvidenceMetadata(event.target.value);
                    setLocalProblem(undefined);
                  }}
                />
              </label>
              {localProblem ? (
                <MutationProblem
                  problem={localProblem}
                  focusRef={completionErrorRef}
                />
              ) : null}
              {completionMutation.status === "error" &&
              completionMutation.problem ? (
                <MutationProblem
                  problem={completionMutation.problem}
                  focusRef={completionErrorRef}
                />
              ) : null}
              <p className="mutation-pending" role="status" aria-live="polite">
                {completionMutation.status === "pending"
                  ? "Recording verification result…"
                  : ""}
              </p>
              <div className="drawer-actions">
                <button
                  type="submit"
                  className="button primary"
                  disabled={completionMutation.status === "pending"}
                >
                  Complete passed verification
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {completedResult?.finding.state === "Verification failed" ? (
          <div
            className="verification-failure"
            role="status"
            aria-live="polite"
          >
            <AlertCircle aria-hidden="true" />
            <div>
              <strong>Verification failed</strong>
              <p>{completedResult.verification.result_summary}</p>
              <span className="mono">{completedResult.verification.id}</span>
            </div>
          </div>
        ) : null}

        {completedResult?.finding.state === "Verified fixed" ? (
          <div
            className="verification-success"
            role="status"
            aria-live="polite"
          >
            <CheckCircle2 aria-hidden="true" />
            <div>
              <strong>Verified fixed. Evidence bundle locked.</strong>
              <p>{completedResult.verification.result_summary}</p>
              {completedResult.evidence.map((item) => (
                <span key={item.id} className="mono">
                  {item.id} · {item.content_hash}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </DialogLayer>
  );
}

function VerificationCheckForm({
  verificationId,
  check,
  onRecorded,
  onPendingChange,
}: {
  verificationId: string;
  check: VerificationCheck;
  onRecorded: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const errorRef = useRef<HTMLDivElement | null>(null);
  const submittingRef = useRef(false);
  const [status, setStatus] = useState<"Passed" | "Failed" | "Skipped">(
    "Passed",
  );
  const [message, setMessage] = useState("");
  const mutation = useApiMutation<
    CreateVerificationCheckRequest,
    VerificationCheck
  >(async (body, signal) => {
    const { data, error, response } = await api.POST(
      "/verifications/{verificationId}/checks",
      {
        params: { path: { verificationId } },
        body,
        signal,
      },
    );
    if (data !== undefined) return data;
    throw new ApiProblemError(problemFromResponse(error, response));
  });

  useEffect(() => {
    if (mutation.status === "error") errorRef.current?.focus();
  }, [mutation.status]);

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    onPendingChange(true);
    try {
      const result = await mutation.mutate({
        sequence: check.sequence,
        name: check.name,
        status,
        message: message.trim(),
      });
      if (!result) return;
      onRecorded();
    } finally {
      submittingRef.current = false;
      onPendingChange(false);
    }
  }

  if (check.status !== "Pending") {
    return (
      <article className="verification-check-record">
        <div>
          <strong>{check.name}</strong>
          <span>{check.status}</span>
        </div>
        {check.message ? <p>{check.message}</p> : null}
      </article>
    );
  }

  return (
    <form className="verification-check-form" onSubmit={record}>
      <strong>{check.name}</strong>
      <label>
        <span>Result</span>
        <select
          aria-label={`Result for ${check.name}`}
          name={`check-${check.id}-result`}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as "Passed" | "Failed" | "Skipped");
            if (mutation.status === "error") mutation.reset();
          }}
        >
          <option value="Passed">Passed</option>
          <option value="Failed">Failed</option>
          <option value="Skipped">Skipped</option>
        </select>
      </label>
      <label>
        <span>Message</span>
        <input
          aria-label={`Message for ${check.name}`}
          name={`check-${check.id}-message`}
          required={status === "Failed"}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
            if (mutation.status === "error") mutation.reset();
          }}
        />
      </label>
      {mutation.status === "error" && mutation.problem ? (
        <MutationProblem problem={mutation.problem} focusRef={errorRef} />
      ) : null}
      <p className="mutation-pending" role="status" aria-live="polite">
        {mutation.status === "pending" ? "Recording verification check…" : ""}
      </p>
      <button
        type="submit"
        className="button secondary"
        disabled={mutation.status === "pending"}
      >
        Record {check.name}
      </button>
    </form>
  );
}

function VerificationHistory({
  verifications,
}: {
  verifications: FindingDetail["verifications"];
}) {
  if (!verifications.length) {
    return (
      <section aria-labelledby="verification-history-title">
        <h3 id="verification-history-title">Verification history</h3>
        <p className="workflow-copy">
          No verification runs have been recorded yet.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="verification-history-title">
      <h3 id="verification-history-title">Verification history</h3>
      <div className="history-stack">
        {verifications.map(({ verification, checks }) => (
          <article key={verification.id} className="history-record">
            <div>
              <strong>{verification.status}</strong>
              <span className="mono">{verification.id}</span>
            </div>
            <p>{verification.result_summary || "Verification in progress."}</p>
            <small>
              Verifier: {verification.worker_name} · Method:{" "}
              {verification.method}
            </small>
            {checks.length ? (
              <ul className="verification-history-checks">
                {checks.map((check) => (
                  <li key={check.id}>
                    <span>{check.name}</span>
                    <strong>{check.status}</strong>
                    {check.message ? <small>{check.message}</small> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

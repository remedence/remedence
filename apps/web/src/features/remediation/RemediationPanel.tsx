import { AlertCircle, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { DashboardFinding } from "../findings/FindingQueue";
import { LoadingState, ProblemState } from "../shared/AsyncState";
import { api, entityTag } from "../../lib/api/client";
import { ApiProblemError, problemFromResponse } from "../../lib/api/problems";
import type { components, operations } from "../../lib/api/schema";
import { useApiMutation } from "../../lib/api/useApiMutation";
import { useApiQuery } from "../../lib/api/useApiQuery";
import { DialogLayer } from "../../lib/dialogs/DialogLayer";

type FindingDetail = components["schemas"]["FindingDetail"];
type Remediation = components["schemas"]["Remediation"];
type StartRequest =
  operations["createRemediation"]["requestBody"]["content"]["application/json"];
type CompleteRequest =
  operations["completeRemediation"]["requestBody"]["content"]["application/json"];

interface RemediationPanelProps {
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
  problem: components["schemas"]["Problem"];
  focusRef: RefObject<HTMLDivElement | null>;
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

export function RemediationPanel({
  finding,
  restoreFocusRef,
  onClose,
  onPersistedChange,
}: RemediationPanelProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const startErrorRef = useRef<HTMLDivElement | null>(null);
  const completeErrorRef = useRef<HTMLDivElement | null>(null);
  const [owner, setOwner] = useState(finding.owner);
  const [summary, setSummary] = useState("");
  const [reference, setReference] = useState("");
  const [completionSummary, setCompletionSummary] = useState("");
  const [completionReference, setCompletionReference] = useState("");
  const detail = useApiQuery<FindingDetail>(
    (signal) => loadFindingDetail(finding.finding_key, signal),
    [finding.finding_key],
  );
  const startMutation = useApiMutation<StartRequest, Remediation>(
    async (body, signal) => {
      const { data, error, response } = await api.POST("/remediations", {
        headers: {
          "If-Match": entityTag(
            "finding",
            detail.data?.finding.id ?? finding.id,
            detail.data?.finding.version ?? finding.version,
          ),
        },
        body,
        signal,
      });
      if (data !== undefined) return data;
      throw new ApiProblemError(problemFromResponse(error, response));
    },
  );
  const persistedInProgress = detail.data?.remediations
    .filter((item) => item.status === "In progress")
    .at(-1);
  const activeRemediation =
    completeMutationData(startMutation.data, undefined) ?? persistedInProgress;
  const completeMutation = useApiMutation<CompleteRequest, Remediation>(
    async (body, signal) => {
      if (!activeRemediation) {
        throw new Error("No in-progress remediation is available to complete.");
      }
      const { data, error, response } = await api.POST(
        "/remediations/{remediationId}/complete",
        {
          params: { path: { remediationId: activeRemediation.id } },
          headers: {
            "If-Match": entityTag(
              "remediation",
              activeRemediation.id,
              activeRemediation.version,
            ),
          },
          body,
          signal,
        },
      );
      if (data !== undefined) return data;
      throw new ApiProblemError(problemFromResponse(error, response));
    },
  );
  const displayedRemediation =
    completeMutation.data ?? startMutation.data ?? persistedInProgress;

  useEffect(() => {
    if (startMutation.status === "error") startErrorRef.current?.focus();
  }, [startMutation.status]);

  useEffect(() => {
    if (completeMutation.status === "error") completeErrorRef.current?.focus();
  }, [completeMutation.status]);

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await startMutation.mutate({
      finding_id: finding.id,
      owner: owner.trim(),
      summary: summary.trim(),
      reference: reference.trim(),
    });
    if (!result) return;
    detail.reload();
    onPersistedChange(`Remediation ${result.id} started.`);
  }

  async function complete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await completeMutation.mutate({
      summary: completionSummary.trim(),
      reference: completionReference.trim(),
    });
    if (!result) return;
    detail.reload();
    onPersistedChange(
      "Remediation completed. Finding is awaiting independent verification.",
    );
  }

  const completed = displayedRemediation?.status === "Completed";
  const closeBlocked =
    startMutation.status === "pending" || completeMutation.status === "pending";

  return (
    <DialogLayer
      layerClassName="drawer-layer"
      dialogClassName="verification-drawer remediation-panel"
      labelledBy="remediation-panel-title"
      initialFocusRef={closeRef}
      restoreFocusRef={restoreFocusRef}
      onClose={onClose}
      closeDisabled={closeBlocked}
    >
      <div className="drawer-header">
        <div>
          <span className="mono">{finding.finding_key}</span>
          <h2 id="remediation-panel-title">Remediation</h2>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="icon-button"
          aria-label="Close remediation"
          disabled={closeBlocked}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="drawer-content">
        <div className="drawer-finding">
          <h3>{finding.title}</h3>
          <p>{finding.company_name}</p>
        </div>

        {detail.status === "error" && detail.problem ? (
          <ProblemState problem={detail.problem} onRetry={detail.reload} />
        ) : null}

        {finding.state === "Remediating" &&
        !displayedRemediation &&
        (detail.status === "loading" || detail.status === "idle") ? (
          <LoadingState />
        ) : null}

        {!displayedRemediation && finding.state !== "Remediating" ? (
          <section aria-labelledby="start-remediation-title">
            <h3 id="start-remediation-title">Start remediation</h3>
            <p className="workflow-copy">
              Record who owns the change, what will change, and the external
              reference. This action does not verify the finding.
            </p>
            <form className="workflow-form" onSubmit={start}>
              <label>
                <span>Remediation owner</span>
                <input
                  aria-label="Remediation owner"
                  name="remediationOwner"
                  required
                  value={owner}
                  onChange={(event) => {
                    setOwner(event.target.value);
                    if (startMutation.status === "error") startMutation.reset();
                  }}
                />
              </label>
              <label>
                <span>Remediation summary</span>
                <textarea
                  aria-label="Remediation summary"
                  name="remediationSummary"
                  required
                  rows={3}
                  value={summary}
                  onChange={(event) => {
                    setSummary(event.target.value);
                    if (startMutation.status === "error") startMutation.reset();
                  }}
                />
              </label>
              <label>
                <span>Remediation reference</span>
                <input
                  aria-label="Remediation reference"
                  name="remediationReference"
                  required
                  placeholder="Commit, PR/MR, ticket, or change reference"
                  value={reference}
                  onChange={(event) => {
                    setReference(event.target.value);
                    if (startMutation.status === "error") startMutation.reset();
                  }}
                />
              </label>
              {startMutation.status === "error" && startMutation.problem ? (
                <MutationProblem
                  problem={startMutation.problem}
                  focusRef={startErrorRef}
                />
              ) : null}
              <p className="mutation-pending" role="status" aria-live="polite">
                {startMutation.status === "pending"
                  ? "Saving remediation…"
                  : ""}
              </p>
              <div className="drawer-actions">
                <button
                  type="submit"
                  className="button primary"
                  disabled={startMutation.status === "pending"}
                >
                  Start remediation
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {displayedRemediation ? (
          <section aria-labelledby="persisted-remediation-title">
            <h3 id="persisted-remediation-title">
              {completed ? "Completed remediation" : "Persisted remediation"}
            </h3>
            <dl className="verification-details remediation-details">
              <div>
                <dt>Remediation ID</dt>
                <dd className="mono">{displayedRemediation.id}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{displayedRemediation.owner}</dd>
              </div>
              <div>
                <dt>Reference</dt>
                <dd className="mono">{displayedRemediation.reference}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{displayedRemediation.status}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        {displayedRemediation?.status === "In progress" ? (
          <section aria-labelledby="complete-remediation-title">
            <h3 id="complete-remediation-title">Complete remediation</h3>
            <p className="workflow-copy">
              Completion moves the finding to Awaiting verification. It does not
              create Verified fixed.
            </p>
            <form className="workflow-form" onSubmit={complete}>
              <label>
                <span>Completion summary</span>
                <textarea
                  aria-label="Completion summary"
                  name="completionSummary"
                  required
                  rows={3}
                  value={completionSummary}
                  onChange={(event) => {
                    setCompletionSummary(event.target.value);
                    if (completeMutation.status === "error")
                      completeMutation.reset();
                  }}
                />
              </label>
              <label>
                <span>Completion reference</span>
                <input
                  aria-label="Completion reference"
                  name="completionReference"
                  required
                  value={completionReference}
                  onChange={(event) => {
                    setCompletionReference(event.target.value);
                    if (completeMutation.status === "error")
                      completeMutation.reset();
                  }}
                />
              </label>
              {completeMutation.status === "error" &&
              completeMutation.problem ? (
                <MutationProblem
                  problem={completeMutation.problem}
                  focusRef={completeErrorRef}
                />
              ) : null}
              <p className="mutation-pending" role="status" aria-live="polite">
                {completeMutation.status === "pending"
                  ? "Completing remediation…"
                  : ""}
              </p>
              <div className="drawer-actions">
                <button
                  type="submit"
                  className="button primary"
                  disabled={completeMutation.status === "pending"}
                >
                  Complete remediation
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {completed ? (
          <div className="meaningful-state" role="status" aria-live="polite">
            <h3>Remediation completed</h3>
            <p>
              Awaiting independent verification. This finding is not yet
              verified fixed.
            </p>
          </div>
        ) : null}
      </div>
    </DialogLayer>
  );
}

function completeMutationData(
  remediation: Remediation | undefined,
  fallback: Remediation | undefined,
): Remediation | undefined {
  return remediation?.status === "In progress" ? remediation : fallback;
}

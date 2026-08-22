import { FileCheck2, LockKeyhole } from "lucide-react";
import { api } from "../../lib/api/client";
import { ApiProblemError, problemFromResponse } from "../../lib/api/problems";
import type { components } from "../../lib/api/schema";
import { useApiQuery } from "../../lib/api/useApiQuery";
import { EmptyState, LoadingState, ProblemState } from "../shared/AsyncState";

type EvidenceItem = components["schemas"]["EvidenceItem"];

async function loadEvidence(signal: AbortSignal): Promise<EvidenceItem[]> {
  const { data, error, response } = await api.GET("/evidence", { signal });
  if (data !== undefined) return data;
  throw new ApiProblemError(problemFromResponse(error, response));
}

function timestamp(value: string | null): string {
  if (!value) return "Not locked";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

export function EvidencePage() {
  const evidence = useApiQuery<EvidenceItem[]>(
    (signal) => loadEvidence(signal),
    [],
  );

  return (
    <>
      <div className="page-header compact">
        <div>
          <h1>Evidence</h1>
          <p>
            Locked verification evidence is read from the canonical API and
            cannot be edited from this workspace.
          </p>
        </div>
      </div>
      <section className="operational-section scaffold-section evidence-page-section">
        {evidence.status === "loading" || evidence.status === "idle" ? (
          <LoadingState />
        ) : evidence.status === "error" && evidence.problem ? (
          <ProblemState problem={evidence.problem} onRetry={evidence.reload} />
        ) : evidence.data?.length ? (
          <div className="evidence-proof-list">
            {[...evidence.data]
              .sort(
                (left, right) =>
                  Date.parse(right.created_at) - Date.parse(left.created_at),
              )
              .map((item) => (
                <article key={item.id} className="evidence-proof-card">
                  <div className="evidence-proof-heading">
                    <FileCheck2 aria-hidden="true" />
                    <div>
                      <p className="section-kicker">{item.kind}</p>
                      <h2>{item.label}</h2>
                    </div>
                    <span className="evidence-lock-state">
                      <LockKeyhole aria-hidden="true" />
                      {item.locked_at
                        ? "Locked evidence"
                        : "Recorded, not locked"}
                    </span>
                  </div>
                  <dl className="evidence-proof-details">
                    <div>
                      <dt>Evidence ID</dt>
                      <dd className="mono">{item.id}</dd>
                    </div>
                    <div>
                      <dt>Verification ID</dt>
                      <dd className="mono">{item.verification_id}</dd>
                    </div>
                    <div>
                      <dt>Source reference</dt>
                      <dd className="mono">{item.source_reference}</dd>
                    </div>
                    <div>
                      <dt>Content hash</dt>
                      <dd className="mono evidence-hash">
                        {item.content_hash}
                      </dd>
                    </div>
                    <div>
                      <dt>Created</dt>
                      <dd>{timestamp(item.created_at)}</dd>
                    </div>
                    <div>
                      <dt>Locked at</dt>
                      <dd>{timestamp(item.locked_at)}</dd>
                    </div>
                  </dl>
                </article>
              ))}
          </div>
        ) : (
          <EmptyState
            title="No evidence matches this workspace read."
            detail="Evidence appears only after a persisted verification pass creates and locks it."
          />
        )}
      </section>
    </>
  );
}

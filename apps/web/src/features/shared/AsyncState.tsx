import { AlertCircle, RefreshCw, Search } from "lucide-react";
import type { ReactNode } from "react";
import type { ApiProblem } from "../../lib/api/problems";

export function LoadingState() {
  return (
    <section
      className="empty-state async-state"
      role="status"
      aria-live="polite"
    >
      <RefreshCw aria-hidden="true" />
      <h2>Loading remediation workspace.</h2>
      <p>Reading the latest persisted state from the local Remedence API.</p>
    </section>
  );
}

export function ProblemState({
  problem,
  onRetry,
}: {
  problem: ApiProblem;
  onRetry: () => void;
}) {
  return (
    <section className="empty-state async-state problem-state" role="alert">
      <AlertCircle aria-hidden="true" />
      <h2>{problem.title}</h2>
      <p>{problem.detail}</p>
      {problem.request_id ? (
        <p className="request-id">
          Request ID <code>{problem.request_id}</code>
        </p>
      ) : null}
      <button type="button" className="button secondary" onClick={onRetry}>
        <RefreshCw aria-hidden="true" />
        Retry
      </button>
    </section>
  );
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state async-state">
      <Search aria-hidden="true" />
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}

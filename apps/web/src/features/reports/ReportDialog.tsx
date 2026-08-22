import { AlertCircle, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { api } from "../../lib/api/client";
import { ApiProblemError, problemFromResponse } from "../../lib/api/problems";
import type { components, operations } from "../../lib/api/schema";
import { useApiMutation } from "../../lib/api/useApiMutation";
import { DialogLayer } from "../../lib/dialogs/DialogLayer";

type Company = components["schemas"]["CompanyRiskSummary"];
type Report = components["schemas"]["Report"];
type CreateReportRequest =
  operations["createReport"]["requestBody"]["content"]["application/json"];

interface ReportDialogProps {
  companies: Company[];
  restoreFocusRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSuccess: (report: Report) => void;
}

export function ReportDialog({
  companies,
  restoreFocusRef,
  onClose,
  onSuccess,
}: ReportDialogProps) {
  const companyRef = useRef<HTMLSelectElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const [companyId, setCompanyId] = useState(companies[0]?.company_id ?? "");
  const [periodLabel, setPeriodLabel] = useState("");
  const mutation = useApiMutation<CreateReportRequest, Report>(
    async (body, signal) => {
      const { data, error, response } = await api.POST("/reports", {
        body,
        signal,
      });
      if (data !== undefined) return data;
      throw new ApiProblemError(problemFromResponse(error, response));
    },
  );

  useEffect(() => {
    if (mutation.status === "error") errorRef.current?.focus();
  }, [mutation.status]);

  const closeBlocked = mutation.status === "pending";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await mutation.mutate({
      company_id: companyId,
      period_label: periodLabel.trim(),
    });
    if (!result) return;
    onSuccess(result);
    onClose();
  }

  return (
    <DialogLayer
      layerClassName="modal-layer"
      dialogClassName="modal report-dialog"
      labelledBy="generate-report-title"
      initialFocusRef={companyRef}
      restoreFocusRef={restoreFocusRef}
      onClose={onClose}
      closeDisabled={closeBlocked}
    >
      <div className="modal-header">
        <div>
          <p className="section-kicker">Immutable client proof</p>
          <h2 id="generate-report-title">Generate report</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close generate report"
          disabled={closeBlocked}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <form onSubmit={submit}>
        <label>
          <span>Company</span>
          <select
            ref={companyRef}
            aria-label="Company"
            name="companyId"
            required
            value={companyId}
            onChange={(event) => {
              setCompanyId(event.target.value);
              if (mutation.status === "error") mutation.reset();
            }}
          >
            {companies.map((company) => (
              <option key={company.company_id} value={company.company_id}>
                {company.company_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Period label</span>
          <input
            aria-label="Period label"
            name="periodLabel"
            required
            value={periodLabel}
            onChange={(event) => {
              setPeriodLabel(event.target.value);
              if (mutation.status === "error") mutation.reset();
            }}
            placeholder="September 2026"
          />
        </label>

        {mutation.status === "error" && mutation.problem ? (
          <div
            ref={errorRef}
            className="mutation-problem"
            role="alert"
            tabIndex={-1}
          >
            <AlertCircle aria-hidden="true" />
            <div>
              <strong>{mutation.problem.title}</strong>
              <p>{mutation.problem.detail}</p>
              {mutation.problem.request_id ? (
                <small className="request-id">
                  Request ID: <code>{mutation.problem.request_id}</code>
                </small>
              ) : null}
            </div>
          </div>
        ) : null}

        <p className="mutation-pending" role="status" aria-live="polite">
          {mutation.status === "pending" ? "Generating report…" : ""}
        </p>
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={closeBlocked}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={mutation.status === "pending"}
          >
            Generate report
          </button>
        </div>
      </form>
    </DialogLayer>
  );
}

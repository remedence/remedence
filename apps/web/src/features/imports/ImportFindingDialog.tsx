import { AlertCircle, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { api } from "../../lib/api/client";
import { ApiProblemError, problemFromResponse } from "../../lib/api/problems";
import type { components, operations } from "../../lib/api/schema";
import { useApiMutation } from "../../lib/api/useApiMutation";
import { DialogLayer } from "../../lib/dialogs/DialogLayer";

type ImportRequest =
  operations["createImport"]["requestBody"]["content"]["application/json"];
type ImportResult = components["schemas"]["ImportResult"];
type Company = components["schemas"]["CompanyRiskSummary"];
type Severity = components["schemas"]["Severity"];

interface ImportFindingDialogProps {
  companies: Company[];
  restoreFocusRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSuccess: (result: ImportResult) => void;
}

interface ImportForm {
  companyId: string;
  source: string;
  findingKey: string;
  title: string;
  description: string;
  severity: Severity;
  owner: string;
  assetName: string;
  detectedAt: string;
  slaDueAt: string;
}

function toIsoTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toISOString();
}

export function ImportFindingDialog({
  companies,
  restoreFocusRef,
  onClose,
  onSuccess,
}: ImportFindingDialogProps) {
  const firstFieldRef = useRef<HTMLSelectElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const [form, setForm] = useState<ImportForm>({
    companyId: companies[0]?.company_id ?? "",
    source: "",
    findingKey: "",
    title: "",
    description: "",
    severity: "High",
    owner: "",
    assetName: "",
    detectedAt: "",
    slaDueAt: "",
  });
  const mutation = useApiMutation<ImportRequest, ImportResult>(
    async (body, signal) => {
      const { data, error, response } = await api.POST("/imports", {
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

  function update<K extends keyof ImportForm>(key: K, value: ImportForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (mutation.status === "error") mutation.reset();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request: ImportRequest = {
      company_id: form.companyId,
      source: form.source.trim(),
      finding_key: form.findingKey.trim().toUpperCase(),
      title: form.title.trim(),
      description: form.description.trim(),
      severity: form.severity,
      owner: form.owner.trim(),
      asset_name: form.assetName.trim(),
      detected_at: toIsoTimestamp(form.detectedAt),
      sla_due_at: toIsoTimestamp(form.slaDueAt),
    };
    const result = await mutation.mutate(request);
    if (!result) return;
    onSuccess(result);
    onClose();
  }

  return (
    <DialogLayer
      layerClassName="modal-layer"
      dialogClassName="modal import-modal"
      labelledBy="import-finding-title"
      initialFocusRef={firstFieldRef}
      restoreFocusRef={restoreFocusRef}
      onClose={onClose}
      closeDisabled={closeBlocked}
    >
      <div className="modal-header">
        <div>
          <p className="section-kicker">Persisted finding intake</p>
          <h2 id="import-finding-title">Import finding</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close import finding"
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
            ref={firstFieldRef}
            aria-label="Company"
            name="companyId"
            required
            value={form.companyId}
            onChange={(event) => update("companyId", event.target.value)}
          >
            {companies.map((company) => (
              <option key={company.company_id} value={company.company_id}>
                {company.company_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Severity</span>
          <select
            aria-label="Severity"
            name="severity"
            value={form.severity}
            onChange={(event) =>
              update("severity", event.target.value as Severity)
            }
          >
            {(["Critical", "High", "Medium", "Low", "Info"] as const).map(
              (severity) => (
                <option key={severity} value={severity}>
                  {severity}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          <span>Source</span>
          <input
            aria-label="Source"
            name="source"
            required
            value={form.source}
            onChange={(event) => update("source", event.target.value)}
          />
        </label>
        <label>
          <span>Finding key</span>
          <input
            aria-label="Finding key"
            name="findingKey"
            required
            value={form.findingKey}
            onChange={(event) => update("findingKey", event.target.value)}
          />
        </label>
        <label className="form-wide">
          <span>Title</span>
          <input
            aria-label="Title"
            name="title"
            required
            value={form.title}
            onChange={(event) => update("title", event.target.value)}
          />
        </label>
        <label className="form-wide">
          <span>Description</span>
          <textarea
            aria-label="Description"
            name="description"
            required
            rows={3}
            value={form.description}
            onChange={(event) => update("description", event.target.value)}
          />
        </label>
        <label>
          <span>Owner</span>
          <input
            aria-label="Owner"
            name="owner"
            required
            value={form.owner}
            onChange={(event) => update("owner", event.target.value)}
          />
        </label>
        <label>
          <span>Asset</span>
          <input
            aria-label="Asset"
            name="assetName"
            required
            value={form.assetName}
            onChange={(event) => update("assetName", event.target.value)}
          />
        </label>
        <label>
          <span>Detected at</span>
          <input
            aria-label="Detected at"
            name="detectedAt"
            type="datetime-local"
            required
            value={form.detectedAt}
            onChange={(event) => update("detectedAt", event.target.value)}
          />
        </label>
        <label>
          <span>SLA due at</span>
          <input
            aria-label="SLA due at"
            name="slaDueAt"
            type="datetime-local"
            required
            value={form.slaDueAt}
            onChange={(event) => update("slaDueAt", event.target.value)}
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
          {mutation.status === "pending" ? "Importing finding…" : ""}
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
            Import finding
          </button>
        </div>
      </form>
    </DialogLayer>
  );
}

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { components } from "../../lib/api/schema";

type OnboardingStatus = components["schemas"]["OnboardingStatus"];
type WorkspaceOrganization = components["schemas"]["WorkspaceOrganization"];
const WorkspaceContext = createContext<WorkspaceOrganization | null>(null);

export function useWorkspace(): WorkspaceOrganization | null {
  return useContext(WorkspaceContext);
}

async function readStatus(signal?: AbortSignal): Promise<OnboardingStatus> {
  const response = await fetch("/api/v1/onboarding", {
    credentials: "include",
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("Workspace status is unavailable.");
  return (await response.json()) as OnboardingStatus;
}

export function OnboardingGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [problem, setProblem] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<"empty" | "demo">("empty");

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      setProblem("");
      setStatus(await readStatus(signal));
    } catch (error) {
      if (signal?.aborted) return;
      setProblem(
        error instanceof Error
          ? error.message
          : "Workspace status is unavailable.",
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  async function initialize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setProblem("");
    try {
      const data = new FormData(event.currentTarget);
      const mode = data.get("mode") === "demo" ? "demo" : "empty";
      const response = await fetch("/api/v1/onboarding", {
        method: "POST",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(
          mode === "demo"
            ? { mode }
            : {
                mode,
                organization_name: String(data.get("organization_name") ?? ""),
                organization_slug: String(data.get("organization_slug") ?? ""),
              },
        ),
      });
      if (!response.ok) throw new Error("Workspace initialization failed.");
      setStatus((await response.json()) as OnboardingStatus);
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "Workspace initialization failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (status?.initialized && status.organization) {
    return (
      <WorkspaceContext.Provider value={status.organization}>
        {children}
      </WorkspaceContext.Provider>
    );
  }

  if (!status && !problem) {
    return (
      <main className="auth-screen" aria-busy="true">
        <p>Checking your Remedence workspace…</p>
      </main>
    );
  }

  if (!status) {
    return (
      <main className="auth-screen">
        <section className="auth-card" role="alert">
          <h1>Unable to load workspace setup</h1>
          <p>{problem}</p>
          <button
            className="button primary"
            type="button"
            onClick={() => void reload()}
          >
            Retry
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="onboarding-heading">
        <img
          src="/assets/brand/remedence-logo-primary-ui.png"
          alt="Remedence"
          width={360}
          height={120}
        />
        <div>
          <p className="eyebrow">First launch</p>
          <h1 id="onboarding-heading">Create your workspace</h1>
          <p>
            Start with an empty organization or explicitly install the
            Harborline demo.
          </p>
        </div>
        <form onSubmit={(event) => void initialize(event)}>
          <label>
            Setup choice
            <select
              name="mode"
              value={mode}
              onChange={(event) =>
                setMode(event.target.value === "demo" ? "demo" : "empty")
              }
            >
              <option value="empty">Empty workspace</option>
              <option value="demo">Harborline demo data</option>
            </select>
          </label>
          {mode === "empty" ? (
            <>
              <label>
                Organization name
                <input
                  name="organization_name"
                  defaultValue="My organization"
                  required
                />
              </label>
              <label>
                Organization slug
                <input
                  name="organization_slug"
                  defaultValue="my-organization"
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  required
                />
              </label>
            </>
          ) : null}
          {problem ? (
            <p className="auth-problem" role="alert">
              {problem}
            </p>
          ) : null}
          <button
            className="button primary"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Creating workspace…" : "Continue"}
          </button>
        </form>
      </section>
    </main>
  );
}

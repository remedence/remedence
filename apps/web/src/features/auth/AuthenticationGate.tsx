import { createAuthClient } from "better-auth/client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
}

interface AuthenticationStatus {
  mode: "local" | "required";
  authenticated: boolean;
  user: AuthenticatedUser | null;
}

interface AuthenticationContextValue extends AuthenticationStatus {
  signOut: () => Promise<void>;
}

const authClient = createAuthClient({ baseURL: window.location.origin });
const AuthenticationContext = createContext<AuthenticationContextValue>({
  mode: "local",
  authenticated: true,
  user: null,
  signOut: async () => undefined,
});

async function loadStatus(signal?: AbortSignal): Promise<AuthenticationStatus> {
  const response = await fetch("/api/auth/remedence-status", {
    credentials: "include",
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("Authentication status is unavailable.");
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("mode" in body) ||
    (body.mode !== "local" && body.mode !== "required") ||
    !("authenticated" in body) ||
    typeof body.authenticated !== "boolean" ||
    !("user" in body) ||
    (body.user !== null &&
      (typeof body.user !== "object" ||
        !("id" in body.user) ||
        typeof body.user.id !== "string" ||
        !("name" in body.user) ||
        typeof body.user.name !== "string" ||
        !("email" in body.user) ||
        typeof body.user.email !== "string"))
  ) {
    throw new Error("Authentication status is unavailable.");
  }
  return body as AuthenticationStatus;
}

export function useAuthentication(): AuthenticationContextValue {
  return useContext(AuthenticationContext);
}

export function AuthenticationGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthenticationStatus | null>(null);
  const [problem, setProblem] = useState("");

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      setProblem("");
      setStatus(await loadStatus(signal));
    } catch (error) {
      if (signal?.aborted) return;
      setProblem(
        error instanceof Error
          ? error.message
          : "Authentication status is unavailable.",
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const signOut = useCallback(async () => {
    const result = await authClient.signOut();
    if (result.error) {
      setProblem("Sign out failed. Your session may still be active.");
      return;
    }
    await reload();
  }, [reload]);

  if (problem) {
    return (
      <main className="auth-screen">
        <section className="auth-card" role="alert">
          <h1>Unable to verify your session</h1>
          <p>{problem}</p>
          <button
            type="button"
            className="button primary"
            onClick={() => void reload()}
          >
            Retry
          </button>
        </section>
      </main>
    );
  }

  if (!status) {
    return (
      <main className="auth-screen" aria-busy="true">
        <p>Checking your Remedence session…</p>
      </main>
    );
  }

  if (status.mode === "required" && !status.authenticated) {
    return <SignIn onAuthenticated={reload} />;
  }

  return (
    <AuthenticationContext.Provider value={{ ...status, signOut }}>
      {children}
    </AuthenticationContext.Provider>
  );
}

function SignIn({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setProblem("");
    try {
      const data = new FormData(event.currentTarget);
      const result = await authClient.signIn.email({
        email: String(data.get("email") ?? ""),
        password: String(data.get("password") ?? ""),
        rememberMe: false,
      });
      if (result.error) {
        setProblem("The email or password was not accepted.");
        return;
      }
      await onAuthenticated();
    } catch {
      setProblem("The email or password was not accepted.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="sign-in-heading">
        <img
          src="/assets/brand/remedence-logo-primary-ui.png"
          alt="Remedence"
          width={360}
          height={120}
        />
        <div>
          <p className="eyebrow">Secure workspace</p>
          <h1 id="sign-in-heading">Sign in to Remedence</h1>
          <p>Use the owner account provisioned by your Remedence operator.</p>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
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
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

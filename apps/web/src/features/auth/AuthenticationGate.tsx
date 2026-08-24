import { ssoClient } from "@better-auth/sso/client";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
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
  mfa: { required: boolean; enrolled: boolean };
  password_reset_enabled: boolean;
  federation_protocols: Array<"oidc" | "saml">;
}

interface AuthenticationContextValue extends AuthenticationStatus {
  signOut: () => Promise<void>;
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<string | null>;
  disableMfa: (password: string) => Promise<string | null>;
}

const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [twoFactorClient(), ssoClient()],
});
const AuthenticationContext = createContext<AuthenticationContextValue>({
  mode: "local",
  authenticated: true,
  user: null,
  mfa: { required: false, enrolled: false },
  password_reset_enabled: false,
  federation_protocols: [],
  signOut: async () => undefined,
  changePassword: async () => "Account controls are unavailable.",
  disableMfa: async () => "Account controls are unavailable.",
});

function isAuthenticationStatus(body: unknown): body is AuthenticationStatus {
  if (typeof body !== "object" || body === null) return false;
  const value = body as Record<string, unknown>;
  const user = value.user as Record<string, unknown> | null;
  const mfa = value.mfa as Record<string, unknown> | null;
  return (
    (value.mode === "local" || value.mode === "required") &&
    typeof value.authenticated === "boolean" &&
    (user === null ||
      (typeof user === "object" &&
        typeof user.id === "string" &&
        typeof user.name === "string" &&
        typeof user.email === "string")) &&
    typeof mfa === "object" &&
    mfa !== null &&
    typeof mfa.required === "boolean" &&
    typeof mfa.enrolled === "boolean" &&
    typeof value.password_reset_enabled === "boolean" &&
    Array.isArray(value.federation_protocols) &&
    value.federation_protocols.every(
      (protocol) => protocol === "oidc" || protocol === "saml",
    )
  );
}

async function loadStatus(signal?: AbortSignal): Promise<AuthenticationStatus> {
  const response = await fetch("/api/auth/remedence-status", {
    credentials: "include",
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("Authentication status is unavailable.");
  const body: unknown = await response.json();
  if (!isAuthenticationStatus(body)) {
    throw new Error("Authentication status is unavailable.");
  }
  return body;
}

export function useAuthentication(): AuthenticationContextValue {
  return useContext(AuthenticationContext);
}

export function AuthenticationGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthenticationStatus | null>(null);
  const [problem, setProblem] = useState("");
  const [twoFactorChallenge, setTwoFactorChallenge] = useState(false);
  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      setProblem("");
      setStatus(await loadStatus(signal));
    } catch (error) {
      if (!signal?.aborted) {
        setProblem(
          error instanceof Error
            ? error.message
            : "Authentication status is unavailable.",
        );
      }
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

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      return result.error
        ? "Password change failed. Check the current password and requirements."
        : null;
    },
    [],
  );

  const disableMfa = useCallback(
    async (password: string) => {
      const result = await authClient.twoFactor.disable({ password });
      if (result.error) return "MFA could not be disabled.";
      await reload();
      return null;
    },
    [reload],
  );

  if (problem) {
    return (
      <AuthCard title="Unable to verify your session">
        <p role="alert">{problem}</p>
        <button
          type="button"
          className="button primary"
          onClick={() => void reload()}
        >
          Retry
        </button>
      </AuthCard>
    );
  }
  if (!status)
    return (
      <main className="auth-screen" aria-busy="true">
        <p>Checking your Remedence session…</p>
      </main>
    );

  const resetToken = new URLSearchParams(window.location.search).get("token");
  if (resetToken) return <ResetPassword token={resetToken} />;
  if (twoFactorChallenge) {
    return (
      <TwoFactorChallenge
        onVerified={async () => {
          setTwoFactorChallenge(false);
          await reload();
        }}
      />
    );
  }
  if (status.mode === "required" && !status.authenticated) {
    return (
      <SignIn
        status={status}
        onAuthenticated={reload}
        onTwoFactorRequired={() => setTwoFactorChallenge(true)}
      />
    );
  }
  if (
    status.mode === "required" &&
    status.mfa.required &&
    !status.mfa.enrolled
  ) {
    return <MfaEnrollment onEnrolled={reload} />;
  }

  return (
    <AuthenticationContext.Provider
      value={{ ...status, signOut, changePassword, disableMfa }}
    >
      {children}
    </AuthenticationContext.Provider>
  );
}

function SignIn({
  status,
  onAuthenticated,
  onTwoFactorRequired,
}: {
  status: AuthenticationStatus;
  onAuthenticated: () => Promise<void>;
  onTwoFactorRequired: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState("");
  const [recovery, setRecovery] = useState(false);

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
      if (result.error) setProblem("The email or password was not accepted.");
      else if (
        result.data &&
        "twoFactorRedirect" in result.data &&
        result.data.twoFactorRedirect
      )
        onTwoFactorRequired();
      else await onAuthenticated();
    } catch {
      setProblem("The email or password was not accepted.");
    } finally {
      setSubmitting(false);
    }
  }

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/`,
    });
    setProblem("If that account exists, a reset link has been sent.");
    setSubmitting(false);
  }

  async function signInWithSso(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const email = String(
      new FormData(event.currentTarget).get("sso-email") ?? "",
    );
    const result = await authClient.signIn.sso({
      email,
      callbackURL: window.location.origin,
      errorCallbackURL: window.location.origin,
    });
    if (result.error) {
      setProblem("No configured identity provider accepted that account.");
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Sign in to Remedence">
      <p>Use the account provisioned by your Remedence operator.</p>
      {recovery ? (
        <form onSubmit={(event) => void requestReset(event)}>
          <label>
            Account email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          {problem ? (
            <p className="auth-problem" role="status">
              {problem}
            </p>
          ) : null}
          <button
            className="button primary"
            type="submit"
            disabled={submitting}
          >
            Send reset link
          </button>
          <button
            className="button"
            type="button"
            onClick={() => setRecovery(false)}
          >
            Back to sign in
          </button>
        </form>
      ) : (
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
          {status.password_reset_enabled ? (
            <button
              className="button"
              type="button"
              onClick={() => setRecovery(true)}
            >
              Forgot password?
            </button>
          ) : null}
        </form>
      )}
      {status.federation_protocols.length ? (
        <form onSubmit={(event) => void signInWithSso(event)}>
          <label>
            Work email for SSO
            <input
              name="sso-email"
              type="email"
              autoComplete="email"
              required
            />
          </label>
          <button className="button" type="submit" disabled={submitting}>
            Continue with SSO
          </button>
        </form>
      ) : null}
    </AuthCard>
  );
}

function TwoFactorChallenge({
  onVerified,
}: {
  onVerified: () => Promise<void>;
}) {
  const [problem, setProblem] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    const result = await authClient.twoFactor.verifyTotp({
      code,
      trustDevice: false,
    });
    if (result.error) setProblem("The verification code was not accepted.");
    else await onVerified();
  }
  return (
    <AuthCard title="Verify your sign-in">
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Authenticator code
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
          />
        </label>
        {problem ? (
          <p className="auth-problem" role="alert">
            {problem}
          </p>
        ) : null}
        <button className="button primary" type="submit">
          Verify
        </button>
      </form>
    </AuthCard>
  );
}

function MfaEnrollment({ onEnrolled }: { onEnrolled: () => Promise<void> }) {
  const [setup, setSetup] = useState<{
    uri: string;
    backupCodes: string[];
  } | null>(null);
  const [problem, setProblem] = useState("");
  async function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(
      new FormData(event.currentTarget).get("password") ?? "",
    );
    const result = await authClient.twoFactor.enable({
      password,
      method: "totp",
    });
    if (result.error || !result.data || !("totpURI" in result.data))
      setProblem("MFA enrollment could not be started.");
    else
      setSetup({
        uri: result.data.totpURI,
        backupCodes: result.data.backupCodes,
      });
  }
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    const result = await authClient.twoFactor.verifyTotp({
      code,
      trustDevice: false,
    });
    if (result.error) setProblem("The verification code was not accepted.");
    else await onEnrolled();
  }
  return (
    <AuthCard title="Protect your account">
      {!setup ? (
        <form onSubmit={(event) => void begin(event)}>
          <p>
            Your organization requires an authenticator app before workspace
            access.
          </p>
          <label>
            Current password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="button primary" type="submit">
            Set up MFA
          </button>
        </form>
      ) : (
        <form onSubmit={(event) => void verify(event)}>
          <p>Import this setup URI into your authenticator:</p>
          <code>{setup.uri}</code>
          <p>
            Store these one-time backup codes securely:{" "}
            {setup.backupCodes.join(" · ")}
          </p>
          <label>
            Authenticator code
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </label>
          <button className="button primary" type="submit">
            Finish enrollment
          </button>
        </form>
      )}
      {problem ? (
        <p className="auth-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </AuthCard>
  );
}

function ResetPassword({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(
      new FormData(event.currentTarget).get("password") ?? "",
    );
    const result = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    setMessage(
      result.error
        ? "The reset link is invalid or expired."
        : "Password changed. Return to sign in.",
    );
  }
  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={(event) => void submit(event)}>
        <label>
          New password
          <input
            name="password"
            type="password"
            minLength={12}
            autoComplete="new-password"
            required
          />
        </label>
        <button className="button primary" type="submit">
          Change password
        </button>
      </form>
      {message ? <p role="status">{message}</p> : null}
    </AuthCard>
  );
}

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <img
          src="/assets/brand/remedence-logo-primary-ui.png"
          alt="Remedence"
          width={360}
          height={120}
        />
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}

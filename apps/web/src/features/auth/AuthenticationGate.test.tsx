import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationGate, useAuthentication } from "./AuthenticationGate";

const authMocks = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signInSso: vi.fn(),
  signOut: vi.fn(),
  changePassword: vi.fn(),
  disableMfa: vi.fn(),
  enableMfa: vi.fn(),
  verifyTotp: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
}));

vi.mock("better-auth/client", () => ({
  createAuthClient: () => ({
    signIn: { email: authMocks.signInEmail, sso: authMocks.signInSso },
    signOut: authMocks.signOut,
    changePassword: authMocks.changePassword,
    requestPasswordReset: authMocks.requestPasswordReset,
    resetPassword: authMocks.resetPassword,
    twoFactor: {
      disable: authMocks.disableMfa,
      enable: authMocks.enableMfa,
      verifyTotp: authMocks.verifyTotp,
    },
  }),
}));

function statusResponse(body: unknown): Response {
  return new Response(
    JSON.stringify({
      mfa: { required: false, enrolled: false },
      password_reset_enabled: false,
      federation_protocols: [],
      ...(body as Record<string, unknown>),
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("AuthenticationGate", () => {
  it("preserves the loopback-only local workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          statusResponse({ mode: "local", authenticated: true, user: null }),
        ),
    );

    render(
      <AuthenticationGate>
        <p>Local workspace</p>
      </AuthenticationGate>,
    );

    expect(await screen.findByText("Local workspace")).toBeInTheDocument();
  });

  it("shows a safe error when Better Auth rejects credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        statusResponse({
          mode: "required",
          authenticated: false,
          user: null,
        }),
      ),
    );
    authMocks.signInEmail.mockResolvedValue({
      data: null,
      error: { message: "credential detail must not be rendered" },
    });
    const user = userEvent.setup();

    render(
      <AuthenticationGate>
        <p>Protected workspace</p>
      </AuthenticationGate>,
    );

    await user.type(await screen.findByLabelText("Email"), "owner@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("The email or password was not accepted."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("credential detail must not be rendered"),
    ).toBeNull();
    expect(screen.queryByText("Protected workspace")).toBeNull();
  });

  it("renders the workspace after a successful session refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          statusResponse({
            mode: "required",
            authenticated: false,
            user: null,
          }),
        )
        .mockResolvedValueOnce(
          statusResponse({
            mode: "required",
            authenticated: true,
            user: {
              id: "user-owner",
              name: "Initial Owner",
              email: "owner@example.com",
            },
          }),
        ),
    );
    authMocks.signInEmail.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();

    render(
      <AuthenticationGate>
        <p>Protected workspace</p>
      </AuthenticationGate>,
    );

    await user.type(await screen.findByLabelText("Email"), "owner@example.com");
    await user.type(
      screen.getByLabelText("Password"),
      "correct-horse-battery-staple",
    );
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Protected workspace")).toBeInTheDocument();
    expect(authMocks.signInEmail).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "correct-horse-battery-staple",
      rememberMe: false,
    });
  });

  it("exposes a password change that revokes other sessions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        statusResponse({
          mode: "required",
          authenticated: true,
          user: {
            id: "user-owner",
            name: "Initial Owner",
            email: "owner@example.com",
          },
        }),
      ),
    );
    authMocks.changePassword.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();

    function AccountHarness() {
      const authentication = useAuthentication();
      return (
        <button
          type="button"
          onClick={() =>
            void authentication.changePassword(
              "current-password",
              "new-secure-password",
            )
          }
        >
          Change password
        </button>
      );
    }

    render(
      <AuthenticationGate>
        <AccountHarness />
      </AuthenticationGate>,
    );
    await user.click(
      await screen.findByRole("button", { name: "Change password" }),
    );

    expect(authMocks.changePassword).toHaveBeenCalledWith({
      currentPassword: "current-password",
      newPassword: "new-secure-password",
      revokeOtherSessions: true,
    });
  });

  it("requests password recovery without disclosing account existence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        statusResponse({
          mode: "required",
          authenticated: false,
          user: null,
          password_reset_enabled: true,
        }),
      ),
    );
    authMocks.requestPasswordReset.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();

    render(
      <AuthenticationGate>
        <p>Protected workspace</p>
      </AuthenticationGate>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Forgot password?" }),
    );
    await user.type(
      screen.getByLabelText("Account email"),
      "owner@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(authMocks.requestPasswordReset).toHaveBeenCalledWith({
      email: "owner@example.com",
      redirectTo: window.location.origin + "/",
    });
    expect(
      await screen.findByText(
        "If that account exists, a reset link has been sent.",
      ),
    ).toBeInTheDocument();
  });

  it("completes a reset link without rendering provider errors", async () => {
    window.history.replaceState({}, "", "/?token=one-time-reset-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        statusResponse({
          mode: "required",
          authenticated: false,
          user: null,
        }),
      ),
    );
    authMocks.resetPassword.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();

    render(
      <AuthenticationGate>
        <p>Protected workspace</p>
      </AuthenticationGate>,
    );

    await user.type(
      await screen.findByLabelText("New password"),
      "new-secure-password",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(authMocks.resetPassword).toHaveBeenCalledWith({
      newPassword: "new-secure-password",
      token: "one-time-reset-token",
    });
    expect(
      await screen.findByText("Password changed. Return to sign in."),
    ).toBeInTheDocument();
  });

  it("finishes a sign-in TOTP challenge before rendering the workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          statusResponse({
            mode: "required",
            authenticated: false,
            user: null,
          }),
        )
        .mockResolvedValueOnce(
          statusResponse({
            mode: "required",
            authenticated: true,
            user: {
              id: "user-owner",
              name: "Initial Owner",
              email: "owner@example.com",
            },
            mfa: { required: true, enrolled: true },
          }),
        ),
    );
    authMocks.signInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true },
      error: null,
    });
    authMocks.verifyTotp.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();

    render(
      <AuthenticationGate>
        <p>Protected workspace</p>
      </AuthenticationGate>,
    );

    await user.type(await screen.findByLabelText("Email"), "owner@example.com");
    await user.type(screen.getByLabelText("Password"), "current-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.type(
      await screen.findByLabelText("Authenticator code"),
      "123456",
    );
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(authMocks.verifyTotp).toHaveBeenCalledWith({
      code: "123456",
      trustDevice: false,
    });
    expect(await screen.findByText("Protected workspace")).toBeInTheDocument();
  });

  it("requires TOTP enrollment before an authenticated user enters the workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          statusResponse({
            mode: "required",
            authenticated: true,
            user: {
              id: "user-owner",
              name: "Initial Owner",
              email: "owner@example.com",
            },
            mfa: { required: true, enrolled: false },
          }),
        )
        .mockResolvedValueOnce(
          statusResponse({
            mode: "required",
            authenticated: true,
            user: {
              id: "user-owner",
              name: "Initial Owner",
              email: "owner@example.com",
            },
            mfa: { required: true, enrolled: true },
          }),
        ),
    );
    authMocks.enableMfa.mockResolvedValue({
      data: {
        totpURI: "otpauth://totp/Remedence:owner",
        backupCodes: ["backup-one", "backup-two"],
      },
      error: null,
    });
    authMocks.verifyTotp.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();

    render(
      <AuthenticationGate>
        <p>Protected workspace</p>
      </AuthenticationGate>,
    );

    await user.type(
      await screen.findByLabelText("Current password"),
      "current-password",
    );
    await user.click(screen.getByRole("button", { name: "Set up MFA" }));
    expect(await screen.findByText(/backup-one/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Authenticator code"), "654321");
    await user.click(screen.getByRole("button", { name: "Finish enrollment" }));

    expect(authMocks.enableMfa).toHaveBeenCalledWith({
      password: "current-password",
      method: "totp",
    });
    expect(await screen.findByText("Protected workspace")).toBeInTheDocument();
  });

  it("routes workforce sign-in through the configured SSO provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        statusResponse({
          mode: "required",
          authenticated: false,
          user: null,
          federation_protocols: ["oidc", "saml"],
        }),
      ),
    );
    authMocks.signInSso.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();

    render(
      <AuthenticationGate>
        <p>Protected workspace</p>
      </AuthenticationGate>,
    );

    await user.type(
      await screen.findByLabelText("Work email for SSO"),
      "owner@enterprise.example",
    );
    await user.click(screen.getByRole("button", { name: "Continue with SSO" }));

    expect(authMocks.signInSso).toHaveBeenCalledWith({
      email: "owner@enterprise.example",
      callbackURL: window.location.origin,
      errorCallbackURL: window.location.origin,
    });
  });
});

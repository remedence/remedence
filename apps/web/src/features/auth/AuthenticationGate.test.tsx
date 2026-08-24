import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationGate } from "./AuthenticationGate";

const authMocks = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("better-auth/client", () => ({
  createAuthClient: () => ({
    signIn: { email: authMocks.signInEmail },
    signOut: authMocks.signOut,
  }),
}));

function statusResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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
});

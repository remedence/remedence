import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingGate } from "./OnboardingGate";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OnboardingGate", () => {
  it("offers an empty workspace by default and continues after durable initialization", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            initialized: false,
            mode: null,
            organization: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            initialized: true,
            mode: "empty",
            organization: {
              id: "org-local-workspace",
              name: "Northstar Security",
              slug: "northstar-security",
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <OnboardingGate>
        <p>Workspace ready</p>
      </OnboardingGate>,
    );

    expect(
      await screen.findByRole("heading", { name: "Create your workspace" }),
    ).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Organization name"));
    await user.type(
      screen.getByLabelText("Organization name"),
      "Northstar Security",
    );
    await user.clear(screen.getByLabelText("Organization slug"));
    await user.type(
      screen.getByLabelText("Organization slug"),
      "northstar-security",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Workspace ready")).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      mode: "empty",
      organization_name: "Northstar Security",
      organization_slug: "northstar-security",
    });
  });

  it("requires an explicit demo selection and omits organization fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          initialized: false,
          mode: null,
          organization: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <OnboardingGate>
        <p>Workspace ready</p>
      </OnboardingGate>,
    );

    await user.selectOptions(
      await screen.findByLabelText("Setup choice"),
      "demo",
    );
    await waitFor(() =>
      expect(
        screen.queryByLabelText("Organization name"),
      ).not.toBeInTheDocument(),
    );
  });
});

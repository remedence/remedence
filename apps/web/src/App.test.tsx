import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("Remedence dashboard", () => {
  it("renders the approved demo metrics and highest-priority failure", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Managed companies 12/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Open findings 47/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Awaiting verification 8/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Verification failed 3/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Verified fixed 126/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /SLA breaches 4/i }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Secondary query path remains exploitable.").length,
    ).toBeGreaterThan(0);
  });

  it("preserves the failed first verification when the second verification passes", async () => {
    const user = userEvent.setup();
    render(<App />);

    const viewFinding = screen.getByRole("button", { name: "View finding" });
    await user.click(viewFinding);

    expect(
      screen.getByRole("dialog", { name: "Verify fix" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Verification #1 failed")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Run independent verification" }),
    );

    expect(
      screen.getAllByText("Verified fixed. Evidence bundle locked.")[0],
    ).toBeInTheDocument();
    expect(screen.getByText("Verification #1 failed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Open findings 46/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Verification failed 2/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Verified fixed 127/i }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "Notifications, 1 unread" }),
    );
    expect(
      screen.getByText("SEC-1042 verified fixed. Evidence bundle locked."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/SEC-1042 verification failed/i),
    ).not.toBeInTheDocument();
  });

  it("shows corrective validation for an incomplete local import", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Import findings" }));
    expect(
      screen.getByRole("dialog", { name: "Import findings" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Import finding" }));
    expect(
      screen.getByText("Finding ID and title are required before importing."),
    ).toBeInTheDocument();
  });

  it("rejects duplicate finding IDs case-insensitively", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Import findings" }));
    const dialog = screen.getByRole("dialog", { name: "Import findings" });
    await user.type(screen.getByLabelText("Finding ID"), "sec-1042");
    await user.type(
      screen.getByLabelText("Finding title"),
      "Duplicate finding",
    );
    await user.click(screen.getByRole("button", { name: "Import finding" }));

    expect(
      screen.getByText(
        "SEC-1042 already exists in this workspace. Use a different finding ID.",
      ),
    ).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
  });

  it("gives every sidebar destination meaningful content", async () => {
    const user = userEvent.setup();
    render(<App />);

    for (const destination of [
      "Companies",
      "Findings",
      "Remediation",
      "Verification",
      "Evidence",
      "Reports",
      "Integrations",
      "Settings",
      "Help",
      "Account",
    ]) {
      const navigationName =
        destination === "Verification" ? "Verification 8" : destination;
      await user.click(screen.getByRole("button", { name: navigationName }));
      expect(
        screen.getByRole("heading", { level: 1, name: destination }),
      ).toBeInTheDocument();
    }
  });
});

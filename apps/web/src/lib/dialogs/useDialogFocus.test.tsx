import { useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useDialogFocus } from "./useDialogFocus";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);

  useDialogFocus({
    open,
    layerRef,
    initialFocusRef,
    restoreFocusRef: triggerRef,
    onClose: () => setOpen(false),
  });

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <main data-testid="background">
        <button type="button">Background action</button>
      </main>
      {open ? (
        <div ref={layerRef} data-testid="layer">
          <section role="dialog" aria-label="Test dialog">
            <button ref={initialFocusRef} type="button">
              First action
            </button>
            <button type="button">Middle action</button>
            <button type="button">Last action</button>
          </section>
        </div>
      ) : null}
    </>
  );
}

describe("useDialogFocus", () => {
  it("inerts background content and moves focus into the dialog", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByRole("button", { name: "Open dialog" }));

    expect(screen.getByTestId("background")).toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "Open dialog" })).toHaveAttribute(
      "inert",
    );
    expect(screen.getByRole("button", { name: "First action" })).toHaveFocus();
  });

  it("wraps forward and reverse Tab navigation inside the dialog", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "Open dialog" }));

    const first = screen.getByRole("button", { name: "First action" });
    const last = screen.getByRole("button", { name: "Last action" });

    last.focus();
    await user.keyboard("{Tab}");
    expect(first).toHaveFocus();

    first.focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(last).toHaveFocus();
  });

  it("recovers when focus leaves the layer before keyboard input", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });

    await user.click(trigger);
    trigger.focus();
    await user.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: "First action" })).toHaveFocus();

    trigger.focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Test dialog" })).toBeNull();
  });

  it("closes on Escape, restores the background, and returns focus", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    const background = screen.getByTestId("background");

    await user.click(trigger);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Test dialog" })).toBeNull();
    expect(background).not.toHaveAttribute("inert");
    expect(trigger).not.toHaveAttribute("inert");
    expect(trigger).toHaveFocus();
  });
});

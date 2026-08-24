import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeWorkspacePreferences } from "../../features/preferences/workspace-preferences";
import { useApiQuery } from "./useApiQuery";

function Harness({
  loader,
}: {
  loader: (signal: AbortSignal) => Promise<string>;
}) {
  const query = useApiQuery(loader, []);
  return <div>{query.data ?? query.status}</div>;
}

describe("useApiQuery", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("aborts the active request when the consumer unmounts", async () => {
    let observedSignal: AbortSignal | undefined;
    const loader = vi.fn((signal: AbortSignal) => {
      observedSignal = signal;
      return new Promise<string>(() => undefined);
    });

    const view = render(<Harness loader={loader} />);
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(observedSignal?.aborted).toBe(false);

    view.unmount();

    expect(observedSignal?.aborted).toBe(true);
  });

  it("revalidates visible data when the browser regains focus", async () => {
    writeWorkspacePreferences({ refreshSeconds: 0, density: "comfortable" });
    const loader = vi.fn().mockResolvedValue("current");
    render(<Harness loader={loader} />);
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));

    fireEvent.focus(window);

    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    expect(screen.getByText("current")).toBeInTheDocument();
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
});

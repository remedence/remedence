import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiProblemError } from "./problems";
import { useApiMutation } from "./useApiMutation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("useApiMutation", () => {
  it("suppresses duplicate submissions while one request is pending", async () => {
    const request = deferred<string>();
    const mutator = vi.fn(
      async (_input: string, _signal: AbortSignal) => request.promise,
    );
    const { result } = renderHook(() => useApiMutation(mutator));

    let first!: Promise<string | undefined>;
    let second!: Promise<string | undefined>;
    await act(async () => {
      first = result.current.mutate("first");
      second = result.current.mutate("second");
      await Promise.resolve();
    });

    expect(mutator).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("pending");
    await expect(second).resolves.toBeUndefined();

    await act(async () => {
      request.resolve("persisted");
      await first;
    });

    expect(result.current.status).toBe("success");
    expect(result.current.data).toBe("persisted");
  });

  it("preserves structured API problems including request IDs", async () => {
    const problem = {
      type: "about:blank",
      title: "Conflict",
      status: 409,
      detail: "The persisted record conflicts with the request.",
      instance: "/api/v1/remediations",
      code: "CONFLICT",
      request_id: "req-mutation-409",
    };
    const { result } = renderHook(() =>
      useApiMutation(async () => {
        throw new ApiProblemError(problem);
      }),
    );

    await act(async () => {
      await result.current.mutate(undefined);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.problem).toEqual(problem);
  });

  it("sanitizes unknown local failures instead of exposing raw error content", async () => {
    const { result } = renderHook(() =>
      useApiMutation(async () => {
        throw new Error("C:\\Users\\operator\\secret.env TOKEN=private");
      }),
    );

    await act(async () => {
      await result.current.mutate(undefined);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.problem?.code).toBe("LOCAL_API_UNAVAILABLE");
    expect(result.current.problem?.detail).not.toContain("secret.env");
    expect(result.current.problem?.detail).not.toContain("TOKEN");
  });

  it("aborts its active request only when the component unmounts", async () => {
    let observedSignal: AbortSignal | undefined;
    const mutator = vi.fn(
      (_input: string, signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          observedSignal = signal;
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const { result, unmount } = renderHook(() => useApiMutation(mutator));

    let pending!: Promise<string | undefined>;
    await act(async () => {
      pending = result.current.mutate("persist me");
      await Promise.resolve();
    });

    expect(observedSignal?.aborted).toBe(false);
    unmount();
    expect(observedSignal?.aborted).toBe(true);
    await expect(pending).resolves.toBeUndefined();
  });

  it("resets completed state without aborting a request", async () => {
    const mutator = vi.fn(async () => "saved");
    const { result } = renderHook(() => useApiMutation(mutator));

    await act(async () => {
      await result.current.mutate(undefined);
    });
    expect(result.current.status).toBe("success");

    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
    expect(result.current.data).toBeUndefined();
    expect(result.current.problem).toBeUndefined();
  });
});

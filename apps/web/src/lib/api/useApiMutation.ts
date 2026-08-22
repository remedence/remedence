import { useCallback, useEffect, useRef, useState } from "react";
import { problemFromUnknown, type ApiProblem } from "./problems";

export interface MutationState<T> {
  status: "idle" | "pending" | "success" | "error";
  data?: T;
  problem?: ApiProblem;
}

export interface ApiMutation<I, T> extends MutationState<T> {
  mutate: (input: I) => Promise<T | undefined>;
  reset: () => void;
}

export function useApiMutation<I, T>(
  mutator: (input: I, signal: AbortSignal) => Promise<T>,
): ApiMutation<I, T> {
  const [state, setState] = useState<MutationState<T>>({ status: "idle" });
  const mutatorRef = useRef(mutator);
  const requestIdRef = useRef(0);
  const pendingRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  mutatorRef.current = mutator;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      controllerRef.current?.abort();
    };
  }, []);

  const mutate = useCallback(async (input: I): Promise<T | undefined> => {
    if (pendingRef.current) return undefined;

    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    pendingRef.current = true;
    setState({ status: "pending" });

    try {
      const data = await mutatorRef.current(input, controller.signal);
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        requestId !== requestIdRef.current
      ) {
        return undefined;
      }
      setState({ status: "success", data });
      return data;
    } catch (error: unknown) {
      if (
        mountedRef.current &&
        !controller.signal.aborted &&
        requestId === requestIdRef.current
      ) {
        setState({ status: "error", problem: problemFromUnknown(error) });
      }
      return undefined;
    } finally {
      if (requestId === requestIdRef.current) {
        pendingRef.current = false;
        controllerRef.current = null;
      }
    }
  }, []);

  const reset = useCallback(() => {
    if (pendingRef.current) return;
    requestIdRef.current += 1;
    setState({ status: "idle" });
  }, []);

  return { ...state, mutate, reset };
}

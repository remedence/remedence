import { useCallback, useEffect, useRef, useState } from "react";
import type { DependencyList } from "react";
import { problemFromUnknown, type ApiProblem } from "./problems";

export interface QueryState<T> {
  status: "idle" | "loading" | "success" | "error";
  data?: T;
  problem?: ApiProblem;
  reload: () => void;
}

function dependenciesEqual(
  left: DependencyList | undefined,
  right: DependencyList,
): boolean {
  if (!left || left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message === "The operation was aborted.")
  );
}

export function useApiQuery<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  dependencies: DependencyList,
): QueryState<T> {
  const [state, setState] = useState<Omit<QueryState<T>, "reload">>({
    status: "idle",
  });
  const [reloadVersion, setReloadVersion] = useState(0);
  const loaderRef = useRef(loader);
  const dependenciesRef = useRef<DependencyList | undefined>(undefined);
  const dependencyVersionRef = useRef(0);
  const requestIdRef = useRef(0);

  loaderRef.current = loader;
  if (!dependenciesEqual(dependenciesRef.current, dependencies)) {
    dependenciesRef.current = [...dependencies];
    dependencyVersionRef.current += 1;
  }
  const dependencyVersion = dependencyVersionRef.current;

  const reload = useCallback(() => {
    setReloadVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    setState((current) => ({ status: "loading", data: current.data }));

    void loaderRef
      .current(controller.signal)
      .then((data) => {
        if (controller.signal.aborted || requestId !== requestIdRef.current) {
          return;
        }
        setState({ status: "success", data });
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          requestId !== requestIdRef.current ||
          isAbortError(error)
        ) {
          return;
        }
        setState({ status: "error", problem: problemFromUnknown(error) });
      });

    return () => {
      controller.abort();
    };
  }, [dependencyVersion, reloadVersion]);

  return { ...state, reload };
}

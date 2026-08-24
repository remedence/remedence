import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

Object.defineProperty(window, "scrollTo", {
  value: () => undefined,
  writable: true,
});

const storage = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  value: {
    get length() {
      return storage.size;
    },
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    key: (index: number) => [...storage.keys()][index] ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, String(value)),
  } satisfies Storage,
  configurable: true,
});

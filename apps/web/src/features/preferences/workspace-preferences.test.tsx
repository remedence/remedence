import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  readWorkspacePreferences,
  useWorkspacePreferences,
} from "./workspace-preferences";

afterEach(() => window.localStorage.clear());

describe("workspace preferences", () => {
  it("falls back safely when persisted preferences are malformed", () => {
    window.localStorage.setItem(
      "remedence.workspace-preferences.v1",
      "not-json",
    );
    expect(readWorkspacePreferences()).toEqual(DEFAULT_WORKSPACE_PREFERENCES);
  });

  it("persists changes and updates active consumers", () => {
    const { result } = renderHook(() => useWorkspacePreferences());
    act(() => {
      result.current[1]({ refreshSeconds: 30, density: "compact" });
    });
    expect(result.current[0]).toEqual({
      refreshSeconds: 30,
      density: "compact",
    });
    expect(readWorkspacePreferences()).toEqual(result.current[0]);
  });
});

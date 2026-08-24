import { useEffect, useState } from "react";

export const WORKSPACE_PREFERENCES_EVENT = "remedence:preferences-changed";
const STORAGE_KEY = "remedence.workspace-preferences.v1";

export type RefreshSeconds = 0 | 15 | 30 | 60;
export type DisplayDensity = "comfortable" | "compact";

export interface WorkspacePreferences {
  refreshSeconds: RefreshSeconds;
  density: DisplayDensity;
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  refreshSeconds: 15,
  density: "comfortable",
};

function isRefreshSeconds(value: unknown): value is RefreshSeconds {
  return value === 0 || value === 15 || value === 30 || value === 60;
}

function isDisplayDensity(value: unknown): value is DisplayDensity {
  return value === "comfortable" || value === "compact";
}

export function readWorkspacePreferences(): WorkspacePreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WORKSPACE_PREFERENCES;
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      refreshSeconds: isRefreshSeconds(value.refreshSeconds)
        ? value.refreshSeconds
        : DEFAULT_WORKSPACE_PREFERENCES.refreshSeconds,
      density: isDisplayDensity(value.density)
        ? value.density
        : DEFAULT_WORKSPACE_PREFERENCES.density,
    };
  } catch {
    return DEFAULT_WORKSPACE_PREFERENCES;
  }
}

export function writeWorkspacePreferences(
  preferences: WorkspacePreferences,
): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage can be disabled by browser policy; keep safe defaults active.
  }
  window.dispatchEvent(
    new CustomEvent<WorkspacePreferences>(WORKSPACE_PREFERENCES_EVENT, {
      detail: preferences,
    }),
  );
}

export function useWorkspacePreferences(): [
  WorkspacePreferences,
  (preferences: WorkspacePreferences) => void,
] {
  const [preferences, setPreferences] = useState(readWorkspacePreferences);

  useEffect(() => {
    const refresh = () => setPreferences(readWorkspacePreferences());
    window.addEventListener("storage", refresh);
    window.addEventListener(WORKSPACE_PREFERENCES_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(WORKSPACE_PREFERENCES_EVENT, refresh);
    };
  }, []);

  return [preferences, writeWorkspacePreferences];
}

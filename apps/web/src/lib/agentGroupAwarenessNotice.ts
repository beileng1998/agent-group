const STORAGE_KEY = "agent-group:awareness-explanation-dismissed:v1";

export function shouldShowAgentGroupAwarenessNotice(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "1";
  } catch {
    return true;
  }
}

export function dismissAgentGroupAwarenessNotice(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // The explanation can safely appear again when browser storage is unavailable.
  }
}

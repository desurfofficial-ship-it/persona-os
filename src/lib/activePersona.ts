/**
 * Active voice: the ONE persona the user is currently posting as.
 * Kept in localStorage — it's a device-level preference, not shared data.
 * The dashboard switcher and the generate page both read/write it.
 */

const KEY = "persona-os-active-persona";

export function getActivePersonaId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}

export function setActivePersonaId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(KEY, id);
  else window.localStorage.removeItem(KEY);
}

/**
 * Resolve the active persona id against a persona list:
 * - stored id wins if it still exists
 * - otherwise fall back to null (caller decides its own default)
 */
export function resolveActivePersonaId(personas: { id: string }[]): string | null {
  const stored = getActivePersonaId();
  if (stored && personas.some((p) => p.id === stored)) return stored;
  return null;
}

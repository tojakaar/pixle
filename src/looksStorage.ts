import type { EditParameters } from "./engine";
import type { Look } from "./engine/looks";

const STORAGE_KEY = "pixle.savedLooks.v1";

interface StoredLook {
  id: string;
  name: string;
  parameters: EditParameters;
  createdAt: number;
}

function isEditParameters(value: unknown): value is EditParameters {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.exposure === "number" &&
    typeof p.contrast === "number" &&
    typeof p.highlights === "number" &&
    typeof p.shadows === "number" &&
    typeof p.temperature === "number" &&
    typeof p.tint === "number" &&
    typeof p.saturation === "number"
  );
}

function parseStored(raw: string | null): StoredLook[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is StoredLook => {
      if (!item || typeof item !== "object") return false;
      const look = item as Record<string, unknown>;
      return (
        typeof look.id === "string" &&
        typeof look.name === "string" &&
        typeof look.createdAt === "number" &&
        isEditParameters(look.parameters)
      );
    });
  } catch {
    return [];
  }
}

/** Load user-saved looks from local device storage. */
export function loadSavedLooks(): Look[] {
  if (typeof localStorage === "undefined") return [];
  return parseStored(localStorage.getItem(STORAGE_KEY)).map((look) => ({
    id: look.id,
    name: look.name,
    parameters: { ...look.parameters },
    builtin: false,
  }));
}

function writeStored(looks: StoredLook[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(looks));
}

/**
 * Persist a new custom look (parameters only).
 * Returns the saved Look, or null if the name was empty.
 */
export function saveLook(
  name: string,
  parameters: EditParameters,
): Look | null {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const stored: StoredLook = {
    id: `custom:${crypto.randomUUID()}`,
    name: trimmed,
    parameters: { ...parameters },
    createdAt: Date.now(),
  };

  const existing = parseStored(localStorage.getItem(STORAGE_KEY));
  writeStored([stored, ...existing]);

  return {
    id: stored.id,
    name: stored.name,
    parameters: { ...stored.parameters },
    builtin: false,
  };
}

/** Remove a custom look by id. Built-ins cannot be deleted this way. */
export function deleteSavedLook(id: string): void {
  if (id.startsWith("builtin:")) return;
  const existing = parseStored(localStorage.getItem(STORAGE_KEY));
  writeStored(existing.filter((look) => look.id !== id));
}

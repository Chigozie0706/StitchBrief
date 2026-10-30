import type { SavedBrief } from "./types";
import { formatUpdated } from "./brief";

const KEY = "stitchbrief:drafts:v2";
type StoreLike = Pick<Storage, "getItem" | "setItem">;
export type SaveOutcome = { ok: boolean; imageStored: boolean; error?: string };

function defaultStore(): StoreLike | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function loadDrafts(store: StoreLike | null = defaultStore()): SavedBrief[] {
  if (!store) return [];
  try {
    const raw = JSON.parse(store.getItem(KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((d): d is SavedBrief => d && typeof d.id === "string" && typeof d.title === "string" && Array.isArray(d.sections))
      .map((d) => ({ ...d, updated: formatUpdated(d.updatedAt) || d.updated }));
  } catch {
    return [];
  }
}

/**
 * Upserts a draft. Tries with the thumbnail first; if the browser quota is exceeded it retries
 * without the image so the text work is never lost. Never stores secrets (drafts hold none).
 */
export function saveDraft(draft: SavedBrief, store: StoreLike | null = defaultStore()): SaveOutcome {
  if (!store) return { ok: false, imageStored: false, error: "Browser storage is unavailable." };
  const existing = loadDrafts(store).filter((d) => d.id !== draft.id);
  const attempt = (d: SavedBrief) => store.setItem(KEY, JSON.stringify([d, ...existing]));
  try {
    attempt(draft);
    return { ok: true, imageStored: Boolean(draft.image) };
  } catch {
    try {
      attempt({ ...draft, image: "" });
      return { ok: true, imageStored: false };
    } catch (e) {
      return { ok: false, imageStored: false, error: e instanceof Error ? e.message : "Could not write to browser storage." };
    }
  }
}

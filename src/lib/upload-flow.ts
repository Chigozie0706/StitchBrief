import { dedupeQuestions } from "./clarify";
import type { DetectedGarment, GarmentType, Observation, Question } from "./types";

export const NOT_SURE = "Not sure";
export const GARMENT_OPTIONS = [NOT_SURE, "Dress", "Blouse", "Trousers", "Skirt", "Two-piece set"] as const;
export const garmentForApi = (g: string) => (g === NOT_SURE ? "" : g);

/** Re-analysis is needed when the image, the description or the occasion changed. (Garment type is only a hint.) */
export function analysisKey(f: { imageHash: string; description: string; occasion: string }): string {
  return [f.imageHash, f.description.trim(), f.occasion.trim()].join("|");
}

export function outfitLabel(garments: DetectedGarment[]): string {
  if (garments.length >= 2) return "Two-piece set";
  return garments[0]?.name || "Garment";
}

const SELECTED_TYPE: Record<string, GarmentType> = { Dress: "dress", Blouse: "top", Trousers: "trousers", Skirt: "skirt" };

/** Flags a conflict between the selected garment type and what the analysis found. Never overrides the selection. */
export function garmentMismatch(selected: string, garments: DetectedGarment[]): string | null {
  if (!selected || selected === NOT_SURE || garments.length === 0) return null;
  const names = garments.map((g) => g.name).join(" and ");
  if (selected === "Two-piece set")
    return garments.length >= 2 ? null : `You selected Two-piece set, but the image appears to show one piece (${names}).`;
  if (garments.length >= 2) return `You selected ${selected}, but the image appears to show ${garments.length} pieces (${names}).`;
  return garments[0].type === SELECTED_TYPE[selected] ? null : `You selected ${selected}, but the image appears to show ${names}.`;
}

export type ReviewNote = { piece: string; label: string; value: string };

/**
 * After the reference image is replaced: image-specific observations are NOT carried over.
 * Earlier answers are kept but flagged for review; earlier client-confirmed observations are listed for review.
 */
export function applyReanalysis(args: {
  prevQuestions: Question[]; prevObservations: Observation[]; nextQuestions: Question[]; nextObservations: Observation[];
}): { questions: Question[]; reviewNotes: ReviewNote[] } {
  const { prevQuestions, prevObservations, nextQuestions, nextObservations } = args;
  const decided = (q: Question) => Boolean(q.skipped || (q.answer && q.answer.trim()));
  const prevById = new Map(prevQuestions.filter(decided).map((q) => [q.id, q]));
  const carried = nextQuestions.map((q) => {
    const p = prevById.get(q.id);
    return p ? { ...q, answer: p.answer, skipped: p.skipped, custom: p.custom, needsReview: true } : q;
  });
  const orphans = prevQuestions.filter((q) => q.answer && q.answer.trim() && !q.skipped && !nextQuestions.some((n) => n.id === q.id));
  const extra = dedupeQuestions(carried, orphans, 20).map((q) => ({ ...q, needsReview: true }));
  const same = (a: Observation, b: Observation) => a.piece === b.piece && a.key === b.key && a.value === b.value;
  const reviewNotes = prevObservations
    .filter((o) => o.source === "client_confirmed" && !nextObservations.some((n) => same(n, o)))
    .map((o) => ({ piece: o.piece, label: o.label, value: o.value }));
  return { questions: [...carried, ...extra], reviewNotes };
}

/** Most observations unknown or low-confidence: the photo probably doesn't show enough. */
export function lowDetail(observations: Observation[]): boolean {
  if (observations.length === 0) return false;
  const weak = observations.filter((o) => o.source === "unknown" || o.confidence === "low").length;
  return weak / observations.length >= 0.6;
}

export function groupByPiece(observations: Observation[]): { piece: string; items: { o: Observation; i: number }[] }[] {
  const groups: { piece: string; items: { o: Observation; i: number }[] }[] = [];
  observations.forEach((o, i) => {
    let g = groups.find((x) => x.piece === o.piece);
    if (!g) groups.push((g = { piece: o.piece, items: [] }));
    g.items.push({ o, i });
  });
  return groups;
}

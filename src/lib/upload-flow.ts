import { dedupeQuestions } from "./clarify";
import type { DetectedGarment, GarmentType, Observation, Question } from "./types";

export const NOT_SURE = "Not sure";
export const GARMENT_OPTIONS = [NOT_SURE, "Dress", "Blouse", "Trousers", "Skirt", "Two-piece set"] as const;
export const garmentForApi = (g: string) => (g === NOT_SURE ? "" : g);

/** Re-analysis is needed when the image, the description or the occasion changed. (Garment type is only a hint.) */
export function analysisKey(f: { imageHash: string; description: string; occasion: string }): string {
  return [f.imageHash, f.description.trim(), f.occasion.trim()].join("|");
}

const SELECTED_TYPE: Record<string, GarmentType> = { Dress: "dress", Blouse: "top", Trousers: "trousers", Skirt: "skirt" };
const TYPE_LABEL: Record<GarmentType, string | null> = { dress: "Dress", top: "Blouse", trousers: "Trousers", skirt: "Skirt", outerwear: null, other: null };

/** Label for the garment(s) a brief is made for: one piece → its type, several → "Two-piece set". */
export function garmentLabelFor(pieces: DetectedGarment[]): string {
  if (pieces.length >= 2) return pieces.length === 2 ? "Two-piece set" : "Multi-piece outfit";
  return pieces[0] ? TYPE_LABEL[pieces[0].type] ?? pieces[0].name : NOT_SURE;
}

/**
 * Which visible garments the brief is for, when that is already clear. null = the designer must say.
 * A photo containing two garments is NOT automatically a two-piece outfit.
 */
export function autoRequested(selected: string, garments: DetectedGarment[]): string[] | null {
  const n = garments.length;
  if (n === 0) return [];
  if (!selected || selected === NOT_SURE) return n === 1 ? [garments[0].name] : null;
  if (selected === "Two-piece set") return n === 2 ? garments.map((g) => g.name) : null;
  const matching = garments.filter((g) => g.type === SELECTED_TYPE[selected]);
  return n === 1 && matching.length === 1 ? [garments[0].name] : null;
}

export type GarmentChoice = { message: string; options: { label: string; pieces: string[] }[] };
const join = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The question shown when it is unclear which visible garment(s) StitchBrief should create a brief for. */
export function garmentChoice(selected: string, garments: DetectedGarment[]): GarmentChoice | null {
  if (autoRequested(selected, garments) !== null) return null;
  const n = garments.length;
  const names = join(garments.map((g) => g.name.toLowerCase()));
  const ask = "Which garment should StitchBrief create a sewing brief for?";
  if (n === 1) return { message: `You selected ${selected}, but the image shows ${names}. ${ask}`, options: [{ label: `${garments[0].name} only`, pieces: [garments[0].name] }] };
  const matching = garments.filter((g) => g.type === SELECTED_TYPE[selected]);
  const singles = (matching.length ? matching : garments).map((g) => ({ label: `${g.name} only`, pieces: [g.name] }));
  return { message: `The image contains ${names}. ${ask}`, options: [...singles, { label: n === 2 ? "Both garments" : `All ${n} garments`, pieces: garments.map((g) => g.name) }] };
}

/** "Another garment selection": the visible garment of that type if there is one, otherwise a garment that is not in the photo. */
export function requestedForOther(selected: string, garments: DetectedGarment[]): string[] {
  const m = garments.find((g) => g.type === SELECTED_TYPE[selected]);
  return [m ? m.name : selected];
}

export type ReviewNote = { piece: string; label: string; value: string };

/**
 * After the reference image is replaced: image-specific observations are NOT carried over.
 * Earlier answers are kept but flagged for review; earlier client-confirmed details are listed for review.
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
    .filter((o) => o.status === "client_confirmed" && !nextObservations.some((n) => same(n, o)))
    .map((o) => ({ piece: o.piece, label: o.label, value: o.value }));
  return { questions: [...carried, ...extra], reviewNotes };
}

/** Most details unknown or uncertain: the photo probably doesn't show enough. */
export function lowDetail(observations: Observation[]): boolean {
  if (observations.length === 0) return false;
  const weak = observations.filter((o) => o.status === "unknown" || o.status === "uncertain").length;
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

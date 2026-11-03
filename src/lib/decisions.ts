import type { DecisionOrigin, DecisionStatus, Observation } from "./types";

export const DECISION_STATUSES: DecisionStatus[] = ["observed", "client_confirmed", "ai_suggested", "uncertain", "unknown", "needs_measurement"];
export const MODEL_ORIGINS: DecisionOrigin[] = ["image", "client_description", "ai"];
export const ALL_ORIGINS: DecisionOrigin[] = ["image", "client_description", "client_answer", "designer_edit", "ai"];

export const STATUS_LABEL: Record<DecisionStatus, string> = {
  observed: "Observed", client_confirmed: "Client-confirmed", ai_suggested: "AI suggestion",
  uncertain: "Uncertain", unknown: "Unknown", needs_measurement: "Needs measurement",
};

/**
 * What the MODEL may claim. Source accuracy is enforced here, not trusted from the prompt:
 *  - only a client statement can make something client_confirmed (a collar the client chose is never "observed")
 *  - "observed" requires the image as origin
 * Contradictory claims are demoted to `uncertain` with a reason, never silently promoted.
 */
export function normalizeModelDecision(status: DecisionStatus, origin: DecisionOrigin, reason = ""): { status: DecisionStatus; origin: DecisionOrigin; reason: string } {
  if (origin === "client_description" && (status === "observed" || status === "ai_suggested")) return { status: "client_confirmed", origin, reason: "" };
  if (status === "client_confirmed" && origin !== "client_description")
    return { status: "uncertain", origin, reason: reason || "Marked client-confirmed without a client statement. Please confirm." };
  if (status === "observed" && origin !== "image") return { status: origin === "ai" ? "ai_suggested" : "uncertain", origin, reason: reason || "Not visible in the image." };
  if (status === "ai_suggested" && origin === "image") return { status: "observed", origin, reason: "" };
  return { status, origin, reason };
}

/** Designer marks a detail uncertain. It stays in the brief but leaves the confirmed decisions. Reversible. */
export function markUncertain(o: Observation, reason = "Marked uncertain by the designer"): Observation {
  if (o.status === "uncertain") return o;
  return { ...o, previousStatus: o.status, status: "uncertain", reason };
}

/** Restores the status from before it was marked uncertain. A model-flagged uncertainty has nothing to restore. */
export function unmarkUncertain(o: Observation): Observation {
  if (o.status !== "uncertain" || !o.previousStatus) return o;
  const { previousStatus, reason: _r, ...rest } = o;
  return { ...rest, status: previousStatus };
}

/** Only an explicit designer action turns anything into a confirmed decision. */
export function confirmDecision(o: Observation, value?: string): Observation {
  const { previousStatus: _p, reason: _r, ...rest } = o;
  return { ...rest, ...(value !== undefined ? { value } : {}), status: "client_confirmed", origin: "designer_edit" };
}

export const isUncertain = (o: Observation) => o.status === "uncertain";
export const canConfirm = (o: Observation) => o.status === "observed" || o.status === "ai_suggested" || o.status === "uncertain";
export const canUndo = (o: Observation) => o.status === "uncertain" && Boolean(o.previousStatus);

/** Same topic written differently ("sleeve_style" vs "sleeves") must count as one decision. */
const ALIASES: Record<string, string> = {
  neck: "neckline", neckline_style: "neckline", collar: "neckline", collar_style: "neckline", hemline: "hem", hem_style: "hem", sleeve: "sleeves", sleeve_style: "sleeves", sleeve_type: "sleeves", sleeve_length: "sleeves",
  length: "length_category", hem_length: "length_category", garment_length: "length_category", fastening: "closure", closure_type: "closure",
  fabric_type: "fabric_appearance", material: "fabric_appearance", fabric: "fabric_appearance", pocket: "pockets", pocket_style: "pockets",
  waist: "waistband", waistband_style: "waistband", colour: "color", silhouette_shape: "silhouette", fit_style: "fit",
};
export const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
export const normTopic = (t: string) => ALIASES[slug(t)] ?? slug(t);
/** A decision is identified by garment + topic: "length" confirmed for the top says nothing about the trousers. "" = whole outfit. */
export const topicKey = (piece: string, topic: string) => `${piece.trim().toLowerCase()}|${normTopic(topic)}`;
/** True when `keys` already covers this garment+topic (or the whole outfit for that topic). */
export const covers = (keys: Set<string>, piece: string, topic: string) => keys.has(topicKey(piece, topic)) || keys.has(topicKey("", topic));
export const humanize = (t: string) => { const s = t.replace(/_/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

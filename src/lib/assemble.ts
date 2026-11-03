import { covers, humanize, normTopic, slug, topicKey } from "./decisions";
import type { BriefData, BriefPiece, DecisionOrigin, DecisionStatus, Difference, Observation, Question, Section } from "./types";

/** One decision, from any source, with its status and origin. The brief's decision sections are built from this, not from model prose. */
export type LedgerEntry = {
  ref: string; piece: string; topic: string; /** unaliased slug, e.g. "pocket_style" */ slug: string; label: string; value: string;
  status: DecisionStatus; origin: DecisionOrigin;
  qualifier?: string; reason?: string;
  /** The previous (reference) value this confirmed decision replaced. */
  replaces?: string;
  /** Visible in the photo but not part of the garment(s) being made. */
  referenceOnly?: boolean;
  /** Replaced by a newer / more authoritative decision on the same topic; never shown. */
  superseded?: boolean;
  /** A question the designer skipped or has not answered. */
  openQuestion?: boolean;
};

export const FABRIC_PREFERENCE_NOTE = "a preference only; no physical fabric has been selected or approved";
const FABRIC_IMAGE_NOTE = "visual impression only; composition cannot be determined from an image";
const RANK: Record<DecisionOrigin, number> = { designer_edit: 3, client_answer: 2, client_description: 1, image: 0, ai: 0 };
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const compatible = (a: string, b: string) => a === "" || b === "" || same(a, b);

export function expectedPieceNames(r: { requested?: string[]; garment: string }): string[] {
  return r.requested && r.requested.length ? r.requested : [r.garment || "Garment"];
}

export function buildLedger(a: { observations: Observation[]; questions: Question[]; differences: Difference[]; requested?: string[] }): LedgerEntry[] {
  const req = a.requested ?? [];
  const refOnly = (piece: string) => req.length > 0 && piece !== "" && !req.some((r) => same(r, piece));
  const out: LedgerEntry[] = [];

  for (const o of a.observations)
    out.push({
      ref: `obs:${o.piece}:${o.key}`, piece: o.piece, topic: normTopic(o.key), slug: slug(o.key), label: o.label, value: o.value, status: o.status, origin: o.origin,
      reason: o.reason, referenceOnly: refOnly(o.piece),
      qualifier: o.key === "fabric_appearance" && o.status !== "client_confirmed" ? FABRIC_IMAGE_NOTE : o.key === "fabric_appearance" ? FABRIC_PREFERENCE_NOTE : undefined,
    });

  for (const q of a.questions) {
    const topic = normTopic(q.topic || q.id);
    const base = { ref: `q:${q.id}`, piece: q.piece ?? "", topic, slug: slug(q.topic || q.id), label: humanize(q.topic || q.id), referenceOnly: refOnly(q.piece ?? "") };
    const answer = q.answer?.trim() ?? "";
    if (answer && !q.skipped && q.needsReview)
      out.push({ ...base, value: answer, status: "uncertain", origin: "client_answer", reason: "Answered before the reference image was replaced; not re-confirmed" });
    else if (answer && !q.skipped)
      out.push({ ...base, value: answer, status: "client_confirmed", origin: "client_answer", qualifier: topic === "fabric_appearance" ? FABRIC_PREFERENCE_NOTE : undefined });
    else out.push({ ...base, value: q.question, status: "unknown", origin: "client_answer", reason: q.skipped ? "Skipped by the designer" : "Not answered", openQuestion: true });
  }

  for (const d of a.differences)
    out.push({ ref: `diff:${normTopic(d.topic)}`, piece: "", topic: normTopic(d.topic), slug: slug(d.topic), label: d.topic, value: d.client_wants, replaces: d.reference_shows, status: "client_confirmed", origin: "client_description" });

  // A newer decision replaces the older one on the same topic: no contradictory versions survive into the brief.
  for (const e of out) {
    if (e.referenceOnly || e.openQuestion) continue;
    for (const c of out) {
      if (c === e || c.superseded || c.referenceOnly || c.openQuestion || c.topic !== e.topic || !compatible(c.piece, e.piece)) continue;
      const cConfirmed = c.status === "client_confirmed", eConfirmed = e.status === "client_confirmed";
      if (cConfirmed && !eConfirmed) { e.superseded = true; if (e.status === "observed" && !c.replaces) c.replaces = e.value; break; }
      if (cConfirmed && eConfirmed && RANK[c.origin] > RANK[e.origin]) { e.superseded = true; if (!c.replaces) c.replaces = e.replaces ?? (e.origin === "image" ? e.value : undefined); break; }
    }
  }
  return out;
}

export const liveEntries = (l: LedgerEntry[]) => l.filter((e) => !e.referenceOnly && !e.superseded);
/** Keys (garment|topic) of everything the client has confirmed. */
export const confirmedTopics = (l: LedgerEntry[]) => new Set(liveEntries(l).filter((e) => e.status === "client_confirmed").map((e) => topicKey(e.piece, e.topic)));

/* ---------- assembling the sections ---------- */
const bullets = (items: string[], empty = "None recorded.") => (items.length ? items.map((i) => `• ${i}`).join("\n") : empty);
function line(e: LedgerEntry): string {
  if (e.openQuestion) return `${e.value} (${e.reason})`;
  return `${e.label}: ${e.value}${e.replaces ? ` (reference: ${e.replaces})` : ""}${e.qualifier ? ` — ${e.qualifier}` : ""}${e.reason ? ` — ${e.reason}` : ""}`;
}

export function assembleBrief(brief: BriefData, ledger: LedgerEntry[], ctx: { description: string }): { sections: Section[]; warnings: string[] } {
  const warnings: string[] = [];
  const live = liveEntries(ledger);
  const confirmed = live.filter((e) => e.status === "client_confirmed");
  const observed = live.filter((e) => e.status === "observed");
  const suggested = live.filter((e) => e.status === "ai_suggested");
  const unresolved = live.filter((e) => e.status === "uncertain" || e.openQuestion);
  const unknownE = live.filter((e) => (e.status === "unknown" && !e.openQuestion) || e.status === "needs_measurement");

  // Model-written unresolved items may not repeat something the client confirmed, or something already listed from the ledger.
  const confirmedRefs = new Set(confirmed.map((e) => e.ref));
  const confirmedKeys = new Set(confirmed.map((e) => topicKey(e.piece, e.topic)));
  const listed = new Set([...unresolved, ...unknownE].map((e) => topicKey(e.piece, e.topic)));
  const confirmedSlugs = new Set(confirmed.map((e) => `${e.piece.toLowerCase()}|${e.slug}`));
  // An open decision may never restate something the client confirmed (same topic, however it is worded).
  const extraUnresolved = brief.unresolved.filter((i) => !confirmedRefs.has(i.ref) && !covers(confirmedKeys, i.piece, i.topic) && !covers(listed, i.piece, i.topic));
  // A technical gap is a CONSEQUENCE of a confirmed choice (generic pockets confirmed → their style is still unknown), so it is only
  // blocked when it repeats the confirmed topic verbatim or something already listed.
  const extraGaps = brief.technical_gaps.filter((g) => !confirmedSlugs.has(`${g.piece.toLowerCase()}|${slug(g.topic)}`) && !confirmedSlugs.has(`|${slug(g.topic)}`) && !covers(listed, g.piece, g.topic));

  // Measurement lists name what must be measured; a number the client never gave is an invention.
  // A number is only allowed when the client's own words (description or confirmed values) contain it in a sentence about the same thing.
  const sources = [...ctx.description.split(/[.!?\n;]+/), ...confirmed.map((e) => e.value)].map((x) => x.toLowerCase());
  const words = (x: string) => (x.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.slice(0, 5));
  let removed = 0;
  const noInvented = (list: string[]) => list.filter((s) => {
    const mine = new Set(words(s));
    const ok = (s.match(/\d+(?:[.,]\d+)?/g) ?? []).every((n) => sources.some((src) => src.includes(n) && words(src).some((w) => mine.has(w))));
    if (!ok) removed++;
    return ok;
  });

  // Changing a visible length changes the garment's proportions (flare, panels, hem): say so rather than leave it implicit.
  const proportion = confirmed.filter((e) => e.topic === "length_category" && e.replaces && !e.replaces.toLowerCase().includes(e.value.toLowerCase()) && !e.value.toLowerCase().includes(e.replaces.toLowerCase()))
    .map((e) => `${e.piece ? `${e.piece} — ` : ""}Proportion check: length changes from "${e.replaces}" to "${e.value}", so the reference's flare, panel and hem proportions may need redesign`);

  const pieces = brief.pieces;
  const multi = pieces.length > 1;
  const names = pieces.map((p) => p.name);
  const forPiece = (list: LedgerEntry[], name: string) => list.filter((e) => same(e.piece, name));
  const general = (list: LedgerEntry[]) => list.filter((e) => !names.some((n) => same(n, e.piece)));
  const grouped = (list: LedgerEntry[]) => {
    if (list.length === 0) return "None recorded.";
    if (!multi) return bullets(list.map(line));
    return [...names.map((n) => [n, forPiece(list, n)] as const), ["General / shared", general(list)] as const]
      .filter(([, es]) => es.length).map(([n, es]) => `${n}:\n${bullets(es.map(line))}`).join("\n\n");
  };
  const title = (base: string, p?: BriefPiece) => (multi && p ? `${p.name} — ${base}` : base);
  const out: Section[] = [];
  const add = (s: Section) => out.push(s);
  const perPiece = (base: string, kind: Section["kind"], body: (p: BriefPiece) => string) => pieces.forEach((p) => add({ title: title(base, p), body: body(p), kind, piece: p.name }));

  add({ title: "Garment overview", kind: "overview", body: brief.garment_overview + (multi && brief.shared_requirements ? `\n\nShared requirements: ${brief.shared_requirements}` : "") });
  add({ title: "Confirmed design decisions", kind: "confirmed", body: grouped(confirmed) });
  perPiece("Specification (from the reference)", "specification", (p) => {
    const seen = forPiece(observed, p.name);
    return [seen.length ? `Seen in the reference, not yet confirmed as design decisions:\n${bullets(seen.map(line))}` : "No details recorded from the reference.",
      p.changes_from_reference.length ? `Changes from the reference:\n${bullets(p.changes_from_reference)}` : ""].filter(Boolean).join("\n\n");
  });
  perPiece("Fit and comfort", "fit", (p) => p.fit_and_comfort);
  perPiece("Fabric and material preferences", "fabric", (p) => `${p.fabric_preferences}\n\nNo physical fabric has been selected or approved. Composition cannot be determined from the image.`);
  perPiece("Construction and finishing", "construction", (p) => `${p.construction_and_finishing}\n\nHidden construction (linings, interfacing, internal support) cannot be verified from the reference image.`);
  perPiece("Body measurements to take from the client", "body_measurements", (p) => bullets(noInvented(p.body_measurements)));
  perPiece("Garment dimensions and design specifications", "garment_dimensions", (p) => bullets(noInvented(p.garment_dimensions)));
  add({ title: "AI suggestions (not approved by the client)", kind: "suggestions", body: bullets([...suggested.map(line), ...brief.ai_suggestions]) });
  add({ title: "Uncertain and unresolved decisions", kind: "uncertain", body: bullets([...unresolved.map(line), ...extraUnresolved.map((i) => `${i.piece ? `${i.piece} — ` : ""}${humanize(i.topic)}: ${i.detail}`)]) });
  add({ title: "Unknown technical details", kind: "unknown", body: bullets([...unknownE.map((e) => (e.status === "needs_measurement" ? `${line(e)} — needs measurement or fitting` : line(e))), ...proportion, ...extraGaps.map((g) => `${g.piece ? `${g.piece} — ` : ""}${humanize(g.topic)}: ${g.detail}${g.status === "needs_measurement" ? " — needs measurement or fitting" : ""}`)]) });

  const forced = ["Select and approve a physical fabric with the client"];
  if (pieces.some((p) => p.body_measurements.length)) forced.unshift("Take the body measurements listed above directly from the client");
  if (unresolved.length + extraUnresolved.length) forced.push("Resolve the uncertain and unresolved decisions with the client");
  if (unknownE.length + extraGaps.length + proportion.length) forced.push("Settle the unknown technical details before cutting");
  const seenItems = new Set<string>();
  add({ title: "Tailor review checklist", kind: "checklist", body: bullets([...brief.review_checklist, ...forced].filter((i) => { const k = i.toLowerCase(); if (seenItems.has(k)) return false; seenItems.add(k); return true; })) });

  if (removed) warnings.push(`Removed ${removed} measurement value${removed === 1 ? "" : "s"} suggested by the model that did not come from the client.`);
  return { sections: out, warnings };
}

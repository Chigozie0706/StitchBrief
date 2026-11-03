import test from "node:test";
import assert from "node:assert/strict";
import { assembleBrief, buildLedger, confirmedTopics, FABRIC_PREFERENCE_NOTE, liveEntries } from "../src/lib/assemble";
import { confirmDecision, markUncertain, unmarkUncertain } from "../src/lib/decisions";
import { reviewSummary, statusLabel } from "../src/lib/brief";
import { parseBrief } from "../src/lib/validation";
import { liveBriefJson } from "./helpers";
import type { BriefData, Observation, Question } from "../src/lib/types";

const o = (key: Observation["key"], value: string, status: Observation["status"] = "observed", origin: Observation["origin"] = "image", piece = "Dress"): Observation => ({ piece, key, label: key.charAt(0).toUpperCase() + key.slice(1), value, status, origin });
const q = (id: string, answer?: string, over: Partial<Question> = {}): Question => ({ id, question: `Question ${id}?`, reason: "r", type: "text", options: [], priority: "normal", topic: id, piece: "", ...(answer ? { answer } : {}), ...over });
const brief = (over: Partial<BriefData> = {}): BriefData => { const p = parseBrief(liveBriefJson, ["Dress"]); if (!p.ok) throw new Error(p.error); return { ...p.value, ...over }; };
const body = (s: { sections: { kind?: string; body: string }[] }, kind: string) => s.sections.filter((x) => x.kind === kind).map((x) => x.body).join("\n");
const build = (args: { observations?: Observation[]; questions?: Question[]; requested?: string[]; b?: BriefData }) => {
  const ledger = buildLedger({ observations: args.observations ?? [], questions: args.questions ?? [], differences: [], requested: args.requested });
  return { ledger, ...assembleBrief(args.b ?? brief(), ledger, { description: "" }) };
};

test("ledger: every decision keeps its status AND origin; nothing observed becomes confirmed by itself", () => {
  const l = buildLedger({ observations: [o("neckline", "Square"), o("color", "Red", "client_confirmed", "client_description")], questions: [q("fit", "Fitted"), q("lining")], differences: [{ topic: "Print", reference_shows: "Floral", client_wants: "Solid" }] });
  const by = (ref: string) => l.find((e) => e.ref === ref)!;
  assert.deepEqual([by("obs:Dress:neckline").status, by("obs:Dress:neckline").origin], ["observed", "image"]);
  assert.deepEqual([by("q:fit").status, by("q:fit").origin], ["client_confirmed", "client_answer"]);
  assert.deepEqual([by("diff:print").status, by("diff:print").origin], ["client_confirmed", "client_description"]);
  assert.deepEqual([by("q:lining").status, by("q:lining").openQuestion], ["unknown", true]);
});

test("a changed decision REPLACES the earlier one: no contradictory versions reach the brief", () => {
  const r = build({ observations: [o("neckline", "Draped V")], questions: [q("neckline", "Raised square neckline")] });
  assert.match(body(r, "confirmed"), /Neckline: Raised square neckline \(reference: Draped V\)/);
  assert.doesNotMatch(body(r, "specification"), /Draped V/);
  const edit = build({ observations: [o("neckline", "Boat neck", "client_confirmed", "designer_edit")], questions: [q("neckline", "Raised square neckline")] });
  assert.match(body(edit, "confirmed"), /Boat neck/, "the designer's later edit wins");
  assert.doesNotMatch(body(edit, "confirmed"), /Raised square/);
});

test("fabric answers are preferences, never an approved fabric", () => {
  const r = build({ questions: [q("fabric", "Opaque crepe appearance")] });
  assert.match(body(r, "confirmed"), new RegExp(`Opaque crepe appearance — ${FABRIC_PREFERENCE_NOTE}`));
  assert.match(body(r, "fabric"), /No physical fabric has been selected or approved\. Composition cannot be determined from the image\./);
  assert.match(body(r, "construction"), /Hidden construction .* cannot be verified from the reference image/);
});

test("Mark as uncertain flows through the brief: out of 'confirmed', into 'uncertain', and back when undone", () => {
  const confirmed = confirmDecision(o("silhouette", "A-line"));
  assert.match(body(build({ observations: [confirmed] }), "confirmed"), /A-line/);
  const marked = markUncertain(confirmed);
  const r = build({ observations: [marked] });
  assert.doesNotMatch(body(r, "confirmed"), /A-line/, "excluded from confirmed decisions");
  assert.match(body(r, "uncertain"), /Silhouette: A-line — Marked uncertain by the designer/, "stays in the brief, under uncertain, with the reason");
  assert.match(body(build({ observations: [unmarkUncertain(marked)] }), "confirmed"), /A-line/, "reversible");
  // uncertain is not unknown, and neither is measurement
  const mixed = build({ observations: [marked, o("pockets", "?", "unknown"), o("waistband", "Depth", "needs_measurement")] });
  assert.doesNotMatch(body(mixed, "unknown"), /A-line/);
  assert.match(body(mixed, "unknown"), /Pockets/);
  assert.match(body(mixed, "unknown"), /Waistband: Depth — needs measurement or fitting/);
  assert.doesNotMatch(body(mixed, "uncertain"), /Pockets|Waistband/);
});

test("model-written open items cannot repeat confirmed decisions or ledger items; consequences (gaps) are kept", () => {
  const b = brief({
    unresolved: [{ topic: "closure_type", detail: "Closure undecided", piece: "Dress", ref: "" }, { topic: "waist_position", detail: "Where the waist sits", piece: "Dress", ref: "" }, { topic: "x", detail: "Confirmed again", piece: "", ref: "q:closure" }],
    technical_gaps: [{ topic: "pocket_style", detail: "Style and position unknown", piece: "Dress", status: "unknown", ref: "q:pockets" }, { topic: "pockets", detail: "Pockets?", piece: "Dress", status: "unknown", ref: "q:pockets" }],
  });
  const r = build({ questions: [q("closure", "Concealed buttons"), q("pockets", "Pockets")], b });
  assert.doesNotMatch(body(r, "uncertain"), /Closure undecided|Confirmed again/);
  assert.match(body(r, "uncertain"), /Dress — Waist position: Where the waist sits/);
  assert.match(body(r, "unknown"), /Pocket style: Style and position unknown/);
  assert.doesNotMatch(body(r, "unknown"), /Pockets\?/);
});

test("measurements: body vs garment dimensions stay separate; numbers the client never gave are removed", () => {
  const piece = { ...liveBriefJson.pieces[0], body_measurements: ["Bust", "Waist 70 cm"], garment_dimensions: ["Finished length", "Hem 2 cm", "Neckline raised by 2 cm"] };
  const r = assembleBrief({ ...brief(), pieces: [piece] }, buildLedger({ observations: [], questions: [q("neck", "Raise the neckline by 2 cm")], differences: [] }), { description: "" });
  const text = (k: string) => r.sections.filter((s) => s.kind === k).map((s) => s.body).join("\n");
  assert.equal(text("body_measurements"), "• Bust");
  assert.match(text("garment_dimensions"), /Neckline raised by 2 cm/, "a number the client gave is allowed");
  assert.doesNotMatch(text("garment_dimensions"), /Hem 2 cm/, "the client said 2 cm about the neckline, not the hem");
  assert.match(r.warnings[0], /Removed 2 measurement values/);
});

test("checklist is de-duplicated and always includes fabric approval; unresolved items add resolve steps", () => {
  const r = build({ questions: [q("fit")], b: brief({ review_checklist: ["Select and approve a physical fabric with the client", "Review toile"] }) });
  const items = body(r, "checklist").split("\n");
  assert.equal(items.filter((i) => /physical fabric/i.test(i)).length, 1);
  assert.ok(items.some((i) => /Resolve the uncertain and unresolved decisions/.test(i)));
  assert.ok(items.some((i) => /body measurements listed above/.test(i)));
});

test("garments that are only visible in the photo are reference-only: excluded from the brief", () => {
  const l = buildLedger({ observations: [o("color", "Blue", "observed", "image", "Jeans"), o("color", "White", "observed", "image", "Blouse")], questions: [q("closure", "Buttons", { piece: "Jeans" })], differences: [], requested: ["Blouse"] });
  assert.deepEqual(liveEntries(l).map((e) => e.piece), ["Blouse"]);
  assert.equal(confirmedTopics(l).has("jeans|closure"), false);
});

test("a carried-over answer is uncertain in the brief until the designer re-confirms it", () => {
  const r = build({ questions: [q("fit", "Fitted", { needsReview: true })] });
  assert.doesNotMatch(body(r, "confirmed"), /Fitted/);
  assert.match(body(r, "uncertain"), /Fit: Fitted — Answered before the reference image was replaced; not re-confirmed/);
});

test("ready-for-review summary reads the brief as it stands; 'Ready' means ready for tailor review", () => {
  const r = build({ observations: [o("silhouette", "A-line", "client_confirmed", "designer_edit"), o("pockets", "Unknown", "unknown")], questions: [q("fit")] });
  const s = reviewSummary(r.sections);
  assert.deepEqual([s.confirmed.length, s.uncertain.length, s.unknown.length], [1, 1, 1]);
  assert.deepEqual(s.measurements, ["Bust", "Waist", "Full hip", "Finished length"]);
  assert.equal(statusLabel("Ready"), "Ready for tailor review");
  assert.equal(statusLabel("Draft"), "Draft");
  // edits made by the designer are what the review sees
  const edited = r.sections.map((x) => (x.kind === "uncertain" ? { ...x, body: "• Edited item" } : x));
  assert.deepEqual(reviewSummary(edited).uncertain, ["Edited item"]);
});

test("a multi-piece brief has separate sections per garment and shared requirements", () => {
  const two = { ...brief(), pieces: [{ ...liveBriefJson.pieces[0], name: "Top" }, { ...liveBriefJson.pieces[0], name: "Trousers", body_measurements: ["Inseam"] }], shared_requirements: "Same teal" };
  const r = assembleBrief(two, buildLedger({ observations: [], questions: [], differences: [] }), { description: "" });
  assert.equal(r.sections.filter((s) => s.piece === "Top").length, 6);
  assert.equal(r.sections.filter((s) => s.piece === "Trousers").length, 6);
  assert.match(r.sections[0].body, /Shared requirements: Same teal/);
});

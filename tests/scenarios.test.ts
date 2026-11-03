// Regression scenarios from the five manual garment tests. The model is simulated (it is deliberately made to repeat the mistakes
// seen in manual testing); everything else is the real application code: handlers, validation, ledger, assembler.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleAnalyze, handleClarify, handleGenerate } from "../src/lib/server/handlers";
import { createLiveProvider } from "../src/lib/server/provider";
import { _resetRateLimit } from "../src/lib/server/rate-limit";
import { autoRequested, garmentChoice } from "../src/lib/upload-flow";
import { followupUsed } from "../src/lib/clarify";
import { choice, completion, JPEG, liveBriefJson, ob, qn, stubFetch } from "./helpers";
import type { Question, Section } from "../src/lib/types";

const config = { apiKey: "LLM_1_k", model: "muse-spark-1.3", baseUrl: "https://api.meta.ai/v1" };
const post = (b: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(b) });
beforeEach(() => _resetRateLimit());

const piece = (name: string, over: Record<string, unknown> = {}) => ({
  name, fit_and_comfort: "Comfortable fit.", fabric_preferences: "Preference noted.", construction_and_finishing: "Clean finish.",
  body_measurements: ["Waist"], garment_dimensions: ["Finished length"], changes_from_reference: [], ...over,
});
const brief = (over: Record<string, unknown> = {}) => ({ ...liveBriefJson, pieces: [piece("Dress")], ...over });

type Run = { garment: string; description: string; analysis: unknown; answers: Record<string, string | null>; followups?: unknown[]; followupAnswers?: Record<string, string>; requested?: string[]; brief: unknown; occasion?: string };
async function run(o: Run) {
  const stub = stubFetch([{ json: completion(o.analysis) }, { json: completion({ questions: o.followups ?? [] }) }, { json: completion(o.brief) }, { json: completion(o.brief) }]);
  const provider = createLiveProvider(config, stub.fn);
  const ctx = { description: o.description, garment: o.garment, occasion: o.occasion ?? "" };
  const analysisRes = await handleAnalyze(post({ ...ctx, image: JPEG }), provider);
  const a = (await analysisRes.json()).data;
  const answer = (qs: Question[], map: Record<string, string | null>) => qs.map((q) => (q.id in map ? (map[q.id] === null ? { ...q, skipped: true } : { ...q, answer: map[q.id]! }) : q));
  let questions: Question[] = answer(a.questions, o.answers);
  const requested = o.requested ?? autoRequested(o.garment, a.garments) ?? [];
  const body = { ...ctx, observations: a.observations, differences: a.differences, requested };
  const fu = (await (await handleClarify(post({ ...body, questions }), provider)).json()).data.questions as Question[];
  questions = [...questions, ...answer(fu, o.followupAnswers ?? {})];
  const res = await handleGenerate(post({ ...body, questions }), provider);
  const json = await res.json();
  const sections: Section[] = json.data?.sections ?? [];
  const text = (kind: string, p?: string) => sections.filter((s) => s.kind === kind && (!p || s.piece === p)).map((s) => s.body).join("\n");
  return { a, fu, questions, res, json, sections, text, stub, requested, titles: sections.map((s) => s.title) };
}
const uniqueIn = (haystacks: string[], needle: string) => haystacks.filter((h) => h.toLowerCase().includes(needle.toLowerCase())).length;

/* ------------------------------------------------------------------ Test 1: dress */
test("Test 1 — Dress: confirmed decisions stay confirmed, aren't re-asked, and technical gaps stay separate", async () => {
  const r = await run({
    garment: "Dress",
    description: "Long burgundy formal dress. Fitted upper body but not tight around the hips. Sophisticated, subtle lace or beadwork, easy to move in. I like the neckline but I'm open to alternatives.",
    analysis: {
      summary: "Bright red strapless gown.", garments: [{ name: "Dress", type: "dress" }],
      observations: [ob("Dress", "color", "Bright red"), ob("Dress", "neckline", "Strapless sweetheart"), ob("Dress", "silhouette", "Fitted mermaid"), ob("Dress", "length_category", "Floor length"), ob("Dress", "construction_considerations", "Internal boning likely", "ai_suggested", "ai")],
      missing_information: ["Fabric"], differences: [{ topic: "Color", reference_shows: "Bright red", client_wants: "Burgundy" }],
      questions: [choice("silhouette", "Which silhouette?", ["A-line", "Mermaid"], { topic: "silhouette", priority: "high" }), choice("neckline", "Keep the neckline?", ["Keep sweetheart", "Change"], { topic: "neckline" }),
        choice("embellish", "Which embellishment?", ["Lace", "Beadwork"], { topic: "embellishment" }), choice("closure", "Closure and straps?", ["Back zip", "Back zip with detachable straps"], { topic: "closure" }), choice("length", "Which length?", ["Floor length", "Midi"], { topic: "length" }), choice("lining", "Lining?", ["Lined", "Unlined"], { topic: "lining" })],
    },
    answers: { silhouette: "A-line with moderate flare", neckline: "Keep strapless sweetheart neckline", embellish: "Light beadwork on bodice", closure: "Back zip with detachable straps", length: "Floor length" },
    followups: [choice("straps", "Which straps?", ["Spaghetti", "Wide"], { topic: "straps" }), choice("neck2", "Keep the sweetheart neckline?", ["Yes", "No"], { topic: "neckline_style" }), choice("len2", "How long exactly?", ["Floor", "Ankle"], { topic: "length" })],
    followupAnswers: { straps: "Thin spaghetti straps in matching burgundy" },
    brief: brief({
      unresolved: [{ topic: "neckline", detail: "Neckline still to be decided", piece: "Dress", ref: "q:neckline" }, { topic: "length", detail: "Confirm floor length", piece: "", ref: "" }],
      technical_gaps: [{ topic: "bodice_support", detail: "Detachable straps do not define the internal bodice support (boning, grip tape)", piece: "Dress", status: "unknown", ref: "q:closure" }],
    }),
  });
  assert.equal(r.res.status, 200);
  assert.equal(r.a.questions.length, 5, "at most five initial questions");
  assert.deepEqual(r.fu.map((q) => q.id), ["straps"], "follow-up round drops repeats of neckline and length");
  assert.ok(r.fu.every((q) => q.round === 2) && r.a.questions.every((q: Question) => q.round === 1));
  const confirmed = r.text("confirmed");
  for (const v of ["A-line with moderate flare", "strapless sweetheart", "Light beadwork on bodice", "Back zip with detachable straps", "Thin spaghetti straps in matching burgundy", "Floor length"]) assert.match(confirmed, new RegExp(v, "i"), v);
  assert.match(confirmed, /Color: Burgundy \(reference: Bright red\)/, "the client's change replaces the reference value");
  assert.doesNotMatch(r.text("specification"), /Bright red|Fitted mermaid/, "superseded reference values do not survive as contradictory versions");
  // not asked again and not repeated as open questions
  assert.doesNotMatch(r.text("uncertain"), /neckline|length/i);
  assert.equal(uniqueIn([r.text("uncertain"), r.text("unknown"), r.text("suggestions")], "sweetheart"), 0);
  // the technical consequence of detachable straps stays open, separate from the confirmed decision
  assert.match(r.text("unknown"), /internal bodice support/i);
  assert.doesNotMatch(confirmed, /boning|bodice support/i);
});

/* ------------------------------------------------------------------ Test 2: blouse + jeans */
test("Test 2 — Blouse photo containing jeans: asks which garment to create; jeans stay reference-only; fabric is a preference", async () => {
  const analysis = {
    summary: "White puff-sleeve blouse with light-wash jeans.", garments: [{ name: "Blouse", type: "top" }, { name: "Jeans", type: "trousers" }],
    observations: [ob("Blouse", "neckline", "Square neckline"), ob("Blouse", "sleeves", "Puff sleeves, sheer, tie cuffs"), ob("Blouse", "hem", "Ruffled pointed hem"), ob("Blouse", "closure", "Not visible", "unknown"), ob("Blouse", "color", "White"), ob("Jeans", "color", "Light wash"), ob("Jeans", "length_category", "Full length")],
    missing_information: [], differences: [{ topic: "Color", reference_shows: "White", client_wants: "Emerald green" }],
    questions: [choice("closure", "How should it close?", ["Concealed buttons", "Zip", "Tie"], { topic: "closure", priority: "high", piece: "Blouse" }), choice("fabric", "Which fabric look?", ["Opaque crepe appearance", "Sheer"], { topic: "fabric", priority: "high" }),
      choice("neckline", "Neckline?", ["Raised square", "Keep"], { topic: "neckline", piece: "Blouse" }), choice("sleeves", "Sleeves?", ["Reduced puff", "Keep puff"], { topic: "sleeves", piece: "Blouse" }), choice("length", "Length?", ["Hip length", "Waist"], { topic: "length", piece: "Blouse" })],
  };
  const choiceUi = garmentChoice("Blouse", analysis.garments as never);
  assert.equal(autoRequested("Blouse", analysis.garments as never), null, "two garments are NOT silently treated as a two-piece outfit or as a blouse");
  assert.equal(choiceUi!.message, "The image contains blouse and jeans. Which garment should StitchBrief create a sewing brief for?");
  assert.deepEqual(choiceUi!.options.map((o) => o.label), ["Blouse only", "Both garments"]);
  const r = await run({
    garment: "Blouse", requested: ["Blouse"], description: "Emerald green blouse for office and casual wear, less exaggerated puff sleeves, slightly relaxed waist, modest neckline, clean finish, a cuff detail. Closure undecided.", analysis,
    answers: { closure: "Concealed buttons", fabric: "Opaque crepe appearance", neckline: "Raised square neckline", sleeves: "Reduced puff sleeves with buttoned cuffs", length: "Hip length" },
    followups: [qn("hem", "Which hem?", { topic: "hem", piece: "Blouse" }), choice("fasten", "Which closure type?", ["Buttons", "Zip"], { topic: "closure_type", piece: "Blouse" })],
    followupAnswers: { hem: "Slightly shaped/curved hem" },
    brief: brief({ pieces: [piece("Blouse")], unresolved: [{ topic: "closure", detail: "Closure type undecided", piece: "Blouse", ref: "q:closure" }, { topic: "closure_type", detail: "Which closure type?", piece: "Blouse", ref: "" }] }),
  });
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.fu.map((q) => q.id), ["hem"], "'closure_type' is the same decision as the confirmed 'closure'");
  assert.match(r.text("confirmed"), /Closure: Concealed buttons/);
  assert.doesNotMatch(r.text("uncertain") + r.text("unknown"), /closure/i, "a confirmed closure is never asked again in the brief");
  // preference ≠ approval of a physical fabric
  assert.match(r.text("confirmed"), /Opaque crepe appearance — a preference only; no physical fabric has been selected or approved/);
  assert.match(r.text("fabric"), /No physical fabric has been selected or approved/);
  // only the requested garment is specified; the jeans are reference context
  assert.ok(r.sections.filter((s) => s.piece).every((s) => s.piece === "Blouse"), "every per-garment section is for the blouse");
  assert.ok(r.sections.every((s) => s.piece !== "Jeans"));
  assert.doesNotMatch(r.sections.map((s) => s.body).join("\n"), /Light wash/i);
  assert.match(r.text("confirmed"), /Raised square neckline \(reference: Square neckline\)/);
});

test("Test 2b — a brief that specifies the jeans as well as the blouse is rejected when only the blouse was requested", async () => {
  const analysis = { summary: "x", garments: [{ name: "Blouse", type: "top" }, { name: "Jeans", type: "trousers" }], observations: [ob("Blouse", "color", "White"), ob("Jeans", "color", "Blue")], missing_information: [], differences: [], questions: [] };
  const r = await run({ garment: "Blouse", requested: ["Blouse"], description: "emerald blouse", analysis, answers: {}, brief: brief({ pieces: [piece("Blouse"), piece("Jeans")] }) });
  assert.equal(r.res.status, 502);
  assert.equal(r.json.error.code, "invalid_model_output");
});

/* ------------------------------------------------------------------ Test 3: trousers */
test("Test 3 — Trousers: an observed crease is not a decision; measurements stay separate and are never invented", async () => {
  const r = await run({
    garment: "Trousers", description: "Navy work trousers, relaxed but not extremely wide, high-waisted and tailored, comfortable for sitting and moving. I need functional side pockets and a neat waistband. Closure and length undecided.",
    analysis: {
      summary: "Black palazzo trousers.", garments: [{ name: "Trousers", type: "trousers" }],
      observations: [ob("Trousers", "silhouette", "Very wide palazzo leg"), ob("Trousers", "waistband", "High waist with belt loops"), ob("Trousers", "design_details", "Pressed front crease and pleats"), ob("Trousers", "pockets", "Functional side pockets", "client_confirmed", "client_description"), ob("Trousers", "color", "Black")],
      missing_information: [], differences: [{ topic: "Color", reference_shows: "Black", client_wants: "Navy" }],
      questions: [choice("closure", "Closure?", ["Front zip with hook and bar", "Buttons"], { topic: "closure" }), choice("leg", "How wide?", ["Moderate straight wide leg", "Very wide"], { topic: "silhouette", priority: "high" }), choice("length", "Length?", ["Covering the top of the shoe", "Ankle"], { topic: "length" }), choice("fabric", "Fabric look?", ["Tailored woven fabric with slight stretch", "Linen"], { topic: "fabric" }), choice("pockets", "Side pockets?", ["Yes, functional", "No"], { topic: "pockets" })],
    },
    answers: { closure: "Front zip with hook and bar", leg: "Moderate straight wide leg", length: "Length covering the top of the shoe", fabric: "Tailored woven fabric with slight stretch" },
    followups: [choice("zip2", "Zip or buttons?", ["Zip", "Buttons"], { topic: "closure" }), qn("back", "Back pockets?", { topic: "back_pockets" }), qn("loops", "Belt loops?", { topic: "belt_loops" })],
    followupAnswers: { back: "Two welt back pockets without buttons", loops: "Belt loops" },
    brief: brief({
      pieces: [piece("Trousers", { body_measurements: ["Waist", "High hip", "Full hip", "Inseam", "Rise", "Waist 78 cm"], garment_dimensions: ["Finished length", "Waistband depth", "Leg opening"] })],
      technical_gaps: [{ topic: "waistband_depth", detail: "Waistband depth is not specified", piece: "Trousers", status: "needs_measurement", ref: "" }],
    }),
  });
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.fu.map((q) => q.id), ["back", "loops"], "closure was confirmed, so the follow-up about zip/buttons is dropped");
  const confirmed = r.text("confirmed");
  assert.match(confirmed, /Functional side pockets/, "the client's functional side pockets are preserved as a requirement");
  assert.doesNotMatch(confirmed, /crease/i, "a visible crease the client never approved is NOT a confirmed decision");
  assert.match(r.text("specification"), /Seen in the reference, not yet confirmed as design decisions:[\s\S]*Pressed front crease/);
  // body vs garment measurements
  assert.match(r.text("body_measurements"), /Inseam/);
  assert.doesNotMatch(r.text("body_measurements"), /Finished length|Waistband|Leg opening/);
  assert.match(r.text("garment_dimensions"), /Waistband depth[\s\S]*Leg opening|Leg opening[\s\S]*Waistband depth/);
  assert.doesNotMatch(r.text("garment_dimensions"), /Inseam|Rise/);
  assert.doesNotMatch(r.sections.map((s) => s.body).join("\n"), /78/, "no invented measurement value");
  assert.match(r.json.data.warnings.join(" "), /Removed 1 measurement value/);
  assert.match(r.text("unknown"), /Waistband depth: Waistband depth is not specified — needs measurement or fitting/);
});

/* ------------------------------------------------------------------ Test 4: skirt */
test("Test 4 — Skirt: waist placement is never assumed; confirmed waistband/zip/pockets/fullness are not asked again", async () => {
  const r = await run({
    garment: "Skirt", description: "Emerald green midi skirt, casual to semi-formal, comfortable waist, flows when I walk, discreet side pockets. Not sure about full pleats versus fewer.",
    analysis: {
      summary: "Charcoal pleated skirt.", garments: [{ name: "Skirt", type: "skirt" }],
      observations: [ob("Skirt", "waistband", "Wide waistband"), ob("Skirt", "silhouette", "Full pleated skirt"), ob("Skirt", "length_category", "Cropped hem"), ob("Skirt", "color", "Charcoal")],
      missing_information: [], differences: [{ topic: "Color", reference_shows: "Charcoal", client_wants: "Emerald green" }],
      questions: [choice("pleats", "Fullness?", ["Fewer pleats with flowing A-line silhouette", "Full pleats"], { topic: "silhouette", priority: "high" }), choice("length", "Length?", ["Mid-calf", "Knee"], { topic: "length" }), choice("waist", "Waistband?", ["Wide flat waistband with zip", "Elastic"], { topic: "waistband" }), choice("drape", "Fabric look?", ["Light fluid drape", "Structured"], { topic: "fabric" }), choice("pockets", "Pockets?", ["Pockets on both sides", "None"], { topic: "pockets" })],
    },
    answers: { pleats: "Fewer pleats with flowing A-line silhouette", length: "Mid-calf", waist: "Wide flat waistband with zip", drape: "Light fluid drape", pockets: "Pockets on both sides" },
    followups: [choice("pockets2", "Pocket position?", ["Side seam", "Front"], { topic: "pocket_style" }), choice("zip", "Zip position?", ["Center back", "Side"], { topic: "closure" }), choice("lining", "Lining?", ["Lined", "Unlined"], { topic: "lining" })],
    followupAnswers: { zip: "Center-back zip", lining: "Lined" },
    brief: brief({ pieces: [piece("Skirt")], unresolved: [{ topic: "waist_placement", detail: "Whether the waistband sits at the natural waist, above it or below it", piece: "Skirt", ref: "" }, { topic: "waistband", detail: "Waistband style", piece: "Skirt", ref: "q:waist" }] }),
  });
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.fu.map((q) => q.id), ["zip", "lining"], "pocket_style is the same decision as the confirmed pockets, so it is not asked again");
  const confirmed = r.text("confirmed");
  for (const v of ["Fewer pleats", "Mid-calf", "Wide flat waistband with zip", "Light fluid drape", "Pockets on both sides", "Center-back zip", "Lined"]) assert.match(confirmed, new RegExp(v));
  assert.doesNotMatch(confirmed, /natural/i, "waist placement is not presented as confirmed");
  assert.match(r.text("uncertain"), /Waist placement: Whether the waistband sits at the natural waist/, "waist placement stays open");
  assert.doesNotMatch(r.text("uncertain"), /Waistband style/, "the confirmed waistband is not re-opened");
});

/* ------------------------------------------------------------------ Test 5: two-piece */
test("Test 5 — Two-piece set: separate specifications, correct sources, proportion flag, shared requirements", async () => {
  const analysis = {
    summary: "Pink floral two-piece.", garments: [{ name: "Top", type: "top" }, { name: "Trousers", type: "trousers" }],
    observations: [ob("Top", "neckline", "Bow-tie collar"), ob("Top", "sleeves", "Three-quarter sleeves"), ob("Top", "length_category", "Tunic length, flared"), ob("Top", "color", "Pink floral"), ob("Trousers", "silhouette", "Wide leg"), ob("Trousers", "length_category", "Full length"), ob("Trousers", "waistband", "Not visible", "unknown"),
      ob("Top", "design_details", "Band/mandarin collar", "observed", "client_description")],
    missing_information: [], differences: [{ topic: "Print", reference_shows: "Pink floral", client_wants: "Solid teal, no floral" }],
    questions: [choice("top_len", "Top length?", ["Waist-length", "Hip"], { topic: "length", piece: "Top", priority: "high" }), choice("collar", "Collar?", ["Band/mandarin collar", "Bow-tie"], { topic: "neckline", piece: "Top" }), choice("sleeves", "Sleeves?", ["Three-quarter", "Short"], { topic: "sleeves", piece: "Top" }), choice("fabric", "Fabric look?", ["Linen-blend preference", "Cotton"], { topic: "fabric" }), choice("trouser_waist", "Trouser waistband?", ["Elastic-back waistband with pockets", "Flat"], { topic: "waistband", piece: "Trousers" })],
  };
  assert.deepEqual(autoRequested("Two-piece set", analysis.garments as never), ["Top", "Trousers"], "a two-piece selection with two visible pieces needs no question");
  const r = await run({
    garment: "Two-piece set", description: "Solid teal matching top and trousers, no floral. A modest but interesting top and comfortable relaxed trousers. Each piece must be wearable on its own. Top length and sleeve style undecided.", analysis,
    answers: { top_len: "Waist-length top", collar: "Band/mandarin collar", sleeves: "Three-quarter sleeves", fabric: "Linen-blend preference", trouser_waist: "Elastic-back waistband with pockets" },
    followups: [choice("placket", "Front closure?", ["Front button placket", "Zip"], { topic: "closure", piece: "Top" }), qn("trouser_len", "Trouser length?", { topic: "length", piece: "Trousers" })],
    followupAnswers: { placket: "Front button placket", trouser_len: "Full-length to the ankle" },
    brief: brief({
      title: "Teal two-piece set", shared_requirements: "Solid teal on both pieces; each piece wearable on its own.",
      pieces: [piece("Top", { body_measurements: ["Bust", "Shoulder width"], garment_dimensions: ["Top finished length", "Sleeve length"], construction_and_finishing: "Band collar, front button placket." }), piece("Trousers", { body_measurements: ["Waist", "Inseam"], garment_dimensions: ["Trouser finished length", "Elastic waistband depth"], construction_and_finishing: "Elastic back waistband." })],
      technical_gaps: [{ topic: "pocket_style", detail: "Pocket style and position are not specified", piece: "Trousers", status: "unknown", ref: "q:trouser_waist" }],
      unresolved: [{ topic: "collar", detail: "Collar style undecided", piece: "Top", ref: "" }],
    }),
  });
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.fu.map((q) => q.id), ["placket", "trouser_len"], "'length' confirmed for the TOP does not block asking about the trousers' length");
  // sources: the collar is a client decision, never "observed"
  assert.match(r.text("confirmed", undefined), /Top:[\s\S]*Band\/mandarin collar \(reference: Bow-tie collar\)/);
  assert.doesNotMatch(r.text("specification", "Top"), /mandarin/i, "the mandarin collar is not listed as something observed");
  assert.doesNotMatch(r.text("uncertain"), /collar/i, "a confirmed collar is not re-opened");
  // separate specifications for each piece
  for (const base of ["Specification (from the reference)", "Fit and comfort", "Fabric and material preferences", "Construction and finishing", "Body measurements to take from the client", "Garment dimensions and design specifications"])
    for (const p of ["Top", "Trousers"]) assert.ok(r.titles.includes(`${p} — ${base}`), `${p} — ${base}`);
  assert.match(r.text("body_measurements", "Top"), /Bust/);
  assert.doesNotMatch(r.text("body_measurements", "Top"), /Inseam/);
  assert.match(r.text("garment_dimensions", "Trousers"), /Elastic waistband depth/);
  assert.doesNotMatch(r.text("garment_dimensions", "Trousers"), /Sleeve/);
  // shared requirements and changes
  assert.match(r.text("overview"), /Shared requirements: Solid teal on both pieces; each piece wearable on its own/);
  assert.match(r.text("confirmed"), /Print: Solid teal, no floral \(reference: Pink floral\)/);
  // linen-blend = preference, not a selected fabric
  assert.match(r.text("confirmed"), /Linen-blend preference — a preference only; no physical fabric has been selected or approved/);
  // generic pockets stay open as a consequence, not as a repeated question
  assert.match(r.text("unknown"), /Trousers — Pocket style: Pocket style and position are not specified/);
  // shortening the tunic changes proportions
  assert.match(r.text("unknown"), /Top — Proportion check: length changes from "Tunic length, flared" to "Waist-length top".*may need redesign/);
});

/* ------------------------------------------------------------------ cross-cutting */
test("clarification stops after ONE follow-up round: the model is not consulted again", async () => {
  const analysis = { summary: "x", garments: [{ name: "Dress", type: "dress" }], observations: [ob("Dress", "color", "Red")], missing_information: [], differences: [], questions: [choice("fit", "Fit?", ["A", "B"], { topic: "fit" })] };
  const stub = stubFetch([{ json: completion({ questions: [qn("extra", "Anything else?", { topic: "extra" })] }) }]);
  const provider = createLiveProvider(config, stub.fn);
  const base = { description: "d", garment: "Dress", occasion: "", observations: [ob("Dress", "color", "Red")], differences: [], requested: [] };
  const first = (await (await handleClarify(post({ ...base, questions: [{ ...analysis.questions[0], round: 1, answer: "A" }] }), provider)).json()).data.questions;
  assert.equal(first.length, 1);
  assert.equal(first[0].round, 2);
  assert.equal(followupUsed(first), true);
  const second = (await (await handleClarify(post({ ...base, questions: [{ ...analysis.questions[0], round: 1, answer: "A" }, { ...first[0], skipped: true }] }), provider)).json()).data.questions;
  assert.deepEqual(second, []);
  assert.equal(stub.calls.length, 1, "no second model call");
});

test("skipping is real: a brief can be generated with every question skipped, and the skips stay unresolved", async () => {
  const analysis = { summary: "x", garments: [{ name: "Dress", type: "dress" }], observations: [ob("Dress", "color", "Red")], missing_information: [], differences: [],
    questions: [choice("fit", "How should it fit?", ["Fitted", "Relaxed"], { topic: "fit", priority: "high" }), choice("fabric", "Which fabric look?", ["Crepe", "Satin"], { topic: "fabric", priority: "high" })] };
  const r = await run({ garment: "Dress", description: "A red dress", analysis, answers: { fit: null, fabric: null }, brief: brief() });
  assert.equal(r.res.status, 200);
  assert.match(r.text("uncertain"), /How should it fit\? \(Skipped by the designer\)/);
  assert.match(r.text("uncertain"), /Which fabric look\? \(Skipped by the designer\)/);
  assert.equal(r.text("confirmed").includes("fit"), false);
  assert.doesNotMatch(r.text("confirmed"), /Fabric/);
});

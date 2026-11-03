import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleAnalyze, handleClarify, handleGenerate } from "../src/lib/server/handlers";
import { createLiveProvider, mockProvider } from "../src/lib/server/provider";
import { _resetRateLimit } from "../src/lib/server/rate-limit";
import { loadDrafts, saveDraft } from "../src/lib/storage";
import { answersKey } from "../src/lib/clarify";
import { confirmDecision, markUncertain } from "../src/lib/decisions";
import { ANALYZE_SYSTEM, CLARIFY_SYSTEM, GENERATE_SYSTEM } from "../src/lib/meta/prompts";
import { completion, goodAnalyzeBody, liveAnalysisJson, liveBriefJson, stubFetch } from "./helpers";
import type { Observation, Question, SavedBrief } from "../src/lib/types";

const config = { apiKey: "LLM_1_k", model: "muse-spark-1.3", baseUrl: "https://api.meta.ai/v1" };
const post = (b: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(b) });
const userText = (init: RequestInit) => (JSON.parse(init.body as string).messages[1].content as { type: string; text?: string }[]).find((p) => p.type === "text")!.text!;
beforeEach(() => _resetRateLimit());

test("workflow: ledger reaches the model — answered, skipped, designer-corrected and carried-over decisions each keep their status; a revision changes only what changed", async () => {
  const stub = stubFetch([{ json: completion(liveAnalysisJson) }, { json: completion({ questions: [] }) }, { json: completion(liveBriefJson) }, { json: completion({ ...liveBriefJson, title: "Revised" }) }]);
  const provider = createLiveProvider(config, stub.fn);
  const a = (await (await handleAnalyze(post(goodAnalyzeBody()), provider)).json()).data;
  assert.ok(a.observations.some((o: Observation) => o.status === "uncertain" || o.status === "unknown"), "ambiguity is surfaced as uncertain/unknown details");
  assert.ok(a.questions.every((q: Question) => q.reason.length > 0 && q.topic));
  assert.ok(a.missing_information.length > 0);

  let questions: Question[] = a.questions.map((q: Question) => (q.id === "fit" ? { ...q, answer: "Fitted" } : { ...q, skipped: true }));
  const observations: Observation[] = a.observations.map((o: Observation) => (o.key === "silhouette" ? confirmDecision(o, "A-line") : o.key === "sleeves" ? markUncertain(o) : o));
  const ctx = { ...goodAnalyzeBody(), image: undefined, observations, differences: a.differences, requested: ["Dress"] };

  await handleClarify(post({ ...ctx, questions }), provider);
  const clarifyText = userText(stub.calls[1].init);
  assert.match(clarifyText, /- fit \(answered\)/);
  assert.match(clarifyText, /- changes \(skipped\)/);
  assert.match(clarifyText, /CLIENT-CONFIRMED \(Dress\) Silhouette: A-line/);

  await handleGenerate(post({ ...ctx, questions }), provider);
  const t1 = userText(stub.calls[2].init);
  assert.match(t1, /\[q:fit\] CLIENT-CONFIRMED Fit: Fitted/);
  assert.match(t1, /\[q:changes\] UNKNOWN Changes: Changes from reference\? — Skipped by the designer/);
  assert.match(t1, /\[obs:Dress:silhouette\] CLIENT-CONFIRMED \(Dress\) Silhouette: A-line/);
  assert.match(t1, /\[obs:Dress:sleeves\] UNCERTAIN \(Dress\) Sleeves: Sleeveless — Marked uncertain by the designer/);
  assert.match(t1, /Neckline: A higher neckline \(reference: Draped V neckline\)/, "the client's change replaces the reference detail in the ledger");
  assert.doesNotMatch(t1, /Draped V\b(?! neckline)/, "no contradictory second version of the neckline");
  assert.match(t1, /Garments to create: Dress/);

  // revision: change the answer, regenerate
  questions = questions.map((q) => (q.id === "fit" ? { ...q, answer: "Relaxed" } : q));
  const g2 = await (await handleGenerate(post({ ...ctx, questions }), provider)).json();
  const t2 = userText(stub.calls[3].init);
  assert.match(t2, /Fit: Relaxed/);
  assert.doesNotMatch(t2, /Fit: Fitted/);
  assert.equal(g2.data.brief.title, "Revised");
  assert.match(g2.data.sections.find((s: { kind: string }) => s.kind === "confirmed").body, /Fit: Relaxed/);
});

test("system prompts carry the rules that cannot be enforced in code", () => {
  assert.match(ANALYZE_SYSTEM, /never invent differences/);
  assert.match(ANALYZE_SYSTEM, /A garment being visible does not mean the client wants it made/);
  assert.match(ANALYZE_SYSTEM, /never ask about something the client's description already states/);
  assert.match(CLARIFY_SYSTEM, /single follow-up round/);
  assert.match(CLARIFY_SYSTEM, /A skipped question stays skipped/);
  assert.match(GENERATE_SYSTEM, /Do NOT restate or re-list confirmed decisions/);
  assert.match(GENERATE_SYSTEM, /never state or imply a fabric is chosen, approved or has a composition/);
  assert.match(GENERATE_SYSTEM, /Do not write any number unless it appears in the ledger/);
  assert.match(GENERATE_SYSTEM, /flare or panel proportions may need redesign/);
});

test("drafts keep decisions, answers, review flags and the garment choice across save/reload; edits survive", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const obs = markUncertain({ piece: "Dress", key: "neckline", label: "Neckline", value: "Square", status: "observed", origin: "image" } as Observation);
  const base: SavedBrief = {
    id: "d1", title: "T", updated: "", status: "Draft", image: "", updatedAt: new Date().toISOString(), requested: ["Dress"],
    sections: [{ title: "Garment overview", body: "orig", kind: "overview" }], observations: [obs],
    questions: [{ id: "fit", question: "q", reason: "r", type: "text", options: [], priority: "normal", topic: "fit", piece: "", answer: "Fitted", needsReview: true, round: 2 }],
  };
  saveDraft(base, store);
  saveDraft({ ...base, title: "T v2", status: "Ready", sections: [{ ...base.sections![0], body: "Designer rewrote this" }] }, store);
  const [d] = loadDrafts(store);
  assert.equal(loadDrafts(store).length, 1);
  assert.equal(d.sections![0].body, "Designer rewrote this");
  assert.deepEqual([d.observations![0].status, d.observations![0].previousStatus], ["uncertain", "observed"], "Mark as uncertain survives a reload and stays reversible");
  assert.deepEqual([d.questions![0].needsReview, d.questions![0].round], [true, 2]);
  assert.deepEqual(d.requested, ["Dress"]);
  assert.equal(d.status, "Ready");
});

test("stale detection covers answers, skips, observation status, differences and the garment choice", () => {
  const q = (over: Partial<Question> = {}): Question => ({ id: "fit", question: "q", reason: "r", type: "text", options: [], priority: "normal", topic: "fit", piece: "", answer: "Fitted", ...over });
  const obs = liveAnalysisJson.observations as unknown as Observation[];
  const diffs = liveAnalysisJson.differences;
  const k = answersKey([q()], obs, diffs, ["Dress"]);
  assert.equal(answersKey([q({ answer: " Fitted " })], obs, diffs, ["Dress"]), k);
  assert.notEqual(answersKey([q({ answer: "Relaxed" })], obs, diffs, ["Dress"]), k);
  assert.notEqual(answersKey([q({ answer: undefined, skipped: true })], obs, diffs, ["Dress"]), k);
  assert.notEqual(answersKey([q({ needsReview: true })], obs, diffs, ["Dress"]), k);
  assert.notEqual(answersKey([q()], [markUncertain(obs[0]), ...obs.slice(1)], diffs, ["Dress"]), k, "marking a detail uncertain makes the brief stale");
  assert.notEqual(answersKey([q()], obs, [], ["Dress"]), k);
  assert.notEqual(answersKey([q()], obs, diffs, ["Dress", "Jeans"]), k);
});

test("mock mode never fabricates differences or observed details", async () => {
  const a = await mockProvider.analyze({ ...goodAnalyzeBody() } as never);
  assert.deepEqual(a.differences, []);
  assert.ok(a.observations.every((o) => o.status !== "observed"));
});

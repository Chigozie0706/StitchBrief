import test from "node:test";
import assert from "node:assert/strict";
import { handleAnalyze, handleClarify, handleGenerate } from "../src/lib/server/handlers";
import { createLiveProvider } from "../src/lib/server/provider";
import { _resetRateLimit } from "../src/lib/server/rate-limit";
import { loadDrafts, saveDraft } from "../src/lib/storage";
import { briefToSections } from "../src/lib/brief";
import { GENERATE_SYSTEM, ANALYZE_SYSTEM } from "../src/lib/meta/prompts";
import { completion, goodAnalyzeBody, liveAnalysisJson, liveBriefJson, stubFetch } from "./helpers";
import type { Question, SavedBrief } from "../src/lib/types";

const config = { apiKey: "LLM_1_k", model: "muse-spark-1.3", baseUrl: "https://api.meta.ai/v1" };
const post = (b: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(b) });
const userText = (init: RequestInit) => (JSON.parse(init.body as string).messages[1].content as { type: string; text?: string }[]).find((p) => p.type === "text")!.text!;

test("end-to-end workflow with a stubbed model: ambiguity -> questions -> preserved answers -> brief -> revision", async () => {
  _resetRateLimit();
  const stub = stubFetch([
    { json: completion(liveAnalysisJson) },
    { json: completion({ questions: [liveAnalysisJson.questions[0], { id: "lining", question: "Should it be lined?", reason: "Opacity.", type: "single_select", options: ["Fully lined", "Unlined"], required: false }] }) },
    { json: completion(liveBriefJson) },
    { json: completion({ ...liveBriefJson, title: "Revised" }) },
  ]);
  const provider = createLiveProvider(config, stub.fn);

  // 1. analyze: ambiguity is surfaced as low-confidence/unknown observations + targeted questions
  const a = (await (await handleAnalyze(post(goodAnalyzeBody()), provider)).json()).data;
  assert.ok(a.observations.some((o: { source: string; confidence: string }) => o.source === "unknown" || o.confidence === "low"), "ambiguous details flagged");
  assert.ok(a.questions.length >= 2 && a.questions.every((q: Question) => q.reason.length > 0), "each question explains why it matters");
  assert.ok(a.missing_information.length > 0, "missing info returned by API");

  // 2. designer answers one, skips one, and corrects an observation (-> client_confirmed)
  let questions: Question[] = a.questions.map((q: Question) => (q.id === "fit" ? { ...q, answer: "Fitted" } : { ...q, skipped: true }));
  const observations = a.observations.map((o: { key: string }) => (o.key === "neckline" ? { ...o, value: "Raised V, 2cm higher", source: "client_confirmed", confidence: "high" } : o));
  const ctx = { ...goodAnalyzeBody(), image: undefined, observations };

  // 3. clarify: answers are sent to the model; repeated questions are dropped; only the new one comes back
  const c = (await (await handleClarify(post({ ...ctx, questions }), provider)).json()).data.questions;
  assert.deepEqual(c.map((q: Question) => q.id), ["lining"]);
  assert.match(userText(stub.calls[1].init), /\[fit\].*\n\s+status: ANSWERED: Fitted/);
  assert.match(userText(stub.calls[1].init), /\[changes\].*\n\s+status: SKIPPED/);
  questions = [...questions, { ...c[0], answer: "Fully lined" }];

  // 4. generate: every answer, the skip, and the designer's correction reach the model
  const g1 = await (await handleGenerate(post({ ...ctx, questions }), provider)).json();
  const t1 = userText(stub.calls[2].init);
  assert.match(t1, /ANSWERED: Fitted/); assert.match(t1, /ANSWERED: Fully lined/); assert.match(t1, /SKIPPED/);
  assert.match(t1, /Neckline: Raised V, 2cm higher \(source: client_confirmed, confidence: high\)/);
  assert.equal(g1.data.brief.title, "Burgundy evening dress");
  assert.equal(briefToSections(g1.data.brief).length, 12);
  assert.match(GENERATE_SYSTEM, /None confirmed/); assert.match(GENERATE_SYSTEM, /never infer measurements/);
  assert.match(ANALYZE_SYSTEM, /Never state exact measurements/);

  // 5. revision: change an answer, regenerate -> new answer is sent and the old one is not
  questions = questions.map((q) => (q.id === "fit" ? { ...q, answer: "Relaxed" } : q));
  const g2 = await (await handleGenerate(post({ ...ctx, questions }), provider)).json();
  const t2 = userText(stub.calls[3].init);
  assert.match(t2, /ANSWERED: Relaxed/); assert.doesNotMatch(t2, /ANSWERED: Fitted/);
  assert.equal(g2.data.brief.title, "Revised");
});

test("manual edits + answers survive save/reload (the editor revision path)", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const sections = briefToSections(liveBriefJson as never);
  const base: SavedBrief = { id: "d1", title: "T", updated: "", status: "Draft", image: "", sections, updatedAt: new Date().toISOString(), questions: [{ id: "fit", question: "q", reason: "r", type: "text", options: [], required: false, answer: "Fitted" }] };
  saveDraft(base, store);
  const edited = sections.map((s, i) => (i === 0 ? { ...s, body: "Designer rewrote this" } : s));
  saveDraft({ ...base, title: "T v2", sections: edited, status: "Ready" }, store);
  const [d] = loadDrafts(store);
  assert.equal(loadDrafts(store).length, 1);
  assert.equal(d.sections![0].body, "Designer rewrote this");
  assert.equal(d.questions![0].answer, "Fitted");
  assert.equal(d.status, "Ready");
});

import { answersKey } from "../src/lib/clarify";
import { parseAnalysisResult, parseClarifyRequest, parseDifferences } from "../src/lib/validation";
import { mockProvider } from "../src/lib/server/provider";

test("differences: validated from model output, optional in requests, and passed to clarify + generate prompts", async () => {
  _resetRateLimit();
  // required in model output (schema says required) and strictly validated
  assert.equal(parseAnalysisResult(liveAnalysisJson).ok, true);
  const { differences: _d, ...without } = liveAnalysisJson;
  assert.equal(parseAnalysisResult(without).ok, false);
  assert.equal(parseAnalysisResult({ ...liveAnalysisJson, differences: [{ topic: "x" }] }).ok, false);
  assert.equal(parseAnalysisResult({ ...liveAnalysisJson, differences: [] }).ok, true);
  assert.equal(parseDifferences(new Array(9).fill(liveAnalysisJson.differences[0])).ok, false);
  // older clients that omit it still work
  const base = { ...goodAnalyzeBody(), image: undefined, observations: liveAnalysisJson.observations, questions: [] };
  const parsed = parseClarifyRequest(base);
  assert.equal(parsed.ok && parsed.value.differences.length, 0);

  const stub = stubFetch([{ json: completion({ questions: [] }) }, { json: completion(liveBriefJson) }]);
  const provider = createLiveProvider(config, stub.fn);
  const body = { ...base, differences: liveAnalysisJson.differences };
  await handleClarify(post(body), provider);
  await handleGenerate(post(body), provider);
  for (const i of [0, 1]) assert.match(userText(stub.calls[i].init), /Neckline: reference shows "Draped V neckline"; client wants "A higher neckline"/);
  assert.match(GENERATE_SYSTEM, /client_confirmed_modifications/);
  assert.match(ANALYZE_SYSTEM, /never invent differences/);
});

test("mock mode never fabricates differences", async () => {
  const a = await mockProvider.analyze({ ...goodAnalyzeBody() } as never);
  assert.deepEqual(a.differences, []);
});

test("stale detection: any answer, skip, observation or difference change alters the key; identical state does not", () => {
  const q = (over: Partial<Question> = {}): Question => ({ id: "fit", question: "q", reason: "r", type: "text", options: [], required: false, answer: "Fitted", ...over });
  const obs = liveAnalysisJson.observations as never[];
  const diffs = liveAnalysisJson.differences;
  const k = answersKey([q()], obs, diffs);
  assert.equal(answersKey([q()], obs, diffs), k, "same inputs -> same key");
  assert.equal(answersKey([q({ answer: " Fitted " })], obs, diffs), k, "whitespace is not a change");
  assert.notEqual(answersKey([q({ answer: "Relaxed" })], obs, diffs), k);
  assert.notEqual(answersKey([q({ answer: undefined, skipped: true })], obs, diffs), k);
  assert.notEqual(answersKey([q()], [{ ...(obs[0] as object), value: "edited" }] as never, diffs), k);
  assert.notEqual(answersKey([q()], obs, []), k);
});

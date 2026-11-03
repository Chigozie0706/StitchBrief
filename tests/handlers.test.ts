import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleAnalyze, handleClarify, handleGenerate, handleHealth } from "../src/lib/server/handlers";
import { createLiveProvider, getProvider, mockProvider } from "../src/lib/server/provider";
import { _resetRateLimit } from "../src/lib/server/rate-limit";
import { dedupeQuestions } from "../src/lib/clarify";
import { GIF, choice, completion, goodAnalyzeBody, liveAnalysisJson, liveBriefJson, qn, stubFetch } from "./helpers";
import type { Question } from "../src/lib/types";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const config = { apiKey: "LLM_1_k", model: "muse-spark-1.3", baseUrl: "https://api.meta.ai/v1" };
beforeEach(() => _resetRateLimit());
const genBody = (over: Record<string, unknown> = {}) => ({ ...goodAnalyzeBody(), image: undefined, observations: liveAnalysisJson.observations, differences: [], requested: [], questions: [], ...over });

test("no MODEL_API_KEY -> mock provider, clearly labelled, never claims to have observed the image", async () => {
  assert.equal(getProvider({}).mode, "mock");
  const res = await handleAnalyze(post(goodAnalyzeBody()), mockProvider);
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual([json.provider, json.model], ["mock", null]);
  assert.ok(json.data.observations.length >= 9);
  assert.ok(json.data.observations.every((o: { status: string }) => o.status !== "observed"));
  assert.ok(json.data.questions.every((q: Question) => q.priority && q.topic && !("required" in q)), "no question is 'required': every one can be skipped");
});

test("analyze rejects bad input with 400 and never calls the provider", async () => {
  let called = false;
  const spy = { ...mockProvider, analyze: async () => { called = true; return mockProvider.analyze(goodAnalyzeBody() as never); } };
  for (const body of [{ ...goodAnalyzeBody(GIF) }, { ...goodAnalyzeBody(), description: "" }, "{bad json", { nope: 1 }]) {
    const res = await handleAnalyze(post(body), spy);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).ok, false);
  }
  assert.equal(called, false);
});

test("oversized request bodies are refused with 413", async () => {
  assert.equal((await handleAnalyze(post(goodAnalyzeBody(), { "content-length": "99000000" }), mockProvider)).status, 413);
});

test("live analyze: output is validated, questions are capped, de-duplicated by topic and stamped round 1", async () => {
  const many = { ...liveAnalysisJson, questions: [...liveAnalysisJson.questions, qn("fit2", "How snug?", { topic: "fit" }), ...["a", "b", "c", "d", "e"].map((x) => qn(x, `Question ${x}?`, { topic: `t_${x}` }))] };
  const { fn, calls } = stubFetch([{ json: completion(many) }]);
  const json = await (await handleAnalyze(post(goodAnalyzeBody()), createLiveProvider(config, fn))).json();
  assert.equal(json.provider, "live");
  assert.equal(json.data.questions.length, 5);
  assert.ok(!json.data.questions.some((q: Question) => q.id === "fit2"), "same topic twice is one question");
  assert.ok(json.data.questions.every((q: Question) => q.round === 1));
  assert.equal(JSON.parse(calls[0].init.body as string).messages[1].content[1].type, "image_url");
});

test("analysis never asks about something the client's own description already settles", async () => {
  const withNeckline = { ...liveAnalysisJson, questions: [...liveAnalysisJson.questions, choice("neck", "Which neckline?", ["V", "Square"], { topic: "neckline" })] };
  const json = await (await handleAnalyze(post(goodAnalyzeBody()), createLiveProvider(config, stubFetch([{ json: completion(withNeckline) }]).fn))).json();
  assert.ok(!json.data.questions.some((q: Question) => q.id === "neck"), "'a higher neckline' is already a stated decision (difference)");
});

test("invalid model output is retried once then surfaced as 502, never repaired; invalid-then-valid succeeds", async () => {
  const bad = stubFetch([{ json: completion({ summary: "x" }) }]);
  const res = await handleAnalyze(post(goodAnalyzeBody()), createLiveProvider(config, bad.fn));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, "invalid_model_output");
  assert.equal(bad.calls.length, 2);
  _resetRateLimit();
  const ok = await handleAnalyze(post(goodAnalyzeBody()), createLiveProvider(config, stubFetch([{ json: completion("garbage") }, { json: completion(liveAnalysisJson) }]).fn));
  assert.equal(ok.status, 200);
});

test("upstream 401/429 surface as safe errors", async () => {
  const r401 = await handleAnalyze(post(goodAnalyzeBody()), createLiveProvider(config, stubFetch([{ status: 401, json: {} }]).fn));
  assert.equal(r401.status, 502);
  assert.match((await r401.json()).error.message, /MODEL_API_KEY/);
  _resetRateLimit();
  assert.equal((await handleAnalyze(post(goodAnalyzeBody()), createLiveProvider(config, stubFetch([{ status: 429, json: {} }]).fn))).status, 429);
});

test("generate-brief: a valid model brief is assembled into labelled sections; an incomplete one is rejected", async () => {
  const ok = await handleGenerate(post(genBody()), createLiveProvider(config, stubFetch([{ json: completion(liveBriefJson) }]).fn));
  const json = await ok.json();
  assert.equal(ok.status, 200);
  assert.equal(json.data.brief.title, "Burgundy evening dress");
  assert.deepEqual(json.data.sections.map((s: { kind: string }) => s.kind), ["overview", "confirmed", "specification", "fit", "fabric", "construction", "body_measurements", "garment_dimensions", "suggestions", "uncertain", "unknown", "checklist"]);
  const { garment_overview: _g, ...partial } = liveBriefJson;
  assert.equal((await handleGenerate(post(genBody()), createLiveProvider(config, stubFetch([{ json: completion(partial) }]).fn))).status, 502);
});

test("mock generate-brief: answered → confirmed; skipped → unresolved; nothing is 'confirmed' by default", async () => {
  const questions = [
    { ...choice("fit", "How should it fit?", ["Fitted", "Relaxed"], { topic: "fit" }), answer: "Fitted" },
    { ...qn("changes", "Changes from reference?", { topic: "changes" }), skipped: true },
  ];
  const data = (await (await handleGenerate(post(genBody({ questions })), mockProvider)).json()).data;
  const body = (k: string) => data.sections.filter((s: { kind: string }) => s.kind === k).map((s: { body: string }) => s.body).join("\n");
  assert.match(body("confirmed"), /Fit: Fitted/);
  assert.match(body("uncertain"), /Changes from reference\? \(Skipped by the designer\)/);
  assert.doesNotMatch(body("confirmed"), /Changes/);
  const empty = (await (await handleGenerate(post(genBody({ observations: liveAnalysisJson.observations.filter((o) => o.status !== "client_confirmed") })), mockProvider)).json()).data;
  assert.match(empty.sections.find((s: { kind: string }) => s.kind === "confirmed").body, /None recorded|Fit/);
});

test("dedupeQuestions: caps, drops repeated id / wording / topic, is garment-aware, and respects confirmed topics", () => {
  const q = (id: string, topic: string, piece = "", text = `Q ${id}`) => qn(id, text, { topic, piece }) as unknown as Question;
  assert.equal(dedupeQuestions([], ["a", "b", "c", "d", "e"].map((x) => q(x, x)), 3).length, 3);
  assert.deepEqual(dedupeQuestions([q("fit", "fit")], [q("fit", "x"), q("z", "fit"), q("y", "y", "", "Q fit")].concat(q("ok", "ok"))).map((x) => x.id), ["ok"]);
  assert.deepEqual(dedupeQuestions([q("l1", "length", "Top")], [q("l2", "length", "Trousers"), q("l3", "length", "Top")]).map((x) => x.id), ["l2"], "length for the top ≠ length for the trousers");
  assert.deepEqual(dedupeQuestions([], [q("n", "neckline_style")], 3, new Set(["|neckline"])).map((x) => x.id), [], "confirmed topics are never asked, however phrased");
});

test("rate limiting returns 429 with Retry-After", async () => {
  let last: Response | undefined;
  for (let i = 0; i < 25; i++) last = await handleAnalyze(post(goodAnalyzeBody(), { "x-forwarded-for": "9.9.9.9" }), mockProvider);
  assert.equal(last!.status, 429);
  assert.ok(last!.headers.get("retry-after"));
});

test("health: reports mode without exposing the key; verify lists models", async () => {
  const m = await (await handleHealth(new Request("http://x/api/health"), {})).json();
  assert.deepEqual([m.mode, m.keyConfigured, m.model], ["mock", false, null]);
  const env = { MODEL_API_KEY: "LLM_1_topsecret" };
  assert.doesNotMatch(await (await handleHealth(new Request("http://x/api/health"), env)).text(), /topsecret/);
  const v = await (await handleHealth(new Request("http://x/api/health?verify=1"), env, stubFetch([{ json: { data: [{ id: "muse-spark-1.3" }] } }]).fn)).json();
  assert.equal(v.configuredModelAvailable, true);
});

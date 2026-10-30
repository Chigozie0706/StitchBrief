import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleAnalyze, handleClarify, handleGenerate, handleHealth } from "../src/lib/server/handlers";
import { createLiveProvider, getProvider, mockProvider } from "../src/lib/server/provider";
import { _resetRateLimit } from "../src/lib/server/rate-limit";
import { dedupeQuestions, unresolvedRequired } from "../src/lib/clarify";
import { GIF, goodAnalyzeBody, liveAnalysisJson, liveBriefJson, completion, stubFetch } from "./helpers";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const config = { apiKey: "LLM_1_k", model: "muse-spark-1.3", baseUrl: "https://api.meta.ai/v1" };
beforeEach(() => _resetRateLimit());

test("no MODEL_API_KEY -> mock provider, clearly labelled in the response", async () => {
  assert.equal(getProvider({}).mode, "mock");
  const res = await handleAnalyze(post(goodAnalyzeBody()), mockProvider);
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.provider, "mock");
  assert.equal(json.model, null);
  assert.ok(json.data.observations.length >= 9);
  assert.ok(json.data.observations.every((o: { source: string }) => o.source !== "observed"), "mock must never claim to have observed the image");
});

test("analyze rejects bad input with 400 and does not call the provider", async () => {
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
  const res = await handleAnalyze(post(goodAnalyzeBody(), { "content-length": "99000000" }), mockProvider);
  assert.equal(res.status, 413);
});

test("live provider: analyze parses and validates model output", async () => {
  const { fn, calls } = stubFetch([{ json: completion(liveAnalysisJson) }]);
  const res = await handleAnalyze(post(goodAnalyzeBody()), createLiveProvider(config, fn));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.provider, "live");
  assert.equal(json.model, "muse-spark-1.3");
  assert.equal(json.data.observations[0].source, "observed");
  assert.equal(calls.length, 1);
  const sent = JSON.parse(calls[0].init.body as string);
  assert.equal(sent.messages[1].content[1].type, "image_url");
});

test("live provider: invalid model output is retried once then surfaced as 502, never invented", async () => {
  const { fn, calls } = stubFetch([{ json: completion({ summary: "x" }) }]);
  const res = await handleAnalyze(post(goodAnalyzeBody()), createLiveProvider(config, fn));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, "invalid_model_output");
  assert.equal(calls.length, 2);
});

test("live provider: invalid then valid output succeeds on the retry", async () => {
  const { fn } = stubFetch([{ json: completion("garbage") }, { json: completion(liveAnalysisJson) }]);
  const res = await handleAnalyze(post(goodAnalyzeBody()), createLiveProvider(config, fn));
  assert.equal(res.status, 200);
});

test("upstream 401/429/503 surface as safe errors", async () => {
  const r401 = await handleAnalyze(post(goodAnalyzeBody()), createLiveProvider(config, stubFetch([{ status: 401, json: {} }]).fn));
  assert.equal(r401.status, 502);
  assert.match((await r401.json()).error.message, /MODEL_API_KEY/);
  _resetRateLimit();
  const r429 = await handleAnalyze(post(goodAnalyzeBody()), createLiveProvider(config, stubFetch([{ status: 429, json: {} }]).fn));
  assert.equal(r429.status, 429);
});

test("generate-brief: valid brief passes through; incomplete brief is rejected", async () => {
  const body = { ...goodAnalyzeBody(), image: undefined, observations: liveAnalysisJson.observations, questions: [{ ...liveAnalysisJson.questions[0], answer: "Fitted" }] };
  const ok = await handleGenerate(post(body), createLiveProvider(config, stubFetch([{ json: completion(liveBriefJson) }]).fn));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).data.brief.title, "Burgundy evening dress");
  const { garment_overview: _g, ...partial } = liveBriefJson;
  const bad = await handleGenerate(post(body), createLiveProvider(config, stubFetch([{ json: completion(partial) }]).fn));
  assert.equal(bad.status, 502);
});

test("mock generate-brief: only answered questions become confirmed; skipped become open", async () => {
  const body = {
    ...goodAnalyzeBody(), image: undefined, observations: liveAnalysisJson.observations,
    questions: [
      { id: "fit", question: "How should it fit?", reason: "r", type: "single_select", options: ["Fitted", "Relaxed"], required: true, answer: "Fitted" },
      { id: "changes", question: "Changes from reference?", reason: "r", type: "text", options: [], required: false, skipped: true },
    ],
  };
  const json = await (await handleGenerate(post(body), mockProvider)).json();
  const b = json.data.brief;
  assert.match(b.silhouette_and_fit, /Fitted/);
  assert.equal(b.client_confirmed_modifications, "None confirmed.");
  assert.ok(b.open_questions.includes("Changes from reference?"));
  assert.ok(!b.open_questions.includes("How should it fit?"));
});

test("clarify never repeats an already-asked question (by id or wording)", async () => {
  const asked = liveAnalysisJson.questions.map((q) => ({ ...q, skipped: true }));
  const proposed = [
    { id: "fit", question: "x", reason: "r", type: "text", options: [], required: false },
    { id: "other", question: "How should it fit??", reason: "r", type: "text", options: [], required: false },
    { id: "lining", question: "Lined?", reason: "r", type: "single_select", options: ["Yes", "No"], required: false },
  ];
  const { fn } = stubFetch([{ json: completion({ questions: proposed }) }]);
  const body = { ...goodAnalyzeBody(), image: undefined, observations: liveAnalysisJson.observations, questions: asked };
  const res = await handleClarify(post(body), createLiveProvider(config, fn));
  const ids = (await res.json()).data.questions.map((q: { id: string }) => q.id);
  assert.deepEqual(ids, ["lining"]);
});

test("dedupeQuestions caps results; unresolvedRequired respects answer/skip", () => {
  const mk = (id: string) => ({ id, question: `Q ${id}`, reason: "r", type: "text" as const, options: [], required: true });
  assert.equal(dedupeQuestions([], ["a", "b", "c", "d", "e"].map(mk), 3).length, 3);
  assert.deepEqual(unresolvedRequired([{ ...mk("a"), answer: "x" }, { ...mk("b"), skipped: true }, mk("c")]).map((q) => q.id), ["c"]);
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
  const plain = await handleHealth(new Request("http://x/api/health"), env);
  assert.doesNotMatch(await plain.text(), /topsecret/);
  const { fn } = stubFetch([{ json: { data: [{ id: "muse-spark-1.3" }] } }]);
  const v = await (await handleHealth(new Request("http://x/api/health?verify=1"), env, fn)).json();
  assert.equal(v.configuredModelAvailable, true);
});

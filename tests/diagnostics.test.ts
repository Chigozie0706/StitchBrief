// Stage 1: every model attempt is recorded (outcome, finish_reason, token usage, exact reason) without logging anything sensitive.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ModelOutputError } from "../src/lib/meta/client";
import { setDiagnosticsSink } from "../src/lib/server/diagnostics";
import { handleAnalyze } from "../src/lib/server/handlers";
import { createLiveProvider } from "../src/lib/server/provider";
import { _resetRateLimit } from "../src/lib/server/rate-limit";
import { findDuplicateObservationKeys, parseAnalysisResult } from "../src/lib/validation";
import { JPEG, completion, goodAnalyzeBody, liveAnalysisJson, ob, stubFetch } from "./helpers";
import type { Observation } from "../src/lib/types";

const config = { apiKey: "LLM_1_SECRETKEY_8d2", model: "muse-spark-1.3", baseUrl: "https://api.meta.ai/v1" };
const post = (b: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(b) });
let records: Record<string, any>[] = [];
beforeEach(() => { _resetRateLimit(); records = []; setDiagnosticsSink((r) => records.push(r)); });
afterEach(() => setDiagnosticsSink(null));

/** valid analysis + a second design_details and a second closure for the same garment */
const dup = { ...liveAnalysisJson, observations: [...liveAnalysisJson.observations, ob("Dress", "design_details", "Bow at the waist"), ob("Dress", "closure", "Back zip"), ob("Dress", "closure", "Hidden hooks")] };
const withUsage = (body: unknown, usage: unknown, finish = "stop", extra: Record<string, unknown> = {}) => ({ id: "chatcmpl-abc123", usage, choices: [{ finish_reason: finish, message: { content: typeof body === "string" ? body : JSON.stringify(body), ...extra } }] });

test("duplicate failures record the exact garment/key pairs, for every attempt", async () => {
  const stub = stubFetch([{ json: completion(dup) }]);
  const res = await handleAnalyze(post(goodAnalyzeBody()), createLiveProvider(config, stub.fn));
  const json = await res.json();
  assert.equal(res.status, 502);
  assert.equal(records.length, 2, "both attempts are recorded, not just the last");
  for (const [i, r] of records.entries()) {
    assert.deepEqual([r.event, r.op, r.attempt, r.outcome, r.finish_reason, r.model], ["model_call", "analyze", i + 1, "invalid_output", "stop", "muse-spark-1.3"]);
    assert.match(r.error, /Dress\/design_details \(×2\)/);
    assert.match(r.error, /Dress\/closure \(×2\)/);
    assert.equal(typeof r.ms, "number");
  }
  assert.match(json.error.message, /did not return usable data \(both attempts: Model returned duplicate observation keys: Dress\/design_details \(×2\), Dress\/closure \(×2\)\)/);
});

test("the reason for the FIRST failure is preserved when the second attempt fails differently", async () => {
  const cut = { choices: [{ finish_reason: "length", message: { content: '{"summary":"A long' } }], usage: { prompt_tokens: 3000, completion_tokens: 8000, total_tokens: 11000, completion_tokens_details: { reasoning_tokens: 7600 } } };
  const stub = stubFetch([{ json: cut }, { json: completion(dup) }]);
  const provider = createLiveProvider(config, stub.fn);
  const err = await provider.analyze({ ...goodAnalyzeBody(), occasion: "Work / Office" } as never).catch((e) => e);
  assert.ok(err instanceof ModelOutputError);
  assert.deepEqual(err.attempts.map((a: { outcome: string }) => a.outcome), ["truncated", "invalid_output"]);
  assert.match(err.message, /attempt 1: The model response was cut off before it finished; attempt 2: Model returned duplicate observation keys/);
  assert.deepEqual(records.map((r) => r.outcome), ["truncated", "invalid_output"]);
});

test("finish_reason and token usage (including reasoning tokens) are recorded; absent fields are not invented", async () => {
  const usage = { prompt_tokens: 3100, completion_tokens: 5200, total_tokens: 8300, completion_tokens_details: { reasoning_tokens: 3900 } };
  const cut = withUsage('{"summary":"cut', usage, "length");
  await createLiveProvider(config, stubFetch([{ json: cut }, { json: cut }]).fn).analyze(goodAnalyzeBody() as never).catch(() => {});
  assert.deepEqual(records[0].usage, { promptTokens: 3100, completionTokens: 5200, reasoningTokens: 3900, totalTokens: 8300 });
  assert.equal(records[0].finish_reason, "length");
  assert.equal(records[0].outcome, "truncated");
  assert.equal(records[0].response_id, "chatcmpl-abc123");
  records = [];
  await createLiveProvider(config, stubFetch([{ json: withUsage(liveAnalysisJson, usage) }]).fn).analyze(goodAnalyzeBody() as never);
  assert.equal(records.length, 1);
  assert.deepEqual([records[0].outcome, records[0].finish_reason, records[0].usage.reasoningTokens], ["ok", "stop", 3900], "successful calls are recorded too, so reasoning cost can be measured");
  records = [];
  await createLiveProvider(config, stubFetch([{ json: withUsage(liveAnalysisJson, undefined) }]).fn).analyze(goodAnalyzeBody() as never);
  assert.deepEqual(records[0].usage, {}, "no usage reported → nothing fabricated");
  records = [];
  await createLiveProvider(config, stubFetch([{ json: withUsage(liveAnalysisJson, { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }) }]).fn).analyze(goodAnalyzeBody() as never);
  assert.deepEqual(records[0].usage, { promptTokens: 10, completionTokens: 20, totalTokens: 30 }, "reasoning_tokens is optional in Meta's schema");
});

test("each operation is labelled, and other failure kinds keep their own outcome", async () => {
  await createLiveProvider(config, stubFetch([{ json: completion("not json at all") }, { json: completion("") }]).fn).analyze(goodAnalyzeBody() as never).catch(() => {});
  assert.deepEqual(records.map((r) => [r.op, r.outcome]), [["analyze", "not_json"], ["analyze", "empty"]]);
});

test("NOTHING sensitive reaches the logs: no key, description, occasion, image, model output or reasoning text", async () => {
  const lines: string[] = [];
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  setDiagnosticsSink(null); // use the real console output path
  for (const m of ["log", "info", "warn", "error"] as const) console[m] = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    const body = { image: JPEG, description: "SECRET-DESCRIPTION-9f3 about my client", garment: "", occasion: "SECRET-OCCASION-77c" };
    const secretReasoning = { reasoning_content: "PRIVATE-REASONING-aa1" };
    // failing run: invalid JSON text containing a marker, then a duplicate-key run
    await handleAnalyze(post(body), createLiveProvider(config, stubFetch([{ json: withUsage("RAW-MODEL-OUTPUT-zz9 {not json", { total_tokens: 5 }, "stop", secretReasoning) }]).fn));
    _resetRateLimit();
    await handleAnalyze(post(body), createLiveProvider(config, stubFetch([{ json: withUsage(dup, { total_tokens: 5 }, "stop", secretReasoning) }]).fn));
    _resetRateLimit();
    await handleAnalyze(post(body), createLiveProvider(config, stubFetch([{ json: withUsage(liveAnalysisJson, { total_tokens: 5 }, "stop", secretReasoning) }]).fn));
  } finally { Object.assign(console, orig); }
  const all = lines.join("\n");
  assert.ok(lines.some((l) => l.startsWith("[meta] {") && l.includes('"event":"model_call"')), "model calls are logged");
  for (const secret of ["SECRET-DESCRIPTION", "SECRET-OCCASION", "LLM_1_SECRETKEY", JPEG.split(",")[1].slice(0, 40), "RAW-MODEL-OUTPUT", "PRIVATE-REASONING", "data:image", "Bearer"])
    assert.equal(all.includes(secret), false, `log output must not contain ${secret}`);
});

test("a failing log sink can never break a request", async () => {
  setDiagnosticsSink(() => { throw new Error("disk full"); });
  const res = await handleAnalyze(post(goodAnalyzeBody()), createLiveProvider(config, stubFetch([{ json: completion(liveAnalysisJson) }]).fn));
  assert.equal(res.status, 200);
});

test("findDuplicateObservationKeys: case-insensitive on the garment, counts repeats, ignores unique keys", () => {
  const o = (piece: string, key: Observation["key"]) => ({ piece, key, label: key, value: "v", status: "observed", origin: "image" }) as Observation;
  assert.deepEqual(findDuplicateObservationKeys([o("Top", "neckline"), o("top", "neckline"), o("Top", "neckline"), o("Top", "sleeves"), o("Trousers", "neckline")]), [{ piece: "Top", key: "neckline", count: 3 }]);
  assert.deepEqual(findDuplicateObservationKeys([o("Top", "neckline"), o("Trousers", "neckline")]), []);
});

test("strict validation is unchanged: duplicates are rejected, never merged or dropped", () => {
  const r = parseAnalysisResult(dup);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /^Model returned duplicate observation keys: Dress\/design_details \(×2\), Dress\/closure \(×2\)\.$/);
  assert.equal(parseAnalysisResult(liveAnalysisJson).ok, true);
});

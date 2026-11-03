// Stage 2: one observation per garment per key (prompt rule), and a retry that explains the previous failure. Validation stays strict.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setDiagnosticsSink } from "../src/lib/server/diagnostics";
import { handleAnalyze } from "../src/lib/server/handlers";
import { createLiveProvider } from "../src/lib/server/provider";
import { _resetRateLimit } from "../src/lib/server/rate-limit";
import { ANALYZE_SYSTEM, CLARIFY_SYSTEM, retryFeedback } from "../src/lib/meta/prompts";
import { JPEG, completion, liveAnalysisJson, ob, stubFetch } from "./helpers";

const config = { apiKey: "LLM_1_k", model: "muse-spark-1.3", baseUrl: "https://api.meta.ai/v1" };
const post = (b: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(b) });
const body = { image: JPEG, description: "SECRET-DESCRIPTION-9f3 office top", garment: "", occasion: "Work / Office" };
let records: Record<string, any>[] = [];
beforeEach(() => { _resetRateLimit(); records = []; setDiagnosticsSink((r) => records.push(r)); });
afterEach(() => setDiagnosticsSink(null));

const dup = { ...liveAnalysisJson, observations: [...liveAnalysisJson.observations, ob("Dress", "design_details", "Bow at the waist"), ob("Dress", "closure", "Back zip"), ob("Dress", "closure", "Hidden hooks")] };
/** the same analysis after the model has merged the repeated keys, as asked */
const merged = { ...liveAnalysisJson, observations: [...liveAnalysisJson.observations.map((o) => (o.key === "design_details" ? { ...o, value: "Not visible; bow at the waist", status: "observed" } : o)), ob("Dress", "closure", "Back zip; hidden hooks")] };
const userParts = (call: { init: RequestInit }) => JSON.parse(call.init.body as string).messages[1].content as { type: string; text?: string }[];
const feedbackOf = (call: { init: RequestInit }) => userParts(call).filter((p) => p.type === "text").map((p) => p.text!).find((t) => t.startsWith("Your previous answer was rejected"));

test("the analysis prompt states the rule: at most one observation per garment per key, merge related details", () => {
  assert.match(ANALYZE_SYSTEM, /AT MOST ONE observation per key/);
  assert.match(ANALYZE_SYSTEM, /Never repeat a key for the same garment/);
  assert.match(ANALYZE_SYSTEM, /combine them into ONE observation/);
  assert.match(ANALYZE_SYSTEM, /separated by semicolons/);
  assert.match(ANALYZE_SYSTEM, /Do not drop any detail: merge it/);
  assert.match(ANALYZE_SYSTEM, /no garment\/key pair appears twice/);
  assert.ok(ANALYZE_SYSTEM.includes("never invent differences"), "earlier rules are untouched");
});

test("the rule actually reaches the model in the request's system message", async () => {
  const stub = stubFetch([{ json: completion(liveAnalysisJson) }]);
  await createLiveProvider(config, stub.fn).analyze(body as never);
  assert.match(JSON.parse(stub.calls[0].init.body as string).messages[0].content, /AT MOST ONE observation per key/);
});

test("duplicate keys on the first attempt, valid second attempt: the retry explains the failure and the valid answer is used as-is", async () => {
  const stub = stubFetch([{ json: completion(dup) }, { json: completion(merged) }]);
  const res = await handleAnalyze(post(body), createLiveProvider(config, stub.fn));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(stub.calls.length, 2);
  assert.equal(feedbackOf(stub.calls[0]), undefined, "the first request carries no feedback");
  const fb = feedbackOf(stub.calls[1])!;
  assert.match(fb, /Dress\/design_details \(×2\)/);
  assert.match(fb, /Dress\/closure \(×2\)/);
  assert.match(fb, /Merge the details that share a key into ONE observation per garment \(separated by semicolons\); do not drop any detail/);
  assert.ok(fb.length < 600, "concise");
  // the retry is the original request plus ONE extra text part (image and system prompt are identical)
  const [a, b] = [userParts(stub.calls[0]), userParts(stub.calls[1])];
  assert.deepEqual(b.slice(0, a.length), a);
  assert.equal(b.length, a.length + 1);
  assert.equal(JSON.parse(stub.calls[0].init.body as string).messages[0].content, JSON.parse(stub.calls[1].init.body as string).messages[0].content);
  // the result is exactly the model's second answer; the app never merged or dropped anything itself
  assert.equal(json.data.observations.length, merged.observations.length);
  assert.equal(json.data.observations.filter((o: { key: string }) => o.key === "closure").length, 1);
  assert.equal(json.data.observations.find((o: { key: string }) => o.key === "closure").value, "Back zip; hidden hooks");
  assert.deepEqual(records.map((r) => [r.attempt, r.outcome, r.retry_hint ?? false]), [[1, "invalid_output", false], [2, "ok", true]]);
});

test("duplicate keys on both attempts: still rejected (502), exactly two model calls, nothing merged or discarded, both reasons kept", async () => {
  const stub = stubFetch([{ json: completion(dup) }]);
  const res = await handleAnalyze(post(body), createLiveProvider(config, stub.fn));
  const json = await res.json();
  assert.equal(res.status, 502);
  assert.equal(json.error.code, "invalid_model_output");
  assert.equal(json.data, undefined, "no analysis is returned, so no duplicate is silently resolved");
  assert.match(json.error.message, /both attempts: Model returned duplicate observation keys: Dress\/design_details \(×2\), Dress\/closure \(×2\)/);
  assert.equal(stub.calls.length, 2, "a retry, never a third attempt");
  assert.ok(feedbackOf(stub.calls[1]));
  assert.deepEqual(records.map((r) => r.outcome), ["invalid_output", "invalid_output"]);
  assert.equal(records[1].retry_hint, true);
});

test("a different failure on the retry is reported alongside the first (first reason is not lost)", async () => {
  const stub = stubFetch([{ json: completion(dup) }, { json: completion({ summary: "x" }) }]);
  const res = await handleAnalyze(post(body), createLiveProvider(config, stub.fn));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error.message, /attempt 1: Model returned duplicate observation keys: [^;]+; attempt 2: /);
});

test("invalid JSON also gets an explained retry; truncation and other non-validation failures do not (that is Stage 3)", async () => {
  const notJson = stubFetch([{ json: completion("RAW-MODEL-OUTPUT-zz9 {oops") }, { json: completion(liveAnalysisJson) }]);
  const ok = await createLiveProvider(config, notJson.fn).analyze(body as never);
  assert.ok(ok.observations.length > 0);
  assert.match(feedbackOf(notJson.calls[1])!, /not valid JSON/);
  const cut = stubFetch([{ json: { choices: [{ finish_reason: "length", message: { content: '{"summary":' } }] } }, { json: completion(liveAnalysisJson) }]);
  await createLiveProvider(config, cut.fn).analyze(body as never);
  assert.equal(feedbackOf(cut.calls[1]), undefined, "an explanation cannot fix a cut-off, so none is sent");
  assert.equal(cut.calls[0].init.body, cut.calls[1].init.body, "(unchanged in Stage 2: the repeat after truncation is addressed in Stage 3)");
});

test("the feedback contains only validation facts: never the description, occasion, image, key or the model's own text", async () => {
  const stub = stubFetch([{ json: completion({ ...dup, summary: "RAW-MODEL-OUTPUT-zz9" }) }, { json: completion(merged) }]);
  await createLiveProvider(config, stub.fn).analyze(body as never);
  const fb = feedbackOf(stub.calls[1])!;
  for (const secret of ["SECRET-DESCRIPTION", "Work / Office", "LLM_1_k", JPEG.split(",")[1].slice(0, 30), "RAW-MODEL-OUTPUT", "data:image"]) assert.equal(fb.includes(secret), false, secret);
});

test("feedback stays concise even for many collisions", () => {
  const many = Array.from({ length: 12 }, (_, i) => `Garment${i}/design_details (×2)`).join(", ");
  const fb = retryFeedback(`Model returned duplicate observation keys: ${many}.`);
  assert.ok(fb.length < 900);
  assert.match(retryFeedback("Question 2 has an invalid topic."), /^Your previous answer was rejected by validation: Question 2 has an invalid topic\.\nReturn the complete JSON again with exactly this problem fixed/);
  assert.doesNotMatch(retryFeedback("Question 2 has an invalid topic."), /Merge the details/, "the merge hint is only for duplicate keys");
});


test("clarification prompt explicitly defines the permitted question ID format", () => {
  assert.match(CLARIFY_SYSTEM, /unique, short snake_case "id"/);
  assert.match(CLARIFY_SYSTEM, /lowercase letters, numbers, underscores or hyphens/);
  assert.match(CLARIFY_SYSTEM, /trouser_waistband/);
});

test("invalid question ID retry feedback explains the permitted format", () => {
  const fb = retryFeedback("Question 0 has an invalid id.");

  assert.match(fb, /unique short snake_case identifier/);
  assert.match(fb, /lowercase letters, numbers, underscores or hyphens/);
  assert.match(fb, /trouser_waistband/);
  assert.doesNotMatch(fb, /Merge the details/);
});
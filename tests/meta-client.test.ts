import test from "node:test";
import assert from "node:assert/strict";
import { chatJson, listModels, MetaApiError, ModelOutputError, readMetaConfig, toMetaError } from "../src/lib/meta/client";
import { ANALYSIS_SCHEMA } from "../src/lib/meta/schemas";
import { completion, stubFetch } from "./helpers";

const config = { apiKey: "LLM_1_secret", model: "muse-spark-1.3", baseUrl: "https://api.meta.ai/v1" };
const base = { config, system: "s", user: [{ type: "text" as const, text: "hi" }], schemaName: "x", schema: ANALYSIS_SCHEMA as unknown as Record<string, unknown>, sleep: async () => {} };

test("missing MODEL_API_KEY -> null config (mock mode); MOCK_MODE forces mock", () => {
  assert.equal(readMetaConfig({}), null);
  assert.equal(readMetaConfig({ MODEL_API_KEY: "  " }), null);
  assert.equal(readMetaConfig({ MODEL_API_KEY: "k", MOCK_MODE: "true" }), null);
  assert.deepEqual(readMetaConfig({ MODEL_API_KEY: "k" }), { apiKey: "k", model: "muse-spark-1.3", baseUrl: "https://api.meta.ai/v1" });
  assert.equal(readMetaConfig({ MODEL_API_KEY: "k", META_MODEL: "muse-wonder-1.0" })?.model, "muse-wonder-1.0");
});

test("sends the documented request shape: bearer auth, json_schema response_format, image_url object", async () => {
  const { fn, calls } = stubFetch([{ json: completion({ ok: 1 }) }]);
  const out = await chatJson({ ...base, fetchImpl: fn, user: [{ type: "text", text: "t" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] });
  assert.deepEqual(out, { ok: 1 });
  assert.equal(calls[0].url, "https://api.meta.ai/v1/chat/completions");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer LLM_1_secret");
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.model, "muse-spark-1.3");
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.name, "x");
  assert.deepEqual(body.messages[1].content[1], { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
  assert.equal(body.messages[0].role, "system");
});

test("tolerates fenced JSON; rejects non-JSON, empty and truncated output", async () => {
  assert.deepEqual(await chatJson({ ...base, fetchImpl: stubFetch([{ json: completion("```json\n{\"a\":1}\n```") }]).fn }), { a: 1 });
  await assert.rejects(chatJson({ ...base, fetchImpl: stubFetch([{ json: completion("not json") }]).fn }), ModelOutputError);
  await assert.rejects(chatJson({ ...base, fetchImpl: stubFetch([{ json: completion("") }]).fn }), ModelOutputError);
  await assert.rejects(chatJson({ ...base, fetchImpl: stubFetch([{ json: completion("{\"a\":", "length") }]).fn }), /cut off/);
});

test("maps upstream errors to safe messages without leaking the key or upstream body", async () => {
  for (const [status, fragment] of [[401, "MODEL_API_KEY"], [402, "billing"], [403, "access"], [404, "META_MODEL"], [413, "too large"]] as const) {
    const { fn } = stubFetch([{ status, json: { error: { message: "secret detail LLM_1_secret", type: "x", code: null } } }]);
    await assert.rejects(chatJson({ ...base, fetchImpl: fn }), (e: MetaApiError) => {
      assert.ok(e instanceof MetaApiError);
      assert.match(e.message, new RegExp(fragment, "i"));
      assert.doesNotMatch(e.message, /LLM_1_secret/);
      return true;
    });
  }
});

test("400 includes a truncated upstream hint (e.g. undecodable image)", () => {
  const e = toMetaError(400, { error: { message: "image 0 could not be decoded", type: "invalid_request_error", code: null } });
  assert.match(e.message, /could not be decoded/);
});

test("retries 429 then succeeds, honouring Retry-After; does not retry 401", async () => {
  const waits: number[] = [];
  const ok = stubFetch([{ status: 429, headers: { "retry-after": "2" }, json: { error: { type: "rate_limit_error" } } }, { json: completion({ done: true }) }]);
  assert.deepEqual(await chatJson({ ...base, fetchImpl: ok.fn, sleep: async (ms) => { waits.push(ms); } }), { done: true });
  assert.equal(ok.calls.length, 2);
  assert.deepEqual(waits, [2000]);
  const bad = stubFetch([{ status: 401, json: {} }]);
  await assert.rejects(chatJson({ ...base, fetchImpl: bad.fn }), MetaApiError);
  assert.equal(bad.calls.length, 1);
});

test("gives up after maxRetries on persistent 503", async () => {
  const s = stubFetch([{ status: 503, json: { error: { code: "service_overloaded" } } }]);
  await assert.rejects(chatJson({ ...base, fetchImpl: s.fn, maxRetries: 2 }), (e: MetaApiError) => e.status === 502);
  assert.equal(s.calls.length, 3);
});

test("network failure and timeout become safe errors", async () => {
  const net = stubFetch([{ throws: new Error("ECONNRESET to https://api.meta.ai") }]);
  await assert.rejects(chatJson({ ...base, fetchImpl: net.fn, maxRetries: 0 }), (e: MetaApiError) => e.code === "network" && !/ECONNRESET/.test(e.message));
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  await assert.rejects(chatJson({ ...base, fetchImpl: stubFetch([{ throws: abort }]).fn, maxRetries: 0 }), (e: MetaApiError) => e.status === 504);
});

test("listModels returns ids", async () => {
  const s = stubFetch([{ json: { object: "list", data: [{ id: "muse-spark-1.3" }, { id: "muse-wonder-1.0" }] } }]);
  assert.deepEqual(await listModels(config, s.fn), ["muse-spark-1.3", "muse-wonder-1.0"]);
  assert.equal(s.calls[0].url, "https://api.meta.ai/v1/models");
});

test("request carries max_completion_tokens (not deprecated max_tokens); reasoning_effort only when configured", async () => {
  const a = stubFetch([{ json: completion({ ok: 1 }) }]);
  await chatJson({ ...base, fetchImpl: a.fn });
  const body = JSON.parse(a.calls[0].init.body as string);
  assert.equal(body.max_completion_tokens, 8000);
  assert.equal("max_tokens" in body, false);
  assert.equal("reasoning_effort" in body, false);
  const b = stubFetch([{ json: completion({ ok: 1 }) }]);
  await chatJson({ ...base, config: { ...config, reasoningEffort: "low" }, fetchImpl: b.fn });
  assert.equal(JSON.parse(b.calls[0].init.body as string).reasoning_effort, "low");
});

test("META_REASONING_EFFORT is validated against the documented enum", () => {
  assert.equal(readMetaConfig({ MODEL_API_KEY: "k", META_REASONING_EFFORT: "LOW" })?.reasoningEffort, "low");
  assert.equal(readMetaConfig({ MODEL_API_KEY: "k", META_REASONING_EFFORT: "turbo" })?.reasoningEffort, undefined);
});

test("refusals and content_filter stops become clear ModelOutputErrors", async () => {
  const refusal = { choices: [{ finish_reason: "stop", message: { content: null, refusal: "I can't help with that." } }] };
  await assert.rejects(chatJson({ ...base, fetchImpl: stubFetch([{ json: refusal }]).fn }), /declined/);
  const filtered = { choices: [{ finish_reason: "content_filter", message: { content: "" } }] };
  await assert.rejects(chatJson({ ...base, fetchImpl: stubFetch([{ json: filtered }]).fn }), /safety filter/);
});

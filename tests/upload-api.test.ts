import test from "node:test";
import assert from "node:assert/strict";
import { analyzeImage, ApiError, fetchFollowups, verifyImageHash } from "../src/lib/api";
import { sha256Hex } from "../src/lib/hash";
import { handleAnalyze } from "../src/lib/server/handlers";
import { createLiveProvider, mockProvider } from "../src/lib/server/provider";
import { _resetRateLimit } from "../src/lib/server/rate-limit";
import { completion, goodAnalyzeBody, JPEG, liveAnalysisJson, ob, PNG, stubFetch, WEBP } from "./helpers";

const config = { apiKey: "LLM_1_k", model: "muse-spark-1.3", baseUrl: "https://api.meta.ai/v1" };
const req = (b: unknown) => new Request("http://x/api/analyze", { method: "POST", body: JSON.stringify(b) });
const ok = (data: unknown) => ({ ok: true, provider: "live", model: "muse-spark-1.3", data });

test("each supported format reaches the model unchanged and the server echoes the matching image hash", async () => {
  for (const [name, img] of [["jpeg", JPEG], ["png", PNG], ["webp", WEBP]] as const) {
    _resetRateLimit();
    const { fn, calls } = stubFetch([{ json: completion(liveAnalysisJson) }]);
    const res = await handleAnalyze(req(goodAnalyzeBody(img)), createLiveProvider(config, fn));
    const json = await res.json();
    assert.equal(res.status, 200, name);
    assert.equal(json.data.imageHash, await sha256Hex(img), `${name}: hash of the selected image`);
    const sent = JSON.parse(calls[0].init.body as string).messages[1].content.find((p: { type: string }) => p.type === "image_url");
    assert.equal(sent.image_url.url, img, `${name}: the exact selected image is what Meta receives`);
  }
});

test("a different image produces a different hash, so a stale result can be detected", async () => {
  assert.notEqual(await sha256Hex(JPEG), await sha256Hex(PNG));
  assert.throws(() => verifyImageHash(await0("a"), await0("b")), (e: ApiError) => e.code === "image_mismatch" && e.retryable);
  assert.doesNotThrow(() => verifyImageHash("a", "a"));
  assert.doesNotThrow(() => verifyImageHash("a", undefined), "older servers without a hash are tolerated");
  function await0(s: string) { return s; }
});

test("analysis failure then retry: the retry sends the identical request and succeeds", async () => {
  const body = goodAnalyzeBody();
  const { fn, calls } = stubFetch([
    { status: 502, json: { ok: false, error: { code: "invalid_model_output", message: "The model did not return usable data." } } },
    { status: 200, json: ok({ ...liveAnalysisJson, imageHash: "h" }) },
  ]);
  await assert.rejects(analyzeImage(body, { fetchImpl: fn }), (e: ApiError) => e.code === "invalid_model_output" && e.retryable === true);
  const retry = await analyzeImage(body, { fetchImpl: fn });
  assert.equal(retry.data.observations.length, 9);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.body, calls[1].init.body, "same image + description are re-sent without re-entering anything");
});

test("upload failure (network down) is retryable and does not need any state to be rebuilt", async () => {
  const boom = stubFetch([{ throws: new TypeError("fetch failed") }, { json: ok({ ...liveAnalysisJson, imageHash: "h" }) }]);
  await assert.rejects(analyzeImage(goodAnalyzeBody(), { fetchImpl: boom.fn }), (e: ApiError) => e.code === "network" && e.retryable);
  assert.equal((await analyzeImage(goodAnalyzeBody(), { fetchImpl: boom.fn })).provider, "live");
});

test("cancelled requests (e.g. leaving the screen) are not treated as failures", async () => {
  const c = new AbortController();
  const slow = ((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("x"), { name: "AbortError" }))))) as unknown as typeof fetch;
  const p = analyzeImage(goodAnalyzeBody(), { fetchImpl: slow, signal: c.signal });
  c.abort();
  await assert.rejects(p, (e: ApiError) => e.code === "aborted" && !e.retryable);
});

test("server rejects bad uploads before any model call (unsupported type, oversize, mismatched bytes)", async () => {
  let called = 0;
  const spy = { ...mockProvider, analyze: async (r: never) => { called++; return mockProvider.analyze(r); } };
  const big = "data:image/jpeg;base64,/9j/" + "A".repeat(11_000_000);
  for (const image of ["data:image/gif;base64,R0lGODlhAQABAAAAACw=", big, "data:image/png;base64," + JPEG.split(",")[1]]) {
    _resetRateLimit();
    const res = await handleAnalyze(req({ ...goodAnalyzeBody(), image }), spy);
    assert.equal(res.status, 400);
  }
  assert.equal(called, 0);
});

test("two-piece outfit: the model's per-garment analysis is validated and returned per piece", async () => {
  _resetRateLimit();
  const piece = (name: string, key: string, value: string) => ob(name, key, value);
  const twoPiece = {
    ...liveAnalysisJson,
    garments: [{ name: "Top", type: "top" }, { name: "Trousers", type: "trousers" }],
    observations: [piece("Top", "neckline", "Square"), piece("Top", "sleeves", "Short"), piece("Trousers", "length_category", "Ankle"), piece("Trousers", "silhouette", "Wide leg")],
  };
  const res = await handleAnalyze(req(goodAnalyzeBody()), createLiveProvider(config, stubFetch([{ json: completion(twoPiece) }]).fn));
  const data = (await res.json()).data;
  assert.deepEqual(data.garments.map((x: { name: string }) => x.name), ["Top", "Trousers"]);
  assert.deepEqual([...new Set(data.observations.map((o: { piece: string }) => o.piece))], ["Top", "Trousers"]);
  assert.equal(data.observations.some((o: { piece: string; key: string }) => o.piece === "Trousers" && o.key === "neckline"), false, "no neckline invented for trousers");
});

test("inconsistent per-garment output is rejected, never repaired", async () => {
  const bad = async (mutate: (a: typeof liveAnalysisJson) => unknown) => {
    _resetRateLimit();
    const res = await handleAnalyze(req(goodAnalyzeBody()), createLiveProvider(config, stubFetch([{ json: completion(mutate(structuredClone(liveAnalysisJson))) }]).fn));
    return res.status;
  };
  assert.equal(await bad((a) => ({ ...a, observations: [{ ...a.observations[0], piece: "Cape" }] })), 502, "observation for an unidentified garment");
  assert.equal(await bad((a) => ({ ...a, garments: [...a.garments, { name: "Belt", type: "other" }] })), 502, "garment with no observations");
  assert.equal(await bad((a) => ({ ...a, observations: [a.observations[0], a.observations[0]] })), 502, "duplicate key within one garment");
  assert.equal(await bad((a) => ({ ...a, garments: [] })), 502, "no garments");
});

test("mock mode: two-piece selection yields two pieces, flagged as not read from the image", async () => {
  const a = await mockProvider.analyze({ ...goodAnalyzeBody(), garment: "Two-piece set" } as never);
  assert.deepEqual(a.garments.map((x) => x.name), ["Top", "Bottom"]);
  assert.ok(a.observations.every((o) => o.status !== "observed"));
  assert.equal(a.observations.some((o) => o.piece === "Bottom" && (o.key === "neckline" || o.key === "sleeves")), false);
});

test("follow-up requests also carry the piece of every observation", async () => {
  const { fn, calls } = stubFetch([{ json: { ok: true, provider: "live", model: null, data: { questions: [] } } }]);
  await fetchFollowups({ description: "d", garment: "Dress", occasion: "", observations: liveAnalysisJson.observations, questions: [], requested: [] }, { fetchImpl: fn });
  assert.match(String(calls[0].init.body), /"piece":"Dress"/);
});

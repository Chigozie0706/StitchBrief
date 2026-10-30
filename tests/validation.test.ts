import test from "node:test";
import assert from "node:assert/strict";
import { parseAnalyzeRequest, parseAnalysisResult, parseBrief, parseGenerateRequest, parseImageDataUrl, parseQuestions } from "../src/lib/validation";
import { GIF, JPEG, PNG, WEBP, goodAnalyzeBody, liveAnalysisJson, liveBriefJson } from "./helpers";

test("accepts JPEG, PNG and WebP images", () => {
  for (const img of [JPEG, PNG, WEBP]) assert.equal(parseImageDataUrl(img).ok, true, img.slice(0, 20));
});

test("rejects unsupported image types (gif, pdf, svg)", () => {
  for (const img of [GIF, "data:application/pdf;base64,JVBERi0x", "data:image/svg+xml;base64,PHN2Zz4="]) {
    const r = parseImageDataUrl(img);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Unsupported image type/);
  }
});

test("rejects a declared type that does not match the bytes", () => {
  const r = parseImageDataUrl("data:image/png;base64," + JPEG.split(",")[1]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /do not match/);
});

test("rejects oversize, non-base64 and non-data-URL images", () => {
  const big = "data:image/jpeg;base64,/9j/" + "A".repeat(11_000_000);
  const r = parseImageDataUrl(big);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /too large/);
  assert.equal(parseImageDataUrl("data:image/jpeg;base64,@@@").ok, false);
  assert.equal(parseImageDataUrl("https://example.com/a.jpg").ok, false);
  assert.equal(parseImageDataUrl(undefined).ok, false);
});

test("analyze request requires a description and a valid image", () => {
  assert.equal(parseAnalyzeRequest(goodAnalyzeBody()).ok, true);
  assert.equal(parseAnalyzeRequest({ ...goodAnalyzeBody(), description: "  " }).ok, false);
  assert.equal(parseAnalyzeRequest({ ...goodAnalyzeBody(), description: "x".repeat(2001) }).ok, false);
  assert.equal(parseAnalyzeRequest({ ...goodAnalyzeBody(GIF) }).ok, false);
  assert.equal(parseAnalyzeRequest(null).ok, false);
  assert.equal(parseAnalyzeRequest([]).ok, false);
});

test("model analysis output is validated, not trusted", () => {
  assert.equal(parseAnalysisResult(liveAnalysisJson).ok, true);
  assert.equal(parseAnalysisResult({ ...liveAnalysisJson, observations: [{ ...liveAnalysisJson.observations[0], source: "guess" }] }).ok, false);
  assert.equal(parseAnalysisResult({ ...liveAnalysisJson, observations: [liveAnalysisJson.observations[0], liveAnalysisJson.observations[0]] }).ok, false);
  assert.equal(parseAnalysisResult({ ...liveAnalysisJson, questions: [{ ...liveAnalysisJson.questions[0], options: ["only one"] }] }).ok, false);
  assert.equal(parseAnalysisResult({ summary: "x" }).ok, false);
  assert.equal(parseAnalysisResult("nope").ok, false);
});

test("model output cannot smuggle answers into questions", () => {
  const r = parseQuestions([{ ...liveAnalysisJson.questions[0], answer: "Fitted", skipped: true }], false);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal("answer" in r.value[0], false);
});

test("brief schema validation: complete passes, incomplete fails (no silent filling)", () => {
  assert.equal(parseBrief(liveBriefJson).ok, true);
  const { length: _l, ...missing } = liveBriefJson;
  const r = parseBrief(missing);
  assert.equal(r.ok, false);
  assert.equal(parseBrief({ ...liveBriefJson, final_review_checklist: [] }).ok, false);
  assert.equal(parseBrief({ ...liveBriefJson, measurements_required: "Bust" }).ok, false);
});

test("generate request keeps answered/skipped state and optional image", () => {
  const body = {
    ...goodAnalyzeBody(), observations: liveAnalysisJson.observations,
    questions: [{ ...liveAnalysisJson.questions[0], answer: "Fitted" }, { ...liveAnalysisJson.questions[1], skipped: true }],
  };
  const r = parseGenerateRequest(body);
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.value.questions[0].answer, "Fitted"); assert.equal(r.value.questions[1].skipped, true); }
  assert.equal(parseGenerateRequest({ ...body, image: GIF }).ok, false);
});

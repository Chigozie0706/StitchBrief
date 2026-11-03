import test from "node:test";
import assert from "node:assert/strict";
import { parseAnalyzeRequest, parseAnalysisResult, parseBrief, parseClarifyRequest, parseGenerateRequest, parseImageDataUrl, parseQuestions } from "../src/lib/validation";
import { GIF, JPEG, PNG, WEBP, choice, goodAnalyzeBody, liveAnalysisJson, liveBriefJson, ob } from "./helpers";

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
  const r = parseImageDataUrl("data:image/jpeg;base64,/9j/" + "A".repeat(11_000_000));
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
  const o = liveAnalysisJson.observations;
  assert.equal(parseAnalysisResult({ ...liveAnalysisJson, observations: [{ ...o[0], status: "guess" }] }).ok, false);
  assert.equal(parseAnalysisResult({ ...liveAnalysisJson, observations: [o[0], o[0]] }).ok, false, "duplicate key for one garment");
  assert.equal(parseAnalysisResult({ ...liveAnalysisJson, observations: [{ ...o[0], piece: "Cape" }] }).ok, false);
  assert.equal(parseAnalysisResult({ ...liveAnalysisJson, garments: [] }).ok, false);
  assert.equal(parseAnalysisResult({ ...liveAnalysisJson, questions: [choice("x", "q", ["only one"])] }).ok, false);
  assert.equal(parseAnalysisResult({ ...liveAnalysisJson, questions: [{ ...liveAnalysisJson.questions[0], priority: "required" }] }).ok, false, "no 'required' questions: everything can be skipped");
  assert.equal(parseAnalysisResult({ ...liveAnalysisJson, questions: [{ ...liveAnalysisJson.questions[0], topic: "not a slug!" }] }).ok, false);
  assert.equal(parseAnalysisResult({ summary: "x" }).ok, false);
  assert.equal(parseAnalysisResult("nope").ok, false);
  const { differences: _d, ...noDiff } = liveAnalysisJson;
  assert.equal(parseAnalysisResult(noDiff).ok, false);
});

test("model output cannot smuggle answers into questions", () => {
  const r = parseQuestions([{ ...liveAnalysisJson.questions[0], answer: "Fitted", skipped: true, needsReview: true, round: 2 }], false);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(["answer", "skipped", "needsReview", "round"].filter((k) => k in r.value[0]), []);
});

test("question IDs must use the permitted format", () => {
  const question = liveAnalysisJson.questions[0];

  for (const id of ["fabric", "trouser_waistband", "top-closure", "question_01"]) {
    const result = parseQuestions([{ ...question, id }], false);
    assert.equal(result.ok, true, `Expected ${id} to be accepted`);
  }

  for (const id of ["top closure", "top.closure", "top@closure", ""]) {
    const result = parseQuestions([{ ...question, id }], false);
    assert.equal(result.ok, false, `Expected ${id} to be rejected`);
  }
});


test("brief validation: complete passes; wrong, extra or missing garments and incomplete fields fail (no silent filling)", () => {
  assert.equal(parseBrief(liveBriefJson, ["Dress"]).ok, true);
  assert.equal(parseBrief(liveBriefJson, ["Blouse"]).ok, false, "a garment that was not requested");
  assert.equal(parseBrief(liveBriefJson, ["Dress", "Skirt"]).ok, false, "a requested garment is missing");
  assert.equal(parseBrief({ ...liveBriefJson, pieces: [...liveBriefJson.pieces, { ...liveBriefJson.pieces[0], name: "Jeans" }] }, ["Dress"]).ok, false, "a garment that was not requested is not specified");
  assert.equal(parseBrief({ ...liveBriefJson, pieces: [{ ...liveBriefJson.pieces[0], name: "dress" }] }, ["Dress"]).ok, true, "names match case-insensitively");
  const { garment_overview: _g, ...missing } = liveBriefJson;
  assert.equal(parseBrief(missing, ["Dress"]).ok, false);
  assert.equal(parseBrief({ ...liveBriefJson, review_checklist: [] }, ["Dress"]).ok, false);
  assert.equal(parseBrief({ ...liveBriefJson, pieces: [{ ...liveBriefJson.pieces[0], body_measurements: "Bust" }] }, ["Dress"]).ok, false);
  assert.equal(parseBrief({ ...liveBriefJson, technical_gaps: [{ topic: "x", detail: "y", piece: "", status: "uncertain", ref: "" }] }, ["Dress"]).ok, false, "gaps are unknown or needs_measurement only");
});

test("clarify/generate requests keep answered, skipped and review state, requested garments and optional image", () => {
  const body = {
    ...goodAnalyzeBody(), image: undefined, observations: liveAnalysisJson.observations.map((o) => ({ ...o, origin: o.origin })), requested: ["Dress"],
    questions: [{ ...liveAnalysisJson.questions[0], answer: "Fitted", round: 1 }, { ...liveAnalysisJson.questions[1], skipped: true, needsReview: true }],
  };
  const r = parseGenerateRequest(body);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.questions[0].answer, "Fitted");
    assert.equal(r.value.questions[1].skipped, true);
    assert.equal(r.value.questions[1].needsReview, true);
    assert.deepEqual(r.value.requested, ["Dress"]);
  }
  assert.equal(parseGenerateRequest({ ...body, image: GIF }).ok, false);
  assert.equal(parseClarifyRequest({ ...body, requested: ["a", "b", "c", "d", "e"] }).ok, false, "at most four garments");
  const designerEdit = { ...body, observations: [{ ...liveAnalysisJson.observations[0], status: "client_confirmed", origin: "designer_edit" }] };
  assert.equal(parseClarifyRequest(designerEdit).ok, true, "the client app may report designer edits; the model may not");
  assert.equal(ob("Dress", "color", "x").status, "observed");
});

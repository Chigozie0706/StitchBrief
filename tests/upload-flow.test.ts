import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, jpegOrientation, qualityAdvisory, validateImageFile } from "../src/lib/image";
import { analysisKey, applyReanalysis, garmentForApi, garmentMismatch, groupByPiece, lowDetail, outfitLabel } from "../src/lib/upload-flow";
import { isAnswered, reviewPending, unresolvedRequired } from "../src/lib/clarify";
import type { DetectedGarment, Observation, Question } from "../src/lib/types";

/* ---------- file selection ---------- */
test("valid JPEG, PNG and WebP are accepted (up to exactly 10 MB)", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(validateImageFile({ type, size: 1_500_000, name: "x" }), null, type);
    assert.equal(validateImageFile({ type, size: 10_000_000 }), null, `${type} at the limit`);
  }
});

test("unsupported formats get specific, actionable messages", () => {
  assert.match(validateImageFile({ type: "image/gif", size: 5, name: "a.gif" })!, /GIF files aren’t supported/);
  assert.match(validateImageFile({ type: "image/svg+xml", size: 5 })!, /SVG\+XML files aren’t supported/);
  assert.match(validateImageFile({ type: "application/pdf", size: 5, name: "look.pdf" })!, /PDF files aren’t supported/);
  assert.match(validateImageFile({ type: "", size: 5, name: "photo.tiff" })!, /TIFF files aren’t supported/);
  assert.match(validateImageFile({ type: "image/heic", size: 5, name: "IMG_1.HEIC" })!, /HEIC photos aren’t supported.*JPEG/);
  assert.match(validateImageFile({ type: "", size: 5, name: "IMG_1.heif" })!, /HEIC/);
});

test("oversize and empty files explain the limit", () => {
  assert.equal(validateImageFile({ type: "image/jpeg", size: 10_000_001 }), "That image is 10.0 MB. The limit is 10 MB.");
  assert.match(validateImageFile({ type: "image/png", size: 23_400_000 })!, /23\.4 MB/);
  assert.match(validateImageFile({ type: "image/png", size: 0 })!, /empty/);
  assert.equal(formatBytes(850), "1 KB");
  assert.equal(formatBytes(1_234_000), "1.2 MB");
});

/* ---------- image quality ---------- */
test("small images get a non-blocking advisory; normal ones do not", () => {
  assert.match(qualityAdvisory(320, 480)!, /small \(320×480\)/);
  assert.match(qualityAdvisory(600, 650)!, /small/);
  assert.equal(qualityAdvisory(1200, 1800), null);
  assert.equal(qualityAdvisory(800, 1200), null);
});

function jpegWithOrientation(value: number, littleEndian: boolean): Uint8Array {
  const u16 = (n: number) => (littleEndian ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n: number) => (littleEndian ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const tiff = [...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(value), 0, 0, ...u32(0)];
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = exif.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...exif, 0xff, 0xda, 0, 2]);
}

test("EXIF orientation is detected so rotated phone photos are re-rendered, not sent sideways", () => {
  for (const le of [true, false]) {
    assert.equal(jpegOrientation(jpegWithOrientation(6, le)), 6, `orientation 6 (${le ? "LE" : "BE"})`);
    assert.equal(jpegOrientation(jpegWithOrientation(1, le)), 1);
    assert.equal(jpegOrientation(jpegWithOrientation(8, le)), 8);
  }
  assert.equal(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])), 1, "no EXIF");
  assert.equal(jpegOrientation(new Uint8Array([1, 2, 3])), 1, "not a JPEG");
  assert.equal(jpegOrientation(jpegWithOrientation(6, true).slice(0, 14)), 1, "truncated EXIF must not throw");
});

/* ---------- garment type vs. what the image shows ---------- */
const g = (name: string, type: DetectedGarment["type"]): DetectedGarment => ({ name, type });
const DRESS = [g("Dress", "dress")];
const SET = [g("Top", "top"), g("Trousers", "trousers")];

test("garment selection never silently overrides the analysis: conflicts are flagged", () => {
  assert.equal(garmentMismatch("Dress", DRESS), null);
  assert.equal(garmentMismatch("Blouse", [g("Blouse", "top")]), null);
  assert.equal(garmentMismatch("Two-piece set", SET), null);
  assert.equal(garmentMismatch("Not sure", SET), null);
  assert.match(garmentMismatch("Dress", SET)!, /selected Dress.*2 pieces \(Top and Trousers\)/);
  assert.match(garmentMismatch("Two-piece set", DRESS)!, /selected Two-piece set.*one piece \(Dress\)/);
  assert.match(garmentMismatch("Skirt", DRESS)!, /selected Skirt.*show Dress/);
  assert.match(garmentMismatch("Blouse", SET)!, /2 pieces/);
});

test("outfit label and API mapping", () => {
  assert.equal(outfitLabel(SET), "Two-piece set");
  assert.equal(outfitLabel(DRESS), "Dress");
  assert.equal(garmentForApi("Not sure"), "");
  assert.equal(garmentForApi("Dress"), "Dress");
});

/* ---------- consistency between image, description and analysis ---------- */
test("analysis key tracks image + description + occasion, not the garment hint", () => {
  const base = { imageHash: "abc", description: " red dress ", occasion: "gala " };
  assert.equal(analysisKey(base), analysisKey({ ...base, description: "red dress", occasion: "gala" }), "whitespace ignored");
  assert.notEqual(analysisKey(base), analysisKey({ ...base, imageHash: "def" }), "image replaced");
  assert.notEqual(analysisKey(base), analysisKey({ ...base, description: "blue dress" }), "description changed");
  assert.notEqual(analysisKey(base), analysisKey({ ...base, occasion: "office" }), "occasion changed");
});

const obs = (piece: string, key: Observation["key"], value: string, source: Observation["source"] = "observed", confidence: Observation["confidence"] = "high"): Observation => ({ piece, key, label: key, value, source, confidence });
const q = (id: string, over: Partial<Question> = {}): Question => ({ id, question: `Question ${id}?`, reason: "r", type: "text", options: [], required: false, ...over });

test("replacing the image: old observations are NOT carried over; answers are kept but flagged for review", () => {
  const prevObs = [obs("Dress", "neckline", "Draped V (from OLD image)"), obs("Dress", "neckline", "Raised V, 2cm higher", "client_confirmed")];
  const result = applyReanalysis({
    prevObservations: [prevObs[0], prevObs[1], obs("Dress", "color", "Burgundy (OLD image)")],
    prevQuestions: [q("fit", { answer: "Fitted" }), q("closure", { skipped: true }), q("lining", { answer: "Fully lined" }), q("unanswered")],
    nextQuestions: [q("fit"), q("closure"), q("sleeves_q")],
    nextObservations: [obs("Dress", "neckline", "Square (NEW image)"), obs("Dress", "color", "Navy (NEW image)")],
  });
  const byId = Object.fromEntries(result.questions.map((x) => [x.id, x]));
  assert.equal(byId.fit.answer, "Fitted"); assert.equal(byId.fit.needsReview, true);
  assert.equal(byId.closure.skipped, true); assert.equal(byId.closure.needsReview, true);
  assert.equal(byId.sleeves_q.needsReview, undefined, "new questions are not flagged");
  assert.equal(byId.lining.answer, "Fully lined", "answered question missing from the new analysis is kept…");
  assert.equal(byId.lining.needsReview, true, "…and flagged");
  assert.equal(byId.unanswered, undefined, "never-answered questions are dropped");
  // earlier designer-confirmed value is listed for review; image-observed values are simply not carried
  assert.deepEqual(result.reviewNotes.map((n) => n.value), ["Raised V, 2cm higher"]);
});

test("carried-over answers do not count as answered until confirmed (blocks generation)", () => {
  const flagged = q("fit", { answer: "Fitted", needsReview: true, required: true });
  assert.equal(isAnswered(flagged), false);
  assert.equal(unresolvedRequired([flagged]).length, 1);
  assert.equal(reviewPending([flagged, q("x", { answer: "y" })]).length, 1);
  assert.equal(isAnswered({ ...flagged, needsReview: false }), true);
});

test("low-detail detection suggests a clearer photo only when most observations are weak", () => {
  const weak = [obs("D", "color", "?", "unknown", "low"), obs("D", "neckline", "?", "observed", "low"), obs("D", "sleeves", "?", "unknown", "low")];
  assert.equal(lowDetail([...weak, obs("D", "length_category", "Maxi")]), true);
  assert.equal(lowDetail([...weak.slice(0, 1), obs("D", "neckline", "V"), obs("D", "sleeves", "None"), obs("D", "color", "Red")]), false);
  assert.equal(lowDetail([]), false);
});

test("observations are grouped per garment, keeping their original index", () => {
  const list = [obs("Top", "neckline", "Square"), obs("Trousers", "length_category", "Ankle"), obs("Top", "sleeves", "Short")];
  const groups = groupByPiece(list);
  assert.deepEqual(groups.map((x) => x.piece), ["Top", "Trousers"]);
  assert.deepEqual(groups[0].items.map((x) => x.i), [0, 2]);
});

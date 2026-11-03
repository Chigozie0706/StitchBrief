import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, jpegOrientation, qualityAdvisory, validateImageFile } from "../src/lib/image";
import { analysisKey, applyReanalysis, autoRequested, garmentChoice, garmentForApi, garmentLabelFor, groupByPiece, lowDetail, requestedForOther } from "../src/lib/upload-flow";
import { isAnswered, reviewPending } from "../src/lib/clarify";
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

/* ---------- which garment is the brief for? ---------- */
const g = (name: string, type: DetectedGarment["type"]): DetectedGarment => ({ name, type });
const BLOUSE_JEANS = [g("Blouse", "top"), g("Jeans", "trousers")];
const SET = [g("Top", "top"), g("Trousers", "trousers")];
const DRESS = [g("Dress", "dress")];

test("a photo with two garments is NOT automatically a two-piece outfit: the designer is asked which garment to create", () => {
  assert.equal(autoRequested("Blouse", BLOUSE_JEANS), null);
  const c = garmentChoice("Blouse", BLOUSE_JEANS)!;
  assert.equal(c.message, "The image contains blouse and jeans. Which garment should StitchBrief create a sewing brief for?");
  assert.deepEqual(c.options, [{ label: "Blouse only", pieces: ["Blouse"] }, { label: "Both garments", pieces: ["Blouse", "Jeans"] }]);
  const none = garmentChoice("Dress", SET)!;
  assert.deepEqual(none.options.map((x) => x.label), ["Top only", "Trousers only", "Both garments"], "no garment matches the selection: offer each, plus both");
  assert.deepEqual(garmentChoice("Not sure", SET)!.options.map((x) => x.label), ["Top only", "Trousers only", "Both garments"]);
  assert.deepEqual(garmentChoice("Two-piece set", [...SET, g("Jacket", "outerwear")])!.options.map((x) => x.label).slice(-1), ["All 3 garments"]);
});

test("no question is needed when the selection and the photo agree", () => {
  assert.deepEqual(autoRequested("Dress", DRESS), ["Dress"]);
  assert.deepEqual(autoRequested("Blouse", [g("Blouse", "top")]), ["Blouse"]);
  assert.deepEqual(autoRequested("Two-piece set", SET), ["Top", "Trousers"]);
  assert.deepEqual(autoRequested("Not sure", DRESS), ["Dress"], "'Not sure' + one garment: use what the image shows");
  assert.equal(garmentChoice("Dress", DRESS), null);
  assert.equal(garmentChoice("Two-piece set", SET), null);
});

test("a mismatch is explained, never silently overridden", () => {
  assert.equal(garmentChoice("Two-piece set", DRESS)!.message, "You selected Two-piece set, but the image shows dress. Which garment should StitchBrief create a sewing brief for?");
  assert.deepEqual(garmentChoice("Skirt", DRESS)!.options, [{ label: "Dress only", pieces: ["Dress"] }]);
  assert.equal(autoRequested("Skirt", DRESS), null);
});

test("labels and the 'another garment' path", () => {
  assert.equal(garmentLabelFor([g("Blouse", "top")]), "Blouse");
  assert.equal(garmentLabelFor([g("Jeans", "trousers")]), "Trousers");
  assert.equal(garmentLabelFor(SET), "Two-piece set");
  assert.equal(garmentLabelFor([g("Cape", "outerwear")]), "Cape");
  assert.deepEqual(requestedForOther("Trousers", BLOUSE_JEANS), ["Jeans"], "a visible garment of that type");
  assert.deepEqual(requestedForOther("Skirt", BLOUSE_JEANS), ["Skirt"], "a garment that is not in the photo: everything visible is reference only");
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

const obs = (piece: string, key: Observation["key"], value: string, status: Observation["status"] = "observed", origin: Observation["origin"] = "image"): Observation => ({ piece, key, label: key, value, status, origin });
const q = (id: string, over: Partial<Question> = {}): Question => ({ id, question: `Question ${id}?`, reason: "r", type: "text", options: [], priority: "normal", topic: id, piece: "", ...over });

test("replacing the image: old observations are NOT carried over; answers are kept but flagged; earlier corrections are listed for review", () => {
  const corrected = obs("Dress", "neckline", "Raised V, 2cm higher", "client_confirmed", "designer_edit");
  const result = applyReanalysis({
    prevObservations: [corrected, obs("Dress", "color", "Burgundy (OLD image)")],
    prevQuestions: [q("fit", { answer: "Fitted" }), q("closure", { skipped: true }), q("lining", { answer: "Fully lined" }), q("unanswered")],
    nextQuestions: [q("fit"), q("closure"), q("sleeves_q")],
    nextObservations: [obs("Dress", "neckline", "Square (NEW image)"), obs("Dress", "color", "Navy (NEW image)")],
  });
  const byId = Object.fromEntries(result.questions.map((x) => [x.id, x]));
  assert.equal(byId.fit.answer, "Fitted"); assert.equal(byId.fit.needsReview, true);
  assert.equal(byId.closure.skipped, true); assert.equal(byId.closure.needsReview, true);
  assert.equal(byId.sleeves_q.needsReview, undefined, "new questions are not flagged");
  assert.equal(byId.lining.answer, "Fully lined"); assert.equal(byId.lining.needsReview, true);
  assert.equal(byId.unanswered, undefined, "never-answered questions are dropped");
  assert.deepEqual(result.reviewNotes.map((n) => n.value), ["Raised V, 2cm higher"], "OLD-image observations are not carried; the designer's own correction is flagged");
});

test("a carried-over answer never blocks generation but does not count as confirmed", () => {
  const flagged = q("fit", { answer: "Fitted", needsReview: true });
  assert.equal(isAnswered(flagged), false);
  assert.equal(reviewPending([flagged, q("x", { answer: "y" })]).length, 1);
  assert.equal(isAnswered({ ...flagged, needsReview: false }), true);
  assert.equal(isAnswered(q("s", { skipped: true })), true, "a skipped question counts as dealt with");
});

test("low-detail detection suggests a clearer photo only when most details are unknown or uncertain", () => {
  const weak = [obs("D", "color", "?", "unknown"), obs("D", "neckline", "?", "uncertain"), obs("D", "sleeves", "?", "unknown")];
  assert.equal(lowDetail([...weak, obs("D", "length_category", "Maxi")]), true);
  assert.equal(lowDetail([weak[0], obs("D", "neckline", "V"), obs("D", "sleeves", "None"), obs("D", "color", "Red")]), false);
  assert.equal(lowDetail([]), false);
});

test("observations are grouped per garment, keeping their original index", () => {
  const list = [obs("Top", "neckline", "Square"), obs("Trousers", "length_category", "Ankle"), obs("Top", "sleeves", "Short")];
  const groups = groupByPiece(list);
  assert.deepEqual(groups.map((x) => x.piece), ["Top", "Trousers"]);
  assert.deepEqual(groups[0].items.map((x) => x.i), [0, 2]);
});

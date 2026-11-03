import test from "node:test";
import assert from "node:assert/strict";
import { canConfirm, canUndo, confirmDecision, markUncertain, normalizeModelDecision, normTopic, unmarkUncertain } from "../src/lib/decisions";
import { parseAnalysisResult, parseObservation } from "../src/lib/validation";
import { liveAnalysisJson, ob } from "./helpers";
import type { Observation } from "../src/lib/types";

const seen: Observation = { piece: "Top", key: "neckline", label: "Neckline", value: "Square", status: "observed", origin: "image" };

test("source accuracy: only a client statement can make a detail client_confirmed; a client choice is never 'observed'", () => {
  // the mandarin-collar bug: a detail from the client's words must not stay "observed"
  assert.deepEqual(normalizeModelDecision("observed", "client_description"), { status: "client_confirmed", origin: "client_description", reason: "" });
  assert.equal(normalizeModelDecision("ai_suggested", "client_description").status, "client_confirmed");
  // the model cannot confirm something nobody stated
  const forged = normalizeModelDecision("client_confirmed", "image");
  assert.equal(forged.status, "uncertain");
  assert.match(forged.reason, /without a client statement/);
  assert.equal(normalizeModelDecision("client_confirmed", "ai").status, "uncertain");
  // "observed" needs the image
  assert.equal(normalizeModelDecision("observed", "ai").status, "ai_suggested");
  assert.equal(normalizeModelDecision("observed", "image").status, "observed");
  assert.equal(normalizeModelDecision("unknown", "image").status, "unknown");
  assert.equal(normalizeModelDecision("needs_measurement", "image").status, "needs_measurement");
});

test("model output is normalised on parse (no contradictory status/origin pairs survive)", () => {
  const base = { piece: "Top", key: "neckline", label: "Neckline", value: "Mandarin collar", reason: "", note: "" };
  const a = parseObservation({ ...base, status: "observed", origin: "client_description" }, 0, true);
  assert.equal(a.ok && a.value.status, "client_confirmed");
  const b = parseObservation({ ...base, status: "client_confirmed", origin: "image" }, 0, true);
  assert.equal(b.ok && b.value.status, "uncertain");
  assert.equal(parseObservation({ ...base, status: "client_confirmed", origin: "designer_edit" }, 0, true).ok, false, "the model may not claim a designer edit");
  assert.equal(parseObservation({ ...base, status: "maybe", origin: "image" }, 0, true).ok, false);
  const r = parseAnalysisResult({ ...liveAnalysisJson, observations: [...liveAnalysisJson.observations.slice(1), ob("Dress", "garment_category", "Dress", "client_confirmed", "image")] });
  assert.equal(r.ok && r.value.observations.find((o) => o.key === "garment_category")?.status, "uncertain");
});

test("Mark as uncertain: detail stays, leaves the confirmed set, and is fully reversible", () => {
  const u = markUncertain(seen);
  assert.equal(u.value, "Square", "the detail stays in the brief");
  assert.equal(u.status, "uncertain");
  assert.equal(u.previousStatus, "observed");
  assert.match(u.reason!, /designer/);
  assert.equal(u.origin, "image", "origin is preserved");
  assert.strictEqual(markUncertain(u), u, "idempotent: marking twice does not lose the previous status");
  assert.equal(canUndo(u), true);
  const back = unmarkUncertain(u);
  assert.deepEqual(back, seen, "undo restores exactly what it was");
  // a confirmed decision can be marked uncertain and restored too
  const c = confirmDecision(seen);
  assert.equal(unmarkUncertain(markUncertain(c)).status, "client_confirmed");
});

test("uncertain is never silently turned into a confirmed decision; only an explicit designer action confirms", () => {
  const u = markUncertain(seen);
  assert.notEqual(u.status, "client_confirmed");
  assert.equal(unmarkUncertain(u).status, "observed", "undo restores 'observed', not 'client_confirmed'");
  const modelUncertain: Observation = { ...seen, status: "uncertain", reason: "Hidden by the ruffle" };
  assert.equal(canUndo(modelUncertain), false, "a model-flagged uncertainty has nothing to restore");
  assert.strictEqual(unmarkUncertain(modelUncertain), modelUncertain);
  assert.equal(canConfirm(modelUncertain), true);
  const confirmed = confirmDecision(modelUncertain);
  assert.deepEqual([confirmed.status, confirmed.origin, confirmed.reason, confirmed.previousStatus], ["client_confirmed", "designer_edit", undefined, undefined]);
  assert.equal(confirmDecision(seen, "Raised square").value, "Raised square", "changing a detail confirms the new value");
  assert.equal(canConfirm(confirmed), false);
});

test("uncertain, unknown and needs_measurement stay three different statuses", () => {
  const set = new Set(["uncertain", "unknown", "needs_measurement"].map((s) => parseObservation({ ...ob("Top", "pockets", "x"), status: s }, 0, true)).map((r) => r.ok && r.value.status));
  assert.equal(set.size, 3);
});

test("topic aliases make 'sleeve_style' and 'sleeves' one decision", () => {
  assert.equal(normTopic("Sleeve style"), "sleeves");
  assert.equal(normTopic("closure_type"), "closure");
  assert.equal(normTopic("Fabric"), "fabric_appearance");
  assert.equal(normTopic("pockets"), "pockets");
});

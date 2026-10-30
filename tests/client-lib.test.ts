import test from "node:test";
import assert from "node:assert/strict";
import { loadDrafts, saveDraft } from "../src/lib/storage";
import { briefToSections, briefToMarkdown, formatUpdated, isUncertain } from "../src/lib/brief";
import { validateImageFile } from "../src/lib/image";
import { liveBriefJson } from "./helpers";
import type { SavedBrief } from "../src/lib/types";

class MemStore { data = new Map<string, string>(); quota = Infinity;
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { if (v.length > this.quota) throw new DOMException("full", "QuotaExceededError"); this.data.set(k, v); } }

const draft = (over: Partial<SavedBrief> = {}): SavedBrief => ({ id: "d1", title: "Dress", updated: "", status: "Draft", image: "data:image/jpeg;base64,AAAA", sections: [{ title: "A", body: "b" }], updatedAt: new Date().toISOString(), description: "desc", questions: [{ id: "fit", question: "q", reason: "r", type: "text", options: [], required: false, answer: "Fitted" }], ...over });

test("drafts persist and reload with answers, sections and status", () => {
  const s = new MemStore();
  assert.equal(saveDraft(draft(), s).ok, true);
  const [d] = loadDrafts(s);
  assert.equal(d.questions?.[0].answer, "Fitted");
  assert.equal(d.sections?.[0].body, "b");
  assert.match(d.updated, /^Today/);
});

test("saving again updates the same draft instead of duplicating it", () => {
  const s = new MemStore();
  saveDraft(draft(), s);
  saveDraft(draft({ title: "Dress v2", status: "Ready" }), s);
  const all = loadDrafts(s);
  assert.equal(all.length, 1);
  assert.equal(all[0].title, "Dress v2");
  assert.equal(all[0].status, "Ready");
});

test("quota exceeded: retries without the image and reports it", () => {
  const s = new MemStore();
  s.quota = 400;
  const out = saveDraft(draft({ image: "data:image/jpeg;base64," + "A".repeat(5000) }), s);
  assert.deepEqual([out.ok, out.imageStored], [true, false]);
  assert.equal(loadDrafts(s)[0].image, "");
});

test("storage failure and corrupt data are handled gracefully", () => {
  const s = new MemStore(); s.quota = 5;
  assert.equal(saveDraft(draft(), s).ok, false);
  assert.equal(saveDraft(draft(), null).ok, false);
  const bad = new MemStore(); bad.data.set("stitchbrief:drafts:v2", "{not json");
  assert.deepEqual(loadDrafts(bad), []);
  assert.deepEqual(loadDrafts(null), []);
});

test("brief -> editable sections / markdown; editing a section is reflected in exports", () => {
  const sections = briefToSections(liveBriefJson as never);
  assert.equal(sections.length, 12);
  assert.equal(sections.find((x) => x.title === "Open questions")?.body, "• Fabric?");
  sections[0] = { ...sections[0], body: "Edited by designer" };
  assert.match(briefToMarkdown("T", sections), /## Garment overview\n\nEdited by designer/);
});

test("uncertainty + date helpers + client file validation", () => {
  assert.equal(isUncertain({ key: "color", label: "c", value: "v", source: "observed", confidence: "low" }), true);
  assert.equal(isUncertain({ key: "color", label: "c", value: "v", source: "observed", confidence: "high" }), false);
  assert.equal(formatUpdated("not a date"), "");
  assert.equal(validateImageFile({ type: "image/gif", size: 10 }), "Please choose a JPEG, PNG or WebP image.");
  assert.match(validateImageFile({ type: "image/png", size: 11_000_000 })!, /10 MB/);
  assert.equal(validateImageFile({ type: "image/webp", size: 1000 }), null);
});

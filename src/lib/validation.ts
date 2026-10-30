import { ALLOWED_IMAGE_TYPES, LIMITS, type AllowedImageType } from "./config";
import type { AnalysisResult, ApiSource, BriefData, Confidence, Difference, Observation, ObservationKey, Question } from "./types";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T = never>(error: string): Result<T> => ({ ok: false, error });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const OBSERVATION_KEYS: ObservationKey[] = [
  "garment_category", "silhouette", "neckline", "sleeves", "length_category",
  "design_details", "color", "fabric_appearance", "construction_considerations",
];
export const API_SOURCES: ApiSource[] = ["observed", "client_confirmed", "ai_suggestion", "unknown"];
const CONFIDENCES: Confidence[] = ["high", "medium", "low"];

function text(v: unknown, field: string, max: number, opts: { optional?: boolean } = {}): Result<string> {
  if (v === undefined || v === null) return opts.optional ? ok("") : fail(`${field} is required.`);
  if (typeof v !== "string") return fail(`${field} must be text.`);
  const s = v.trim();
  if (!s && !opts.optional) return fail(`${field} is required.`);
  if (s.length > max) return fail(`${field} is too long (max ${max} characters).`);
  return ok(s);
}

/* ---------- image ---------- */

const SIGNATURES: Record<AllowedImageType, (b: number[]) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/webp": (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};

export function parseImageDataUrl(input: unknown): Result<{ mime: AllowedImageType; bytes: number }> {
  if (typeof input !== "string" || !input) return fail("A reference image is required.");
  const head = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i.exec(input.slice(0, 120));
  if (!head) return fail("Image must be sent as a base64 data URL.");
  const mime = head[1].toLowerCase();
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(mime)) return fail("Unsupported image type. Use JPEG, PNG or WebP.");
  const b64 = input.slice(head[0].length);
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return fail("Image data is not valid base64.");
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((b64.length * 3) / 4) - padding;
  if (bytes > LIMITS.MAX_IMAGE_BYTES) return fail(`Image is too large (max ${LIMITS.MAX_IMAGE_BYTES / 1_000_000} MB).`);
  let sig: number[];
  try {
    sig = Array.from(atob(b64.slice(0, 24)), (c) => c.charCodeAt(0));
  } catch {
    return fail("Image data is not valid base64.");
  }
  if (!SIGNATURES[mime as AllowedImageType](sig)) return fail("Image contents do not match its declared type.");
  return ok({ mime: mime as AllowedImageType, bytes });
}

/* ---------- shared pieces ---------- */

export function parseObservation(v: unknown, i = 0): Result<Observation> {
  if (!isRecord(v)) return fail(`Observation ${i} is invalid.`);
  const key = v.key as ObservationKey;
  if (!OBSERVATION_KEYS.includes(key)) return fail(`Observation ${i} has an unknown key.`);
  if (!API_SOURCES.includes(v.source as ApiSource)) return fail(`Observation ${i} has an invalid source.`);
  if (!CONFIDENCES.includes(v.confidence as Confidence)) return fail(`Observation ${i} has an invalid confidence.`);
  const label = text(v.label, "label", LIMITS.MAX_SHORT_TEXT);
  if (!label.ok) return fail(label.error);
  const value = text(v.value, "value", LIMITS.MAX_ANSWER);
  if (!value.ok) return fail(value.error);
  const note = text(v.note, "note", LIMITS.MAX_ANSWER, { optional: true });
  if (!note.ok) return fail(note.error);
  return ok({ key, label: label.value, value: value.value, source: v.source as ApiSource, confidence: v.confidence as Confidence, ...(note.value ? { note: note.value } : {}) });
}

export function parseObservations(v: unknown): Result<Observation[]> {
  if (!Array.isArray(v) || v.length === 0) return fail("Observations are required.");
  if (v.length > LIMITS.MAX_OBSERVATIONS) return fail("Too many observations.");
  const out: Observation[] = [];
  for (let i = 0; i < v.length; i++) {
    const r = parseObservation(v[i], i);
    if (!r.ok) return fail(r.error);
    out.push(r.value);
  }
  return ok(out);
}

/** Validates a question. `fromClient` allows answer/skipped; model output must not contain answers. */
export function parseQuestion(v: unknown, i = 0, fromClient = false): Result<Question> {
  if (!isRecord(v)) return fail(`Question ${i} is invalid.`);
  const id = text(v.id, "id", 60);
  if (!id.ok) return fail(id.error);
  if (!/^[a-z0-9_-]+$/i.test(id.value)) return fail(`Question ${i} has an invalid id.`);
  const question = text(v.question, "question", 300);
  if (!question.ok) return fail(question.error);
  const reason = text(v.reason, "reason", 400);
  if (!reason.ok) return fail(reason.error);
  if (v.type !== "single_select" && v.type !== "text") return fail(`Question ${i} has an invalid type.`);
  if (!Array.isArray(v.options) || v.options.length > 8 || v.options.some((o) => typeof o !== "string" || !o.trim() || o.length > 80))
    return fail(`Question ${i} has invalid options.`);
  if (v.type === "single_select" && v.options.length < 2) return fail(`Question ${i} needs at least two options.`);
  if (typeof v.required !== "boolean") return fail(`Question ${i} is missing "required".`);
  const q: Question = { id: id.value, question: question.value, reason: reason.value, type: v.type, options: (v.options as string[]).map((o) => o.trim()), required: v.required };
  if (fromClient) {
    const answer = text(v.answer, "answer", LIMITS.MAX_ANSWER, { optional: true });
    if (!answer.ok) return fail(answer.error);
    if (answer.value) q.answer = answer.value;
    if (v.skipped === true) q.skipped = true;
  }
  return ok(q);
}

export function parseQuestions(v: unknown, fromClient = false, max: number = LIMITS.MAX_QUESTIONS): Result<Question[]> {
  if (!Array.isArray(v)) return fail("Questions must be a list.");
  if (v.length > max) return fail("Too many questions.");
  const out: Question[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < v.length; i++) {
    const r = parseQuestion(v[i], i, fromClient);
    if (!r.ok) return fail(r.error);
    if (seen.has(r.value.id)) return fail(`Duplicate question id "${r.value.id}".`);
    seen.add(r.value.id);
    out.push(r.value);
  }
  return ok(out);
}

export function parseDifferences(v: unknown, optional = false): Result<Difference[]> {
  if ((v === undefined || v === null) && optional) return ok([]);
  if (!Array.isArray(v)) return fail("differences must be a list.");
  if (v.length > 8) return fail("Too many differences.");
  const out: Difference[] = [];
  for (let i = 0; i < v.length; i++) {
    const d = v[i];
    if (!isRecord(d)) return fail(`Difference ${i} is invalid.`);
    const topic = text(d.topic, "topic", 100);
    const shows = text(d.reference_shows, "reference_shows", 300);
    const wants = text(d.client_wants, "client_wants", 300);
    if (!topic.ok) return fail(topic.error);
    if (!shows.ok) return fail(shows.error);
    if (!wants.ok) return fail(wants.error);
    out.push({ topic: topic.value, reference_shows: shows.value, client_wants: wants.value });
  }
  return ok(out);
}

/* ---------- requests ---------- */

type Context = { description: string; garment: string; occasion: string };
function parseContext(b: Record<string, unknown>): Result<Context> {
  const description = text(b.description, "Description", LIMITS.MAX_DESCRIPTION);
  if (!description.ok) return fail(description.error);
  const garment = text(b.garment, "Garment type", LIMITS.MAX_SHORT_TEXT, { optional: true });
  if (!garment.ok) return fail(garment.error);
  const occasion = text(b.occasion, "Occasion", LIMITS.MAX_SHORT_TEXT, { optional: true });
  if (!occasion.ok) return fail(occasion.error);
  return ok({ description: description.value, garment: garment.value, occasion: occasion.value });
}

export type AnalyzeRequest = Context & { image: string };
export function parseAnalyzeRequest(body: unknown): Result<AnalyzeRequest> {
  if (!isRecord(body)) return fail("Request body must be a JSON object.");
  const img = parseImageDataUrl(body.image);
  if (!img.ok) return fail(img.error);
  const ctx = parseContext(body);
  if (!ctx.ok) return fail(ctx.error);
  return ok({ ...ctx.value, image: body.image as string });
}

export type ClarifyRequest = Context & { observations: Observation[]; questions: Question[]; differences: Difference[] };
export function parseClarifyRequest(body: unknown): Result<ClarifyRequest> {
  if (!isRecord(body)) return fail("Request body must be a JSON object.");
  const ctx = parseContext(body);
  if (!ctx.ok) return fail(ctx.error);
  const obs = parseObservations(body.observations);
  if (!obs.ok) return fail(obs.error);
  const qs = parseQuestions(body.questions, true);
  if (!qs.ok) return fail(qs.error);
  const diffs = parseDifferences(body.differences, true);
  if (!diffs.ok) return fail(diffs.error);
  return ok({ ...ctx.value, observations: obs.value, questions: qs.value, differences: diffs.value });
}

export type GenerateRequest = ClarifyRequest & { image?: string };
export function parseGenerateRequest(body: unknown): Result<GenerateRequest> {
  const base = parseClarifyRequest(body);
  if (!base.ok) return base;
  const image = (body as Record<string, unknown>).image;
  if (image === undefined || image === null || image === "") return ok(base.value);
  const img = parseImageDataUrl(image);
  if (!img.ok) return fail(img.error);
  return ok({ ...base.value, image: image as string });
}

/* ---------- model output (never trusted) ---------- */

export function parseAnalysisResult(raw: unknown): Result<AnalysisResult> {
  if (!isRecord(raw)) return fail("Model output was not an object.");
  const summary = text(raw.summary, "summary", 800);
  if (!summary.ok) return fail(summary.error);
  const obs = parseObservations(raw.observations);
  if (!obs.ok) return fail(obs.error);
  const keys = new Set(obs.value.map((o) => o.key));
  if (keys.size !== obs.value.length) return fail("Model returned duplicate observation keys.");
  if (!Array.isArray(raw.missing_information) || raw.missing_information.some((m) => typeof m !== "string"))
    return fail("Model output is missing missing_information.");
  const diffs = parseDifferences(raw.differences);
  if (!diffs.ok) return fail(diffs.error);
  const qs = parseQuestions(raw.questions, false, 8);
  if (!qs.ok) return fail(qs.error);
  return ok({ summary: summary.value, differences: diffs.value, observations: obs.value, missing_information: (raw.missing_information as string[]).map((s) => s.trim()).filter(Boolean).slice(0, 12), questions: qs.value });
}

const BRIEF_STRINGS = ["garment_overview", "silhouette_and_fit", "neckline_and_sleeves", "length", "fabric_and_materials", "color_and_finishing", "construction_considerations", "client_confirmed_modifications"] as const;
const BRIEF_LISTS = ["measurements_required", "assumptions_and_uncertainties", "open_questions", "final_review_checklist"] as const;

export function parseBrief(raw: unknown): Result<BriefData> {
  if (!isRecord(raw)) return fail("Model output was not an object.");
  const out: Record<string, unknown> = {};
  const title = text(raw.title, "title", 160);
  if (!title.ok) return fail(title.error);
  out.title = title.value;
  for (const k of BRIEF_STRINGS) {
    const r = text(raw[k], k, 2500);
    if (!r.ok) return fail(`Model output is incomplete: ${r.error}`);
    out[k] = r.value;
  }
  for (const k of BRIEF_LISTS) {
    const v = raw[k];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.length > 500) || v.length > 30) return fail(`Model output is incomplete: ${k} must be a list of text.`);
    const items = (v as string[]).map((s) => s.trim()).filter(Boolean);
    if (items.length === 0 && k !== "open_questions") return fail(`Model output is incomplete: ${k} is empty.`);
    out[k] = items;
  }
  return ok(out as BriefData);
}

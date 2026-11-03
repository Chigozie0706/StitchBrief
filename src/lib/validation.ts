import { ALLOWED_IMAGE_TYPES, LIMITS, type AllowedImageType } from "./config";
import { ALL_ORIGINS, DECISION_STATUSES, MODEL_ORIGINS, normalizeModelDecision } from "./decisions";
import type {
  AnalysisResult, BriefData, BriefPiece, DecisionOrigin, DecisionStatus, DetectedGarment, Difference, GarmentType, Observation, ObservationKey, Question, TechnicalGap, UnresolvedItem,
} from "./types";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T = never>(error: string): Result<T> => ({ ok: false, error });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const OBSERVATION_KEYS: ObservationKey[] = [
  "garment_category", "silhouette", "neckline", "sleeves", "length_category", "design_details", "color",
  "fabric_appearance", "construction_considerations", "closure", "waistband", "pockets", "hem",
];
export const GARMENT_TYPES: GarmentType[] = ["dress", "top", "trousers", "skirt", "outerwear", "other"];

function text(v: unknown, field: string, max: number, opts: { optional?: boolean } = {}): Result<string> {
  if (v === undefined || v === null) return opts.optional ? ok("") : fail(`${field} is required.`);
  if (typeof v !== "string") return fail(`${field} must be text.`);
  const s = v.trim();
  if (!s && !opts.optional) return fail(`${field} is required.`);
  if (s.length > max) return fail(`${field} is too long (max ${max} characters).`);
  return ok(s);
}
function textList(v: unknown, field: string, max: number, maxItems: number, opts: { minItems?: number } = {}): Result<string[]> {
  if (!Array.isArray(v) || v.length > maxItems || v.some((x) => typeof x !== "string" || x.length > max)) return fail(`${field} must be a short list of text.`);
  const items = (v as string[]).map((s) => s.trim()).filter(Boolean);
  if (items.length < (opts.minItems ?? 0)) return fail(`${field} is empty.`);
  return ok(items);
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
  try { sig = Array.from(atob(b64.slice(0, 24)), (c) => c.charCodeAt(0)); } catch { return fail("Image data is not valid base64."); }
  if (!SIGNATURES[mime as AllowedImageType](sig)) return fail("Image contents do not match its declared type.");
  return ok({ mime: mime as AllowedImageType, bytes });
}

/* ---------- decisions ---------- */
export function parseObservation(v: unknown, i = 0, fromModel = false): Result<Observation> {
  if (!isRecord(v)) return fail(`Observation ${i} is invalid.`);
  const key = v.key as ObservationKey;
  if (!OBSERVATION_KEYS.includes(key)) return fail(`Observation ${i} has an unknown key.`);
  if (!DECISION_STATUSES.includes(v.status as DecisionStatus)) return fail(`Observation ${i} has an invalid status.`);
  if (!(fromModel ? MODEL_ORIGINS : ALL_ORIGINS).includes(v.origin as DecisionOrigin)) return fail(`Observation ${i} has an invalid origin.`);
  const piece = text(v.piece, "piece", 60);
  if (!piece.ok) return fail(`Observation ${i} is missing the garment it describes.`);
  const label = text(v.label, "label", LIMITS.MAX_SHORT_TEXT);
  if (!label.ok) return fail(label.error);
  const value = text(v.value, "value", LIMITS.MAX_ANSWER);
  if (!value.ok) return fail(value.error);
  const reason = text(v.reason, "reason", 300, { optional: true });
  if (!reason.ok) return fail(reason.error);
  const note = text(v.note, "note", LIMITS.MAX_ANSWER, { optional: true });
  if (!note.ok) return fail(note.error);
  let status = v.status as DecisionStatus, origin = v.origin as DecisionOrigin, why = reason.value;
  if (fromModel) ({ status, origin, reason: why } = normalizeModelDecision(status, origin, why));
  const prev = !fromModel && DECISION_STATUSES.includes(v.previousStatus as DecisionStatus) ? (v.previousStatus as DecisionStatus) : undefined;
  return ok({ piece: piece.value, key, label: label.value, value: value.value, status, origin, ...(why ? { reason: why } : {}), ...(prev ? { previousStatus: prev } : {}), ...(note.value ? { note: note.value } : {}) });
}

export function parseGarments(v: unknown): Result<DetectedGarment[]> {
  if (!Array.isArray(v) || v.length === 0) return fail("The model did not identify any garment.");
  if (v.length > 4) return fail("Too many garments identified.");
  const out: DetectedGarment[] = [];
  for (let i = 0; i < v.length; i++) {
    const g = v[i];
    if (!isRecord(g)) return fail(`Garment ${i} is invalid.`);
    const name = text(g.name, "garment name", 60);
    if (!name.ok) return fail(name.error);
    if (!GARMENT_TYPES.includes(g.type as GarmentType)) return fail(`Garment ${i} has an unknown type.`);
    if (out.some((o) => o.name.toLowerCase() === name.value.toLowerCase())) return fail("Garment names must be unique.");
    out.push({ name: name.value, type: g.type as GarmentType });
  }
  return ok(out);
}

export type DuplicateKey = { piece: string; key: string; count: number };

/** Every garment/key pair that appears more than once (garment compared case-insensitively). */
export function findDuplicateObservationKeys(observations: Observation[]): DuplicateKey[] {
  const seen = new Map<string, DuplicateKey>();
  for (const o of observations) {
    const id = `${o.piece.toLowerCase()}:${o.key}`;
    const hit = seen.get(id);
    if (hit) hit.count++;
    else seen.set(id, { piece: o.piece, key: o.key, count: 1 });
  }
  return [...seen.values()].filter((d) => d.count > 1);
}

export function parseObservations(v: unknown, fromModel = false): Result<Observation[]> {
  if (!Array.isArray(v) || v.length === 0) return fail("Observations are required.");
  if (v.length > LIMITS.MAX_OBSERVATIONS) return fail("Too many observations.");
  const out: Observation[] = [];
  for (let i = 0; i < v.length; i++) {
    const r = parseObservation(v[i], i, fromModel);
    if (!r.ok) return fail(r.error);
    out.push(r.value);
  }
  return ok(out);
}

/** Model output must not contain answers; client requests may. */
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
  if (!Array.isArray(v.options) || v.options.length > 8 || v.options.some((o) => typeof o !== "string" || !o.trim() || o.length > 80)) return fail(`Question ${i} has invalid options.`);
  if (v.type === "single_select" && v.options.length < 2) return fail(`Question ${i} needs at least two options.`);
  if (v.priority !== "high" && v.priority !== "normal") return fail(`Question ${i} has an invalid priority.`);
  const topic = text(v.topic, "topic", 40);
  if (!topic.ok || !/^[a-z][a-z0-9_]*$/i.test(topic.value)) return fail(`Question ${i} has an invalid topic.`);
  const piece = text(v.piece, "piece", 60, { optional: true });
  if (!piece.ok) return fail(piece.error);
  const q: Question = { id: id.value, question: question.value, reason: reason.value, type: v.type, options: (v.options as string[]).map((o) => o.trim()), priority: v.priority, topic: topic.value.toLowerCase(), piece: piece.value };
  if (fromClient) {
    const answer = text(v.answer, "answer", LIMITS.MAX_ANSWER, { optional: true });
    if (!answer.ok) return fail(answer.error);
    if (answer.value) q.answer = answer.value;
    if (v.skipped === true) q.skipped = true;
    if (v.needsReview === true) q.needsReview = true;
    if (v.round === 1 || v.round === 2) q.round = v.round;
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
    const topic = text(d.topic, "topic", 100), shows = text(d.reference_shows, "reference_shows", 300), wants = text(d.client_wants, "client_wants", 300);
    if (!topic.ok) return fail(topic.error);
    if (!shows.ok) return fail(shows.error);
    if (!wants.ok) return fail(wants.error);
    out.push({ topic: topic.value, reference_shows: shows.value, client_wants: wants.value });
  }
  return ok(out);
}

function parseRequested(v: unknown): Result<string[]> {
  if (v === undefined || v === null) return ok([]);
  const r = textList(v, "requested", 60, 4);
  return r.ok ? ok([...new Set(r.value)]) : r;
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

export type ClarifyRequest = Context & { observations: Observation[]; questions: Question[]; differences: Difference[]; requested: string[] };
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
  const req = parseRequested(body.requested);
  if (!req.ok) return fail(req.error);
  return ok({ ...ctx.value, observations: obs.value, questions: qs.value, differences: diffs.value, requested: req.value });
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
  const obs = parseObservations(raw.observations, true);
  if (!obs.ok) return fail(obs.error);
  const garments = parseGarments(raw.garments);
  if (!garments.ok) return fail(garments.error);
  const names = new Set(garments.value.map((g) => g.name.toLowerCase()));
  if (obs.value.some((o) => !names.has(o.piece.toLowerCase()))) return fail("An observation refers to a garment that was not identified.");
  if (garments.value.some((g) => !obs.value.some((o) => o.piece.toLowerCase() === g.name.toLowerCase()))) return fail("An identified garment has no observations.");
  const duplicates = findDuplicateObservationKeys(obs.value);
  if (duplicates.length > 0) {
    const shown = duplicates.slice(0, 8).map((d) => `${d.piece}/${d.key} (×${d.count})`).join(", ");
    return fail(`Model returned duplicate observation keys: ${shown}${duplicates.length > 8 ? `, and ${duplicates.length - 8} more` : ""}.`);
  }
  const missing = textList(raw.missing_information, "missing_information", 200, 12);
  if (!missing.ok) return fail(missing.error);
  const diffs = parseDifferences(raw.differences);
  if (!diffs.ok) return fail(diffs.error);
  const qs = parseQuestions(raw.questions, false, 8);
  if (!qs.ok) return fail(qs.error);
  return ok({ summary: summary.value, garments: garments.value, observations: obs.value, missing_information: missing.value, differences: diffs.value, questions: qs.value });
}

function parsePiece(v: unknown, i: number): Result<BriefPiece> {
  if (!isRecord(v)) return fail(`Piece ${i} is invalid.`);
  const name = text(v.name, "piece name", 60), fit = text(v.fit_and_comfort, "fit_and_comfort", 1500), fab = text(v.fabric_preferences, "fabric_preferences", 1500), con = text(v.construction_and_finishing, "construction_and_finishing", 1500);
  for (const r of [name, fit, fab, con]) if (!r.ok) return fail(`Model output is incomplete: ${r.error}`);
  const body = textList(v.body_measurements, "body_measurements", 200, 14), dims = textList(v.garment_dimensions, "garment_dimensions", 200, 14), changes = textList(v.changes_from_reference, "changes_from_reference", 300, 12);
  for (const r of [body, dims, changes]) if (!r.ok) return fail(`Model output is incomplete: ${r.error}`);
  return ok({ name: (name as { value: string }).value, fit_and_comfort: (fit as { value: string }).value, fabric_preferences: (fab as { value: string }).value, construction_and_finishing: (con as { value: string }).value,
    body_measurements: (body as { value: string[] }).value, garment_dimensions: (dims as { value: string[] }).value, changes_from_reference: (changes as { value: string[] }).value });
}

/** `expected` = the garment names the brief must cover, one piece each. */
export function parseBrief(raw: unknown, expected: string[]): Result<BriefData> {
  if (!isRecord(raw)) return fail("Model output was not an object.");
  const title = text(raw.title, "title", 160), overview = text(raw.garment_overview, "garment_overview", 1500), shared = text(raw.shared_requirements, "shared_requirements", 1500, { optional: true });
  for (const r of [title, overview, shared]) if (!r.ok) return fail(`Model output is incomplete: ${r.error}`);
  if (!Array.isArray(raw.pieces) || raw.pieces.length !== expected.length) return fail("The brief does not cover exactly the requested garments.");
  const pieces: BriefPiece[] = [];
  for (let i = 0; i < raw.pieces.length; i++) {
    const p = parsePiece(raw.pieces[i], i);
    if (!p.ok) return fail(p.error);
    const match = expected.find((e) => e.toLowerCase() === p.value.name.toLowerCase());
    if (!match || pieces.some((x) => x.name === match)) return fail(`The brief names a garment that was not requested ("${p.value.name}").`);
    pieces.push({ ...p.value, name: match });
  }
  const sugg = textList(raw.ai_suggestions, "ai_suggestions", 400, 12), check = textList(raw.review_checklist, "review_checklist", 300, 20, { minItems: 1 });
  if (!sugg.ok) return fail(`Model output is incomplete: ${sugg.error}`);
  if (!check.ok) return fail(`Model output is incomplete: ${check.error}`);
  const unresolved = parseItems<UnresolvedItem>(raw.unresolved, false), gaps = parseItems<TechnicalGap>(raw.technical_gaps, true);
  if (!unresolved.ok) return fail(`Model output is incomplete: ${unresolved.error}`);
  if (!gaps.ok) return fail(`Model output is incomplete: ${gaps.error}`);
  return ok({ title: (title as { value: string }).value, garment_overview: (overview as { value: string }).value, shared_requirements: (shared as { value: string }).value, pieces, ai_suggestions: sugg.value, unresolved: unresolved.value, technical_gaps: gaps.value, review_checklist: check.value });
}

function parseItems<T extends UnresolvedItem | TechnicalGap>(v: unknown, withStatus: boolean): Result<T[]> {
  if (!Array.isArray(v) || v.length > 14) return fail("must be a short list.");
  const out: T[] = [];
  for (const x of v) {
    if (!isRecord(x)) return fail("contains an invalid item.");
    const topic = text(x.topic, "topic", 80), detail = text(x.detail, "detail", 400), ref = text(x.ref, "ref", 120, { optional: true }), piece = text(x.piece, "piece", 60, { optional: true });
    for (const r of [topic, detail, ref, piece]) if (!r.ok) return fail(r.error);
    const status = x.status;
    if (withStatus && status !== "unknown" && status !== "needs_measurement") return fail("has an invalid status.");
    out.push({ topic: (topic as { value: string }).value, detail: (detail as { value: string }).value, piece: (piece as { value: string }).value, ref: (ref as { value: string }).value, ...(withStatus ? { status } : {}) } as T);
  }
  return ok(out);
}

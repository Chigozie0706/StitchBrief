// 1x1 JPEG / PNG / WebP (valid headers) as data URLs
export const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
export const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
export const WEBP = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
export const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

export const goodAnalyzeBody = (image = JPEG) => ({ image, description: "A burgundy evening dress with a higher neckline", garment: "Dress", occasion: "Reception" });

type Status = "observed" | "client_confirmed" | "ai_suggested" | "uncertain" | "unknown" | "needs_measurement";
type Origin = "image" | "client_description" | "ai";
/** A model-style observation (reason/note present, as the strict schema requires). */
export const ob = (piece: string, key: string, value: string, status: Status = "observed", origin: Origin = "image", reason = "") =>
  ({ piece, key, label: key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), value, status, origin, reason, note: "" });
export const qn = (id: string, question: string, over: Record<string, unknown> = {}) =>
  ({ id, question, reason: "Matters for the brief.", type: "text", options: [], priority: "normal", topic: id, piece: "", ...over });
export const choice = (id: string, question: string, options: string[], over: Record<string, unknown> = {}) => qn(id, question, { type: "single_select", options, ...over });

export const liveAnalysisJson = {
  summary: "Long burgundy dress.",
  garments: [{ name: "Dress", type: "dress" }],
  observations: [
    ob("Dress", "garment_category", "Dress"),
    ob("Dress", "silhouette", "Column"),
    ob("Dress", "neckline", "Draped V"),
    ob("Dress", "sleeves", "Sleeveless"),
    ob("Dress", "length_category", "Full length"),
    ob("Dress", "design_details", "Not visible", "unknown"),
    ob("Dress", "color", "Deep burgundy"),
    ob("Dress", "fabric_appearance", "Fluid with soft sheen (visual impression)", "uncertain", "image", "Sheen is hard to judge in a photo"),
    ob("Dress", "construction_considerations", "Toile recommended", "ai_suggested", "ai"),
  ],
  missing_information: ["Fit", "Fabric"],
  differences: [{ topic: "Neckline", reference_shows: "Draped V neckline", client_wants: "A higher neckline" }],
  questions: [choice("fit", "How should it fit?", ["Fitted", "Relaxed"], { priority: "high", topic: "fit" }), qn("changes", "Changes from reference?", { topic: "changes" })],
};

export const liveBriefJson = {
  title: "Burgundy evening dress",
  garment_overview: "Long burgundy dress for a reception.",
  shared_requirements: "",
  pieces: [{
    name: "Dress", fit_and_comfort: "Relaxed fit.", fabric_preferences: "Fluid drape preferred.", construction_and_finishing: "Concealed zip suggested.",
    body_measurements: ["Bust", "Waist", "Full hip"], garment_dimensions: ["Finished length"], changes_from_reference: ["Higher neckline"],
  }],
  ai_suggestions: ["Consider a toile fitting"],
  unresolved: [],
  technical_gaps: [],
  review_checklist: ["Review toile"],
};

/** Builds a fetch stub returning the given Chat Completions-style responses in order. */
export function stubFetch(responses: Array<{ status?: number; json?: unknown; headers?: Record<string, string>; throws?: Error }>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r.throws) throw r.throws;
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  }) as typeof fetch;
  return { fn, calls };
}

export const completion = (content: unknown, finish = "stop") => ({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: finish }] });

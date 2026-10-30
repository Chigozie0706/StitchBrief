// 1x1 JPEG / PNG / WebP (valid headers) as data URLs
export const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
export const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
export const WEBP = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
export const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

export const goodAnalyzeBody = (image = JPEG) => ({ image, description: "A burgundy evening dress with a higher neckline", garment: "Dress", occasion: "Reception" });

export const liveAnalysisJson = {
  summary: "Long burgundy dress.",
  observations: [
    { key: "garment_category", label: "Garment category", value: "Dress", source: "observed", confidence: "high", note: "" },
    { key: "silhouette", label: "Silhouette", value: "Column", source: "observed", confidence: "medium", note: "" },
    { key: "neckline", label: "Neckline", value: "Draped V", source: "observed", confidence: "medium", note: "" },
    { key: "sleeves", label: "Sleeves", value: "Sleeveless", source: "observed", confidence: "high", note: "" },
    { key: "length_category", label: "Length", value: "Full length", source: "observed", confidence: "medium", note: "" },
    { key: "design_details", label: "Design details", value: "Not visible", source: "unknown", confidence: "low", note: "" },
    { key: "color", label: "Color", value: "Deep burgundy", source: "observed", confidence: "high", note: "" },
    { key: "fabric_appearance", label: "Fabric appearance", value: "Fluid with soft sheen (visual impression)", source: "ai_suggestion", confidence: "low", note: "" },
    { key: "construction_considerations", label: "Construction", value: "Toile recommended", source: "ai_suggestion", confidence: "medium", note: "" },
  ],
  missing_information: ["Fit", "Fabric"],
  differences: [{ topic: "Neckline", reference_shows: "Draped V neckline", client_wants: "A higher neckline" }],
  questions: [
    { id: "fit", question: "How should it fit?", reason: "Drives ease.", type: "single_select", options: ["Fitted", "Relaxed"], required: true },
    { id: "changes", question: "Changes from reference?", reason: "Differences matter.", type: "text", options: [], required: false },
  ],
};

export const liveBriefJson = {
  title: "Burgundy evening dress", garment_overview: "o", silhouette_and_fit: "s", neckline_and_sleeves: "n", length: "l",
  fabric_and_materials: "f", color_and_finishing: "c", construction_considerations: "k", client_confirmed_modifications: "None confirmed.",
  measurements_required: ["Bust"], assumptions_and_uncertainties: ["Fabric unconfirmed"], open_questions: ["Fabric?"], final_review_checklist: ["Review toile"],
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

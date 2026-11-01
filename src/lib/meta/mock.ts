// Deterministic mock provider. It does NOT look at the image: every observation is labelled accordingly.
import type { AnalysisResult, BriefData, DetectedGarment, Observation, ObservationKey, Question } from "../types";
import type { AnalyzeRequest, ClarifyRequest, GenerateRequest } from "../validation";

const NOTE = "Mock mode: the image was not analyzed.";
const COLORS = ["burgundy", "black", "ivory", "white", "navy", "green", "red", "blue", "pink", "beige", "grey", "gold", "silver"];
const UNKNOWN = "Not determined (mock mode does not read the image)";

function find(text: string, words: string[]): string | null {
  const t = text.toLowerCase();
  return words.find((w) => t.includes(w)) ?? null;
}

/** Mock pieces come from the designer's selection only; real detection needs the live model. */
export function mockGarments(garment: string): DetectedGarment[] {
  if (garment === "Two-piece set") return [{ name: "Top", type: "top" }, { name: "Bottom", type: "trousers" }];
  const type = ({ Dress: "dress", Blouse: "top", Trousers: "trousers", Skirt: "skirt" } as Record<string, DetectedGarment["type"]>)[garment] ?? "other";
  return [{ name: garment || "Garment", type }];
}

function pieceObservations(g: DetectedGarment, r: AnalyzeRequest): Observation[] {
  const color = find(r.description, COLORS);
  const neckline = find(r.description, ["v-neck", "high neck", "halter", "square neck", "boat neck", "neckline"]);
  const sleeves = find(r.description, ["sleeveless", "long sleeve", "short sleeve", "puff sleeve", "cap sleeve"]);
  const length = find(r.description, ["floor-length", "full length", "maxi", "midi", "knee-length", "mini"]);
  const stated = (v: string | null, label: string) =>
    v ? { value: `${label}: "${v}" (from the client description)`, source: "client_confirmed" as const, confidence: "medium" as const } : { value: UNKNOWN, source: "unknown" as const, confidence: "low" as const };
  const obs = (key: ObservationKey, label: string, rest: Omit<Observation, "piece" | "key" | "label">): Observation => ({ piece: g.name, key, label, ...rest });
  const bottoms = g.type === "trousers" || g.type === "skirt";
  const list: Observation[] = [
    obs("garment_category", "Garment category", { value: r.garment || "Not specified", source: r.garment ? "client_confirmed" : "unknown", confidence: r.garment ? "high" : "low", note: NOTE }),
    obs("silhouette", "Silhouette", { value: UNKNOWN, source: "unknown", confidence: "low", note: NOTE }),
  ];
  if (!bottoms) {
    list.push(obs("neckline", "Neckline", { ...stated(neckline, "Neckline"), note: NOTE }), obs("sleeves", "Sleeves", { ...stated(sleeves, "Sleeves"), note: NOTE }));
  }
  list.push(
    obs("length_category", "Length", { ...stated(length, "Length"), note: NOTE }),
    obs("design_details", "Design details", { value: UNKNOWN, source: "unknown", confidence: "low", note: NOTE }),
    obs("color", "Color", { ...stated(color, "Color"), note: NOTE }),
    obs("fabric_appearance", "Fabric appearance", { value: "Visual impression unavailable in mock mode", source: "unknown", confidence: "low", note: NOTE }),
    obs("construction_considerations", "Construction considerations", { value: "Suggestion: plan a toile fitting before cutting final fabric", source: "ai_suggestion", confidence: "medium" }),
  );
  return list;
}

export function mockAnalyze(r: AnalyzeRequest): AnalysisResult {
  const garments = mockGarments(r.garment);
  return {
    summary: "Mock analysis based only on the client description and the selected garment type. Configure MODEL_API_KEY to analyze the image.",
    garments,
    observations: garments.flatMap((g) => pieceObservations(g, r)),
    differences: [],
    missing_information: ["Fit and ease", "Fabric and lining", "Closure and finishing", "Client measurements"],
    questions: mockQuestions(),
  };
}

export function mockQuestions(): Question[] {
  return [
    { id: "fit", question: "How should the garment fit?", reason: "Fit drives pattern ease and fitting plan.", type: "single_select", options: ["Fitted", "Semi-fitted", "Relaxed"], required: true },
    { id: "fabric", question: "What fabric do you intend to use?", reason: "Fabric appearance in a photo cannot confirm composition or weight.", type: "single_select", options: ["Crepe", "Satin", "Linen blend", "Not decided"], required: true },
    { id: "closure", question: "Any preference for closure and finishing?", reason: "Closures and hidden construction are rarely visible in a reference.", type: "single_select", options: ["Concealed zip", "Buttons", "Hook and eye", "Designer decides"], required: false },
    { id: "changes", question: "Any changes compared with the reference image?", reason: "Differences between the image and the client's wish must be explicit.", type: "text", options: [], required: false },
  ];
}

export function mockClarify(r: ClarifyRequest): Question[] {
  const asked = new Set(r.questions.map((q) => q.id));
  const answer = (id: string) => r.questions.find((q) => q.id === id)?.answer;
  const out: Question[] = [];
  if (!asked.has("lining") && answer("fabric") && /satin|crepe/i.test(answer("fabric")!))
    out.push({ id: "lining", question: "Should the garment be lined?", reason: "Lightweight fabrics often need lining for opacity and drape.", type: "single_select", options: ["Fully lined", "Partly lined", "Unlined"], required: false });
  return out;
}

export function mockBrief(r: GenerateRequest): BriefData {
  const answered = r.questions.filter((q) => q.answer && !q.skipped);
  const open = r.questions.filter((q) => !q.answer || q.skipped);
  const pieces = [...new Set(r.observations.map((o) => o.piece))];
  const multi = pieces.length > 1;
  const line = (key: string, fallback: string) => {
    const parts = r.observations.filter((x) => x.key === key).map((ob) => `${multi ? `${ob.piece}: ` : ""}${ob.value} [${ob.source.replace("_", " ")}]`);
    return parts.length ? parts.join("; ") : fallback;
  };
  const a = (id: string) => answered.find((q) => q.id === id)?.answer;
  return {
    title: `${r.garment || "Garment"} for ${r.occasion || "client"}`,
    garment_overview: `${r.garment || "Garment"}${multi ? ` (${pieces.join(" + ")})` : ""} for ${r.occasion || "an unspecified occasion"}. Client direction: ${r.description}`,
    silhouette_and_fit: `${line("silhouette", "Not determined")}. Fit: ${a("fit") ?? "not confirmed"}.`,
    neckline_and_sleeves: `${line("neckline", "Neckline not determined")}; ${line("sleeves", "sleeves not determined")}.`,
    length: line("length_category", "Length not determined"),
    fabric_and_materials: `${a("fabric") ?? "Not confirmed"}. ${line("fabric_appearance", "Fabric appearance not determined")}. Composition, weight and stretch cannot be confirmed from an image.`,
    color_and_finishing: `${line("color", "Color not determined")}. Closure/finishing: ${a("closure") ?? "not confirmed"}.`,
    construction_considerations: "Suggestion (unconfirmed): drafting and a toile fitting are recommended; hidden construction is not visible in the reference.",
    client_confirmed_modifications: a("changes") ?? "None confirmed.",
    measurements_required: ["Bust", "Waist", "High hip", "Full hip", "Shoulder to waist", "Finished length", "Preferred ease"],
    assumptions_and_uncertainties: ["Generated in mock mode: the reference image was not analyzed.", ...open.map((q) => `Unconfirmed: ${q.question}`)],
    open_questions: open.map((q) => q.question),
    final_review_checklist: ["Confirm measurements", "Approve fabric and color", "Approve neckline and fit", "Review toile", "Sign off final brief before cutting"],
  };
}

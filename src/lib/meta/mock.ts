// Deterministic mock provider. It does NOT look at the image: every observation is labelled accordingly.
import type { AnalysisResult, BriefData, Observation, Question } from "../types";
import type { AnalyzeRequest, ClarifyRequest, GenerateRequest } from "../validation";

const NOTE = "Mock mode: the image was not analyzed.";
const COLORS = ["burgundy", "black", "ivory", "white", "navy", "green", "red", "blue", "pink", "beige", "grey", "gold", "silver"];

function find(text: string, words: string[]): string | null {
  const t = text.toLowerCase();
  return words.find((w) => t.includes(w)) ?? null;
}

export function mockAnalyze(r: AnalyzeRequest): AnalysisResult {
  const color = find(r.description, COLORS);
  const neckline = find(r.description, ["v-neck", "high neck", "halter", "square neck", "boat neck", "neckline"]);
  const sleeves = find(r.description, ["sleeveless", "long sleeve", "short sleeve", "puff sleeve", "cap sleeve"]);
  const length = find(r.description, ["floor-length", "full length", "maxi", "midi", "knee-length", "mini"]);
  const stated = (v: string | null, label: string): Pick<Observation, "value" | "source" | "confidence"> =>
    v ? { value: `${label}: "${v}" (from the client description)`, source: "client_confirmed", confidence: "medium" } : { value: "Not determined (mock mode does not read the image)", source: "unknown", confidence: "low" };
  const observations: Observation[] = [
    { key: "garment_category", label: "Garment category", value: r.garment || "Not specified", source: r.garment ? "client_confirmed" : "unknown", confidence: r.garment ? "high" : "low", note: NOTE },
    { key: "silhouette", label: "Silhouette", ...stated(null, "Silhouette"), note: NOTE },
    { key: "neckline", label: "Neckline", ...stated(neckline, "Neckline"), note: NOTE },
    { key: "sleeves", label: "Sleeves", ...stated(sleeves, "Sleeves"), note: NOTE },
    { key: "length_category", label: "Length", ...stated(length, "Length"), note: NOTE },
    { key: "design_details", label: "Design details", value: "Not determined (mock mode does not read the image)", source: "unknown", confidence: "low", note: NOTE },
    { key: "color", label: "Color", ...stated(color, "Color"), note: NOTE },
    { key: "fabric_appearance", label: "Fabric appearance", value: "Visual impression unavailable in mock mode", source: "unknown", confidence: "low", note: NOTE },
    { key: "construction_considerations", label: "Construction considerations", value: "Suggestion: plan a toile fitting before cutting final fabric", source: "ai_suggestion", confidence: "medium" },
  ];
  return {
    summary: "Mock analysis based only on the client description. Configure MODEL_API_KEY to analyze the image.",
    observations,
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
  const o = (key: string) => r.observations.find((x) => x.key === key);
  const line = (key: string, fallback: string) => {
    const ob = o(key);
    return ob ? `${ob.value} [${ob.source.replace("_", " ")}]` : fallback;
  };
  const a = (id: string) => answered.find((q) => q.id === id)?.answer;
  return {
    title: `${r.garment || "Garment"} for ${r.occasion || "client"}`,
    garment_overview: `${r.garment || "Garment"} for ${r.occasion || "an unspecified occasion"}. Client direction: ${r.description}`,
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

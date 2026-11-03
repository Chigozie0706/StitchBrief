// Deterministic mock provider. It does NOT look at the image: every detail is labelled accordingly.
import { expectedPieceNames } from "../assemble";
import type { AnalysisResult, BriefData, DetectedGarment, Observation, ObservationKey, Question } from "../types";
import type { AnalyzeRequest, ClarifyRequest, GenerateRequest } from "../validation";

const NOTE = "Mock mode: the image was not analyzed.";
const COLORS = ["burgundy", "black", "ivory", "white", "navy", "green", "emerald", "teal", "red", "blue", "pink", "beige", "grey", "gold", "silver"];
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
    v ? { value: `${label}: "${v}" (from the client description)`, status: "client_confirmed" as const, origin: "client_description" as const }
      : { value: UNKNOWN, status: "unknown" as const, origin: "image" as const };
  const obs = (key: ObservationKey, label: string, rest: Omit<Observation, "piece" | "key" | "label">): Observation => ({ piece: g.name, key, label, ...rest });
  const bottoms = g.type === "trousers" || g.type === "skirt";
  const list: Observation[] = [
    obs("garment_category", "Garment category", r.garment ? { value: r.garment, status: "client_confirmed", origin: "designer_edit", note: NOTE } : { value: "Not specified", status: "unknown", origin: "image", note: NOTE }),
    obs("silhouette", "Silhouette", { value: UNKNOWN, status: "unknown", origin: "image", note: NOTE }),
  ];
  if (!bottoms) list.push(obs("neckline", "Neckline", { ...stated(neckline, "Neckline"), note: NOTE }), obs("sleeves", "Sleeves", { ...stated(sleeves, "Sleeves"), note: NOTE }));
  list.push(
    obs("length_category", "Length", { ...stated(length, "Length"), note: NOTE }),
    obs("design_details", "Design details", { value: UNKNOWN, status: "unknown", origin: "image", note: NOTE }),
    obs("color", "Color", { ...stated(color, "Color"), note: NOTE }),
    obs("fabric_appearance", "Fabric appearance", { value: "Visual impression unavailable in mock mode", status: "unknown", origin: "image", note: NOTE }),
    obs("construction_considerations", "Construction considerations", { value: "Suggestion: plan a toile fitting before cutting final fabric", status: "ai_suggested", origin: "ai" }),
  );
  return list;
}

export function mockQuestions(): Question[] {
  const q = (id: string, question: string, reason: string, type: Question["type"], options: string[], priority: Question["priority"], topic = id): Question => ({ id, question, reason, type, options, priority, topic, piece: "" });
  return [
    q("fit", "How should the garment fit?", "Fit drives pattern ease and fitting plan.", "single_select", ["Fitted", "Semi-fitted", "Relaxed"], "high"),
    q("fabric", "What fabric look do you want?", "Fabric appearance in a photo cannot confirm composition or weight.", "single_select", ["Crepe", "Satin", "Linen blend", "Not decided"], "high"),
    q("closure", "Any preference for closure and finishing?", "Closures and hidden construction are rarely visible in a reference.", "single_select", ["Concealed zip", "Buttons", "Hook and eye", "Designer decides"], "normal"),
    q("changes", "Any changes compared with the reference image?", "Differences between the image and the client's wish must be explicit.", "text", [], "normal"),
  ];
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

export function mockClarify(r: ClarifyRequest): Question[] {
  const asked = new Set(r.questions.map((q) => q.id));
  const fabric = r.questions.find((q) => q.id === "fabric")?.answer;
  if (!asked.has("lining") && fabric && /satin|crepe/i.test(fabric))
    return [{ id: "lining", question: "Should the garment be lined?", reason: "Lightweight fabrics often need lining for opacity and drape.", type: "single_select", options: ["Fully lined", "Partly lined", "Unlined"], priority: "normal", topic: "lining", piece: "" }];
  return [];
}

const TOP = ["Bust", "High bust", "Waist", "Shoulder width", "Shoulder to waist", "Arm length"];
const BOTTOM = ["Waist", "High hip", "Full hip", "Inseam", "Rise"];

export function mockBrief(r: GenerateRequest): BriefData {
  const answer = (id: string) => r.questions.find((q) => q.id === id && q.answer && !q.skipped && !q.needsReview)?.answer;
  const names = expectedPieceNames(r);
  const garmentFor = (n: string) => mockGarments(r.garment).find((g) => g.name.toLowerCase() === n.toLowerCase())?.type ?? "other";
  return {
    title: `${r.garment || "Garment"} for ${r.occasion || "client"}`,
    garment_overview: `${names.join(" and ")} for ${r.occasion || "an unspecified occasion"}. Client direction: ${r.description}`,
    shared_requirements: names.length > 1 ? "Shared colour and style as described by the client." : "",
    pieces: names.map((name) => ({
      name,
      fit_and_comfort: answer("fit") ? `Fit preference: ${answer("fit")}.` : "Fit not confirmed.",
      fabric_preferences: answer("fabric") ? `Preference: ${answer("fabric")}.` : "No fabric preference confirmed.",
      construction_and_finishing: "Suggestion (unconfirmed): drafting and a toile fitting are recommended.",
      body_measurements: ["trousers", "skirt"].includes(garmentFor(name)) ? BOTTOM : TOP,
      garment_dimensions: ["Finished length", ...(garmentFor(name) === "top" || garmentFor(name) === "dress" ? ["Sleeve length"] : ["Waistband depth"])],
      changes_from_reference: r.differences.map((d) => `${d.topic}: ${d.client_wants}`),
    })),
    ai_suggestions: [],
    unresolved: [],
    technical_gaps: [],
    review_checklist: ["Review the toile", "Sign off the brief before cutting"],
  };
}

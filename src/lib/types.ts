export type View = "overview" | "upload" | "clarify" | "editor" | "briefs" | "library" | "settings";
export type BriefStatus = "Draft" | "Needs clarification" | "Ready";
export type Provider = "live" | "mock";

/** Source classification returned by the API. */
export type ApiSource = "observed" | "client_confirmed" | "ai_suggestion" | "unknown";
export type Confidence = "high" | "medium" | "low";
export type ObservationKey =
  | "garment_category" | "silhouette" | "neckline" | "sleeves" | "length_category"
  | "design_details" | "color" | "fabric_appearance" | "construction_considerations";

export type Observation = {
  key: ObservationKey;
  label: string;
  value: string;
  source: ApiSource;
  confidence: Confidence;
  note?: string;
};

export type QuestionType = "single_select" | "text";
export type Question = {
  id: string;
  question: string;
  reason: string;
  type: QuestionType;
  options: string[];
  required: boolean;
  answer?: string;
  skipped?: boolean;
  /** UI-only: the user chose "Something else" and is typing a custom answer. */
  custom?: boolean;
};

export type Section = { title: string; body: string };

export type Difference = { topic: string; reference_shows: string; client_wants: string };

export type AnalysisResult = {
  summary: string;
  observations: Observation[];
  missing_information: string[];
  differences: Difference[];
  questions: Question[];
};

export type BriefData = {
  title: string;
  garment_overview: string;
  silhouette_and_fit: string;
  neckline_and_sleeves: string;
  length: string;
  fabric_and_materials: string;
  color_and_finishing: string;
  construction_considerations: string;
  client_confirmed_modifications: string;
  measurements_required: string[];
  assumptions_and_uncertainties: string[];
  open_questions: string[];
  final_review_checklist: string[];
};

export type BriefForm = { image: string; thumb: string; description: string; garment: string; occasion: string };

export type SavedBrief = {
  id: string;
  title: string;
  /** Display string. Recomputed from updatedAt for real drafts. */
  updated: string;
  status: BriefStatus;
  image: string;
  sections?: Section[];
  // Present on real (non-demo) drafts only:
  createdAt?: string;
  updatedAt?: string;
  description?: string;
  garment?: string;
  occasion?: string;
  observations?: Observation[];
  questions?: Question[];
  provider?: Provider;
  summary?: string;
  missing?: string[];
  differences?: Difference[];
  /** Fingerprint of the answers/observations the brief was generated from (stale detection). */
  generatedFrom?: string;
};

export type ApiOk<T> = { ok: true; provider: Provider; model: string | null; data: T };
export type ApiErr = { ok: false; error: { code: string; message: string } };

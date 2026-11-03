export type View = "overview" | "upload" | "clarify" | "editor" | "briefs" | "library" | "settings";
export type BriefStatus = "Draft" | "Needs clarification" | "Ready";
export type Provider = "live" | "mock";

/* ---------- decision model ---------- */
/**
 * observed          visible in the reference image
 * client_confirmed  explicitly stated or approved by the client / designer
 * ai_suggested      proposed by the AI, not approved
 * uncertain         information exists but is ambiguous, disputed or unreliable
 * unknown           not enough information to decide
 * needs_measurement can only be settled by measuring or fitting
 */
export type DecisionStatus = "observed" | "client_confirmed" | "ai_suggested" | "uncertain" | "unknown" | "needs_measurement";
/** Where a decision came from. Kept separately from its status so it is never lost. */
export type DecisionOrigin = "image" | "client_description" | "client_answer" | "designer_edit" | "ai";

export type ObservationKey =
  | "garment_category" | "silhouette" | "neckline" | "sleeves" | "length_category" | "design_details" | "color"
  | "fabric_appearance" | "construction_considerations" | "closure" | "waistband" | "pockets" | "hem";

export type GarmentType = "dress" | "top" | "trousers" | "skirt" | "outerwear" | "other";
/** A distinct garment visible in the image (a top and trousers are two garments). */
export type DetectedGarment = { name: string; type: GarmentType };

export type Observation = {
  /** Which garment this decision describes (matches a DetectedGarment.name). */
  piece: string;
  key: ObservationKey;
  label: string;
  value: string;
  status: DecisionStatus;
  origin: DecisionOrigin;
  /** Why the detail is uncertain / needs measurement. */
  reason?: string;
  /** Status before the designer marked it uncertain, so "Undo" can restore it. */
  previousStatus?: DecisionStatus;
  note?: string;
};

export type QuestionType = "single_select" | "text";
export type Question = {
  id: string;
  question: string;
  reason: string;
  type: QuestionType;
  options: string[];
  /** "high" = materially affects appearance, fit or construction. Never blocks anything: every question can be skipped. */
  priority: "high" | "normal";
  /** Short snake_case slug of the decision (fit, closure, neckline…). Used to stop confirmed topics being asked again. */
  topic: string;
  /** Garment this question is about, "" when it concerns the whole outfit. */
  piece: string;
  /** 1 = initial round, 2 = the single follow-up round. */
  round?: 1 | 2;
  answer?: string;
  skipped?: boolean;
  /** Carried over after the reference image was replaced and not re-confirmed yet. */
  needsReview?: boolean;
  /** UI-only: the user chose "Something else" and is typing a custom answer. */
  custom?: boolean;
};

export type Difference = { topic: string; reference_shows: string; client_wants: string };

export type AnalysisResult = {
  summary: string;
  garments: DetectedGarment[];
  observations: Observation[];
  missing_information: string[];
  differences: Difference[];
  questions: Question[];
};

/* ---------- brief ---------- */
export type SectionKind =
  | "overview" | "confirmed" | "specification" | "fit" | "fabric" | "construction" | "body_measurements"
  | "garment_dimensions" | "suggestions" | "uncertain" | "unknown" | "checklist";
export type Section = { title: string; body: string; kind?: SectionKind; piece?: string };

export type BriefPiece = {
  name: string;
  fit_and_comfort: string;
  fabric_preferences: string;
  construction_and_finishing: string;
  /** Measured on the client's body. Names only, never values. */
  body_measurements: string[];
  /** Finished-garment dimensions and design specifications still to be set. */
  garment_dimensions: string[];
  changes_from_reference: string[];
};
export type UnresolvedItem = { topic: string; detail: string; piece: string; ref: string };
export type TechnicalGap = { topic: string; detail: string; piece: string; status: "unknown" | "needs_measurement"; ref: string };
export type BriefData = {
  title: string;
  garment_overview: string;
  shared_requirements: string;
  pieces: BriefPiece[];
  ai_suggestions: string[];
  unresolved: UnresolvedItem[];
  technical_gaps: TechnicalGap[];
  review_checklist: string[];
};
export type GenerateResult = { brief: BriefData; sections: Section[]; warnings: string[]; imageHash: string | null };

export type BriefForm = {
  /** Data URL sent to the model. For reopened drafts this is only the small stored preview. */
  image: string;
  thumb: string;
  /** SHA-256 of `image`; the server echoes it back so we can prove the analysis belongs to this image. */
  imageHash: string;
  imageSource: "original" | "preview";
  description: string;
  garment: string;
  occasion: string;
};

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
  imageHash?: string;
  garments?: DetectedGarment[];
  /** Garments the brief is for. null = the designer has not chosen yet. */
  requested?: string[] | null;
  warnings?: string[];
};

export type ApiOk<T> = { ok: true; provider: Provider; model: string | null; data: T };
export type ApiErr = { ok: false; error: { code: string; message: string } };

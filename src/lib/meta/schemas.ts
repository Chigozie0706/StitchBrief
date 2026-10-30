// JSON Schemas passed as response_format.json_schema.schema (see Meta "Structured output" docs).
// Non-recursive, depth < 10, additionalProperties:false and every key required.
import { OBSERVATION_KEYS } from "../validation";

const str = { type: "string" };
const strList = { type: "array", items: str };

export const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "observations", "missing_information", "differences", "questions"],
  properties: {
    summary: str,
    observations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label", "value", "source", "confidence", "note"],
        properties: {
          key: { type: "string", enum: OBSERVATION_KEYS },
          label: str,
          value: str,
          source: { type: "string", enum: ["observed", "client_confirmed", "ai_suggestion", "unknown"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          note: str,
        },
      },
    },
    missing_information: strList,
    differences: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "reference_shows", "client_wants"],
        properties: { topic: str, reference_shows: str, client_wants: str },
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "question", "reason", "type", "options", "required"],
        properties: {
          id: str,
          question: str,
          reason: str,
          type: { type: "string", enum: ["single_select", "text"] },
          options: strList,
          required: { type: "boolean" },
        },
      },
    },
  },
} as const;

export const CLARIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: { questions: ANALYSIS_SCHEMA.properties.questions },
} as const;

export const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title", "garment_overview", "silhouette_and_fit", "neckline_and_sleeves", "length", "fabric_and_materials",
    "color_and_finishing", "construction_considerations", "client_confirmed_modifications",
    "measurements_required", "assumptions_and_uncertainties", "open_questions", "final_review_checklist",
  ],
  properties: {
    title: str, garment_overview: str, silhouette_and_fit: str, neckline_and_sleeves: str, length: str,
    fabric_and_materials: str, color_and_finishing: str, construction_considerations: str,
    client_confirmed_modifications: str,
    measurements_required: strList, assumptions_and_uncertainties: strList, open_questions: strList, final_review_checklist: strList,
  },
} as const;

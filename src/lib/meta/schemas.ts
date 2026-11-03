// JSON Schemas passed as response_format.json_schema.schema (see Meta "Structured output" docs).
// Non-recursive, depth < 10, additionalProperties:false and every key required.
import { OBSERVATION_KEYS } from "../validation";

const str = { type: "string" };
const strList = { type: "array", items: str };

const QUESTIONS = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["id", "question", "reason", "type", "options", "priority", "topic", "piece"],
    properties: {
      id: str, question: str, reason: str,
      type: { type: "string", enum: ["single_select", "text"] },
      options: strList,
      priority: { type: "string", enum: ["high", "normal"] },
      topic: str,
      piece: str,
    },
  },
} as const;

export const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "garments", "observations", "missing_information", "differences", "questions"],
  properties: {
    summary: str,
    garments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "type"],
        properties: { name: str, type: { type: "string", enum: ["dress", "top", "trousers", "skirt", "outerwear", "other"] } },
      },
    },
    observations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["piece", "key", "label", "value", "status", "origin", "reason", "note"],
        properties: {
          piece: str,
          key: { type: "string", enum: OBSERVATION_KEYS },
          label: str,
          value: str,
          status: { type: "string", enum: ["observed", "client_confirmed", "ai_suggested", "uncertain", "unknown", "needs_measurement"] },
          origin: { type: "string", enum: ["image", "client_description", "ai"] },
          reason: str,
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
    questions: QUESTIONS,
  },
} as const;

export const CLARIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: { questions: QUESTIONS },
} as const;

export const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "garment_overview", "shared_requirements", "pieces", "ai_suggestions", "unresolved", "technical_gaps", "review_checklist"],
  properties: {
    title: str,
    garment_overview: str,
    shared_requirements: str,
    pieces: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "fit_and_comfort", "fabric_preferences", "construction_and_finishing", "body_measurements", "garment_dimensions", "changes_from_reference"],
        properties: {
          name: str, fit_and_comfort: str, fabric_preferences: str, construction_and_finishing: str,
          body_measurements: strList, garment_dimensions: strList, changes_from_reference: strList,
        },
      },
    },
    ai_suggestions: strList,
    unresolved: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["topic", "detail", "piece", "ref"], properties: { topic: str, detail: str, piece: str, ref: str } },
    },
    technical_gaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "detail", "piece", "status", "ref"],
        properties: { topic: str, detail: str, piece: str, status: { type: "string", enum: ["unknown", "needs_measurement"] }, ref: str },
      },
    },
    review_checklist: strList,
  },
} as const;

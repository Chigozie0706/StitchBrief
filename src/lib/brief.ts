import type { ApiSource, BriefData, Observation, Section } from "./types";

export type SourceLabel = "AI-observed" | "Client-confirmed" | "AI suggestion" | "Unanswered";

const bullets = (items: string[]) => (items.length ? items.map((i) => `• ${i}`).join("\n") : "None");

/** Turns the validated brief into the editable section list used by the editor. */
export function briefToSections(b: BriefData): Section[] {
  return [
    { title: "Garment overview", body: b.garment_overview },
    { title: "Silhouette and fit", body: b.silhouette_and_fit },
    { title: "Neckline and sleeves", body: b.neckline_and_sleeves },
    { title: "Length", body: b.length },
    { title: "Fabric and material requirements", body: b.fabric_and_materials },
    { title: "Color and finishing details", body: b.color_and_finishing },
    { title: "Construction considerations", body: b.construction_considerations },
    { title: "Client-confirmed modifications", body: b.client_confirmed_modifications },
    { title: "Measurements required from the client", body: bullets(b.measurements_required) },
    { title: "Assumptions and uncertainties", body: bullets(b.assumptions_and_uncertainties) },
    { title: "Open questions", body: bullets(b.open_questions) },
    { title: "Final review checklist", body: bullets(b.final_review_checklist) },
  ];
}

export function briefToText(title: string, sections: Section[]): string {
  return `${title}\n\n` + sections.map((s) => `${s.title}\n${s.body}`).join("\n\n");
}

export function briefToMarkdown(title: string, sections: Section[]): string {
  return `# ${title}\n\n` + sections.map((s) => `## ${s.title}\n\n${s.body}`).join("\n\n") + "\n";
}

export const SOURCE_LABEL: Record<ApiSource, SourceLabel> = {
  observed: "AI-observed",
  client_confirmed: "Client-confirmed",
  ai_suggestion: "AI suggestion",
  unknown: "Unanswered",
};

export const isUncertain = (o: Observation) => o.confidence === "low" || o.source === "unknown";

export function formatUpdated(iso: string | undefined, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now.getTime() - 86_400_000).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  if (yesterday) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

import type { SavedBrief, Section } from "./types";

export const sampleImage =
  "https://images.unsplash.com/photo-1568252542512-9fe8fe9c87bb?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=85&w=900";

export const demoBriefs: SavedBrief[] = [
  { id: "demo-1", title: "Mara’s burgundy evening dress", updated: "Today, 10:42", status: "Needs clarification", image: sampleImage },
  { id: "demo-2", title: "Linen wrap blouse", updated: "Yesterday", status: "Draft", image: "https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=300&q=80" },
  { id: "demo-3", title: "Ivory reception two-piece", updated: "12 Sep", status: "Ready", image: "https://images.unsplash.com/photo-1596755389378-c31d21fd1273?auto=format&fit=crop&w=300&q=80" },
];

export function generateDemoSections(description: string, garment: string, occasion: string, answers: Record<string, string>): Section[] {
  const kind = garment || "garment";
  return [
    { title: "Garment overview", body: `A ${answers.fit?.toLowerCase() || "fit not specified"} ${kind} for ${occasion || "an occasion not specified"}. Client direction: ${description || "Not specified."}` },
    { title: "Design and silhouette", body: `${answers.fit || "Not specified"} silhouette. The reference suggests a softly shaped waist and a clean, elongated line; confirm against the client’s desired ease.` },
    { title: "Neckline and sleeves", body: `${answers.neckline || "Not specified"}. Sleeve treatment is visible as sleeveless in the reference, but armhole depth must be confirmed during fitting.` },
    { title: "Length and fit preferences", body: `Full length is AI-observed from the reference. Final hem length and wearing ease require client measurements and footwear confirmation.` },
    { title: "Fabric and material requirements", body: `${answers.fabric || "Not specified"}. Fabric composition, weight, stretch, lining, and care requirements cannot be confirmed from an image.` },
    { title: "Color and finishing details", body: `Deep burgundy is observed. Use a concealed closure and restrained tonal finishing as an AI suggestion, subject to designer review.` },
    { title: "Construction considerations", body: `Professional pattern drafting and a toile fitting are recommended. Hidden construction, seam allowance, interfacing, and closure method are not visible in the reference.` },
    { title: "Client-confirmed modifications", body: answers.changes || "Not specified" },
    { title: "Measurements required from the client", body: `Bust, waist, high hip, full hip, shoulder-to-waist, finished length, and preferred ease. Measurements must be taken directly; they cannot be inferred from imagery.` },
    { title: "Open questions and assumptions", body: `Confirm exact fabric, lining, closure placement, hem finish, and mobility requirements. Any construction notes above marked as suggestions remain unconfirmed.` },
    { title: "Final review checklist", body: `Confirm measurements • Approve fabric and color • Approve neckline and fit • Review toile • Sign off final brief before cutting.` },
  ];
}

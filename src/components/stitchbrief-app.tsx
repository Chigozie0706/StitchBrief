"use client";

import { useEffect, useState } from "react";
import { Archive, Plus } from "lucide-react";
import { BriefRows, Header, Sidebar } from "@/components/shell";
import { Overview } from "@/components/views/overview";
import { Upload } from "@/components/views/upload";
import { Clarify } from "@/components/views/clarify";
import { Editor } from "@/components/views/editor";
import { Settings } from "@/components/views/settings";
import { briefToSections, formatUpdated } from "@/lib/brief";
import { answersKey, isAnswered } from "@/lib/clarify";
import { demoBriefs, generateDemoSections } from "@/lib/data";
import { loadDrafts, saveDraft, type SaveOutcome } from "@/lib/storage";
import type { BriefForm, BriefStatus, Difference, Observation, Provider, Question, SavedBrief, Section, View } from "@/lib/types";

const emptyForm: BriefForm = { image: "", thumb: "", description: "", garment: "Dress", occasion: "" };
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `d-${Date.now().toString(36)}`);

export function StitchBriefApp() {
  const [view, setView] = useState<View>("overview");
  const [menu, setMenu] = useState(false);
  const [form, setForm] = useState<BriefForm>(emptyForm);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [summary, setSummary] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [differences, setDifferences] = useState<Difference[]>([]);
  const [followupsChecked, setFollowupsChecked] = useState(false);
  const [generatedFrom, setGeneratedFrom] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [previous, setPrevious] = useState<{ title: string; sections: Section[] } | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [title, setTitle] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [saved, setSaved] = useState<SavedBrief[]>([]);
  const [draftId, setDraftId] = useState(newId);
  const [createdAt, setCreatedAt] = useState<string | undefined>();
  const [filter, setFilter] = useState<BriefStatus | "All">("All");

  useEffect(() => { setSaved(loadDrafts()); }, []);
  const allBriefs = [...saved, ...demoBriefs];
  // A brief is stale when the inputs it was generated from have changed since.
  const stale = sections.length > 0 && generatedFrom !== null && generatedFrom !== answersKey(questions, observations, differences);
  // Unknown baseline (reopened draft) counts as "may contain edits" so we always confirm before overwriting.
  const hasEdits = sections.length > 0 && (baseline === null || baseline !== JSON.stringify({ title, sections }));

  const persist = (status?: BriefStatus): SaveOutcome => {
    const now = new Date().toISOString();
    const open = questions.some((q) => !isAnswered(q) || q.skipped);
    const brief: SavedBrief = {
      id: draftId, title: title || `${form.garment} for ${form.occasion || "client"}`, updated: formatUpdated(now),
      status: status ?? (open ? "Needs clarification" : "Draft"), image: form.thumb || form.image, sections,
      createdAt: createdAt ?? now, updatedAt: now, description: form.description, garment: form.garment, occasion: form.occasion,
      observations, questions, provider: provider ?? undefined, summary, missing, differences, generatedFrom: generatedFrom ?? undefined,
    };
    const out = saveDraft(brief);
    if (out.ok) { setCreatedAt(brief.createdAt); setSaved(loadDrafts()); }
    return out;
  };

  const startNew = () => {
    setForm(emptyForm); setObservations([]); setQuestions([]); setSections([]); setTitle("");
    setSummary(""); setMissing([]); setDifferences([]); setGeneratedFrom(null); setBaseline(null); setPrevious(null);
    setProvider(null); setFollowupsChecked(false); setDraftId(newId()); setCreatedAt(undefined); setView("upload");
  };

  const openBrief = (b: SavedBrief) => {
    if (b.observations && b.questions && b.sections) {
      setDraftId(b.id); setCreatedAt(b.createdAt); setTitle(b.title); setSections(b.sections);
      setObservations(b.observations); setQuestions(b.questions); setFollowupsChecked(true); setProvider(b.provider ?? null);
      setSummary(b.summary ?? ""); setMissing(b.missing ?? []); setDifferences(b.differences ?? []); setGeneratedFrom(b.generatedFrom ?? null); setBaseline(null); setPrevious(null);
      setForm({ image: b.image, thumb: b.image, description: b.description ?? "", garment: b.garment ?? "Dress", occasion: b.occasion ?? "" });
    } else {
      setDraftId(newId()); setCreatedAt(undefined); setTitle(b.title); setObservations([]); setQuestions([]); setProvider(null);
      setSummary(""); setMissing([]); setDifferences([]); setGeneratedFrom(null); setBaseline(null); setPrevious(null);
      setSections(b.sections ?? generateDemoSections("Demo client direction for this garment.", "Dress", "special event", {}));
      setForm({ ...emptyForm, image: b.image, thumb: "", garment: b.title.split(" ")[0] });
    }
    setView("editor");
  };

  const titles: Record<View, string> = { overview: "Overview", upload: "Create a new brief", clarify: "Clarification", editor: "Sewing brief", briefs: "My briefs", library: "Inspiration library", settings: "Settings" };
  const status = provider === "mock" ? "Mock mode · no API key" : provider === "live" ? "Meta Model API" : "Ready";
  const navigate = (v: View) => (v === "upload" ? startNew() : setView(v));

  return <div className="app-shell"><Sidebar view={view} setView={navigate} open={menu} close={() => setMenu(false)} /><div className="main"><Header title={titles[view]} onMenu={() => setMenu(true)} status={status} />
    {view === "overview" && <Overview setView={navigate} briefs={allBriefs} openBrief={openBrief} />}
    {view === "upload" && <Upload initial={form} onAnalyzed={({ form: f, analysis, provider: p }) => {
      setForm(f); setObservations(analysis.observations); setQuestions(analysis.questions); setProvider(p); setFollowupsChecked(false);
      setSummary(analysis.summary); setMissing(analysis.missing_information); setDifferences(analysis.differences);
      setGeneratedFrom(null); setBaseline(null); setPrevious(null); setSections([]); setTitle(""); setView("clarify");
    }} />}
    {view === "clarify" && <Clarify data={form} summary={summary} missing={missing} differences={differences} hasEdits={hasEdits} observations={observations} setObservations={setObservations} questions={questions} setQuestions={setQuestions} provider={provider} followupsChecked={followupsChecked} setFollowupsChecked={setFollowupsChecked} back={() => setView("upload")} onGenerated={({ brief, provider: p, key }) => {
      const next = briefToSections(brief);
      if (sections.length > 0) setPrevious({ title, sections });
      setProvider(p); setTitle(brief.title); setSections(next); setGeneratedFrom(key); setBaseline(JSON.stringify({ title: brief.title, sections: next })); setView("editor");
    }} />}
    {view === "editor" && <Editor data={form} title={title} setTitle={setTitle} sections={sections} setSections={setSections} provider={provider} save={() => persist()} back={() => setView(observations.length ? "clarify" : "upload")} ready={() => { const out = persist("Ready"); if (out.ok) setView("briefs"); return out; }} stale={stale} hasPrevious={previous !== null} restore={() => { if (previous) { setTitle(previous.title); setSections(previous.sections); setPrevious(null); } }} />}
    {view === "briefs" && <div className="page"><div className="section-head"><div><p className="eyebrow">Archive and active work</p><h2>My briefs</h2></div><button className="primary" onClick={startNew}><Plus /> New brief</button></div><div className="filters">{(["All", "Draft", "Needs clarification", "Ready"] as const).map((f) => <button className={filter === f ? "active" : ""} onClick={() => setFilter(f)} key={f}>{f}</button>)}</div><BriefRows briefs={allBriefs.filter((b) => filter === "All" || b.status === filter)} openBrief={openBrief} /></div>}
    {view === "library" && <div className="page empty"><Archive /><p className="eyebrow">Inspiration library</p><h2>Your references, organized.</h2><p>Images you add to user-created briefs will appear here. Demo references are kept separate.</p><button className="primary" onClick={startNew}><Plus /> Add your first reference</button></div>}
    {view === "settings" && <Settings />}
  </div></div>;
}

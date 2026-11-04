"use client";

import { useEffect, useState } from "react";
import { Archive, Plus } from "lucide-react";
import { BriefRows, Header, Sidebar } from "@/components/shell";
import { Overview } from "@/components/views/overview";
import { Upload } from "@/components/views/upload";
import { Clarify } from "@/components/views/clarify";
import { Editor } from "@/components/views/editor";
import { Settings } from "@/components/views/settings";
import { formatUpdated, statusLabel } from "@/lib/brief";
import { answersKey, isAnswered } from "@/lib/clarify";
import {
  analysisKey,
  applyReanalysis,
  autoRequested,
  garmentChoice,
  garmentLabelFor,
  NOT_SURE,
  requestedForOther,
  type ReviewNote,
} from "@/lib/upload-flow";
import { demoBriefs, generateDemoSections } from "@/lib/data";
import { loadDrafts, saveDraft, type SaveOutcome } from "@/lib/storage";
import type {
  BriefForm,
  BriefStatus,
  DetectedGarment,
  Difference,
  Observation,
  Provider,
  Question,
  SavedBrief,
  Section,
  View,
} from "@/lib/types";

const emptyForm: BriefForm = {
  image: "",
  thumb: "",
  imageHash: "",
  imageSource: "original",
  description: "",
  garment: NOT_SURE,
  occasion: "",
};
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `d-${Date.now().toString(36)}`;

export function StitchBriefApp() {
  const [view, setView] = useState<View>("overview");
  const [menu, setMenu] = useState(false);
  const [form, setForm] = useState<BriefForm>(emptyForm);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [summary, setSummary] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [differences, setDifferences] = useState<Difference[]>([]);
  const [garments, setGarments] = useState<DetectedGarment[]>([]);
  const [reviewNotes, setReviewNotes] = useState<ReviewNote[]>([]);
  const [requested, setRequested] = useState<string[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [analyzedKey, setAnalyzedKey] = useState("");
  const [followupsChecked, setFollowupsChecked] = useState(false);
  const [generatedFrom, setGeneratedFrom] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [previous, setPrevious] = useState<{
    title: string;
    sections: Section[];
  } | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [title, setTitle] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [saved, setSaved] = useState<SavedBrief[]>([]);
  const [draftId, setDraftId] = useState(newId);
  const [createdAt, setCreatedAt] = useState<string | undefined>();
  const [filter, setFilter] = useState<BriefStatus | "All">("All");

  useEffect(() => {
    setSaved(loadDrafts());
  }, []);
  const allBriefs = [...saved, ...demoBriefs];
  // Which visible garment(s) the brief is for. A photo with two garments is never assumed to be a two-piece outfit.
  const choice =
    requested === null && garments.length > 0
      ? garmentChoice(form.garment, garments)
      : null;
  // A brief is stale when the inputs it was generated from have changed since.
  const stale =
    sections.length > 0 &&
    generatedFrom !== null &&
    generatedFrom !==
      answersKey(questions, observations, differences, requested);
  // Unknown baseline (reopened draft) counts as "may contain edits" so we always confirm before overwriting.
  const hasEdits =
    sections.length > 0 &&
    (baseline === null || baseline !== JSON.stringify({ title, sections }));

  const persist = (status?: BriefStatus): SaveOutcome => {
    const now = new Date().toISOString();
    const open = questions.some((q) => !isAnswered(q) || q.skipped);
    const brief: SavedBrief = {
      id: draftId,
      title: title || `${form.garment} for ${form.occasion || "client"}`,
      updated: formatUpdated(now),
      status: status ?? (open ? "Needs clarification" : "Draft"),
      image: form.thumb || form.image,
      sections,
      createdAt: createdAt ?? now,
      updatedAt: now,
      description: form.description,
      garment: form.garment,
      occasion: form.occasion,
      observations,
      questions,
      provider: provider ?? undefined,
      summary,
      missing,
      differences,
      generatedFrom: generatedFrom ?? undefined,
      imageHash: form.imageHash,
      garments,
      requested,
      warnings,
    };
    const out = saveDraft(brief);
    if (out.ok) {
      setCreatedAt(brief.createdAt);
      setSaved(loadDrafts());
    }
    return out;
  };

  const startNew = () => {
    setForm(emptyForm);
    setObservations([]);
    setQuestions([]);
    setSections([]);
    setTitle("");
    setSummary("");
    setMissing([]);
    setDifferences([]);
    setGeneratedFrom(null);
    setBaseline(null);
    setPrevious(null);
    setGarments([]);
    setReviewNotes([]);
    setRequested(null);
    setWarnings([]);
    setAnalyzedKey("");
    setProvider(null);
    setFollowupsChecked(false);
    setDraftId(newId());
    setCreatedAt(undefined);
    setView("upload");
  };

  const openBrief = (b: SavedBrief) => {
    if (b.observations && b.questions && b.sections) {
      setDraftId(b.id);
      setCreatedAt(b.createdAt);
      setTitle(b.title);
      setSections(b.sections);
      setObservations(b.observations);
      setQuestions(b.questions);
      setFollowupsChecked(true);
      setProvider(b.provider ?? null);
      setSummary(b.summary ?? "");
      setMissing(b.missing ?? []);
      setDifferences(b.differences ?? []);
      setGeneratedFrom(b.generatedFrom ?? null);
      setBaseline(null);
      setPrevious(null);
      setGarments(b.garments ?? []);
      setReviewNotes([]);
      setWarnings(b.warnings ?? []);
      setRequested(
        b.requested !== undefined
          ? b.requested
          : autoRequested(b.garment ?? "", b.garments ?? []),
      );
      setForm({
        image: b.image,
        thumb: b.image,
        imageHash: b.imageHash ?? "",
        imageSource: "preview",
        description: b.description ?? "",
        garment: b.garment ?? "Dress",
        occasion: b.occasion ?? "",
      });
      setAnalyzedKey(
        analysisKey({
          imageHash: b.imageHash ?? "",
          description: (b.description ?? "").trim(),
          occasion: b.occasion ?? "",
        }),
      );
    } else {
      setDraftId(newId());
      setCreatedAt(undefined);
      setTitle(b.title);
      setObservations([]);
      setQuestions([]);
      setProvider(null);
      setSummary("");
      setMissing([]);
      setDifferences([]);
      setGeneratedFrom(null);
      setBaseline(null);
      setPrevious(null);
      setSections(
        b.sections ??
          generateDemoSections(
            "Demo client direction for this garment.",
            "Dress",
            "special event",
            {},
          ),
      );
      setGarments([]);
      setReviewNotes([]);
      setRequested(null);
      setWarnings([]);
      setAnalyzedKey("");
      setForm({
        ...emptyForm,
        image: b.image,
        imageSource: "preview",
        garment: b.title.split(" ")[0],
      });
    }
    setView("editor");
  };

  const titles: Record<View, string> = {
    overview: "Overview",
    upload: "Create a new brief",
    clarify: "Clarification",
    editor: "Sewing brief",
    briefs: "My briefs",
    library: "Inspiration library",
    settings: "Settings",
  };

  const status =
    provider === "mock"
      ? "Mock mode · no API key"
      : provider === "live"
        ? "Meta Model API"
        : "Ready";
  const navigate = (v: View) => (v === "upload" ? startNew() : setView(v));

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        setView={navigate}
        open={menu}
        close={() => setMenu(false)}
      />
      <div className="main">
        <Header
          title={titles[view]}
          onMenu={() => setMenu(true)}
          status={status}
        />
        {view === "overview" && (
          <Overview
            setView={navigate}
            briefs={allBriefs}
            openBrief={openBrief}
          />
        )}
        {view === "upload" && (
          <Upload
            initial={form}
            analyzedKey={analyzedKey}
            hasBrief={sections.length > 0}
            onContinue={({ garment }) => {
              if (garment !== form.garment)
                setRequested(autoRequested(garment, garments));
              setForm({ ...form, garment });
              setView("clarify");
            }}
            onAnalyzed={({ form: f, analysis, provider: p }) => {
              // New image or request: image observations are never carried over. Earlier answers survive but must be re-confirmed.
              const hadAnalysis = observations.length > 0;
              const carried = hadAnalysis
                ? applyReanalysis({
                    prevQuestions: questions,
                    prevObservations: observations,
                    nextQuestions: analysis.questions,
                    nextObservations: analysis.observations,
                  })
                : {
                    questions: analysis.questions,
                    reviewNotes: [] as ReviewNote[],
                  };
              // Which garment is the brief for? Decided automatically only when the photo and the selection agree; otherwise the designer is asked.
              const auto = autoRequested(f.garment, analysis.garments);
              setForm(
                f.garment === NOT_SURE && auto
                  ? {
                      ...f,
                      garment: garmentLabelFor(
                        analysis.garments.filter((g) => auto.includes(g.name)),
                      ),
                    }
                  : f,
              );
              setRequested(auto);
              setObservations(analysis.observations);
              setQuestions(carried.questions);
              setReviewNotes(carried.reviewNotes);
              setGarments(analysis.garments);
              setProvider(p);
              setFollowupsChecked(false);
              setWarnings([]);
              setAnalyzedKey(
                analysisKey({
                  imageHash: f.imageHash,
                  description: f.description,
                  occasion: f.occasion,
                }),
              );
              setSummary(analysis.summary);
              setMissing(analysis.missing_information);
              setDifferences(analysis.differences);
              setGeneratedFrom(null);
              setBaseline(null);
              setPrevious(null);
              setSections([]);
              setTitle("");
              setView("clarify");
            }}
          />
        )}
        {view === "clarify" && (
          <Clarify
            data={form}
            garments={garments}
            requested={requested}
            choice={choice}
            reviewNotes={reviewNotes}
            dismissNotes={() => setReviewNotes([])}
            onChoose={(pieces) => {
              setRequested(pieces);
              setForm({
                ...form,
                garment: garmentLabelFor(
                  garments.filter((g) => pieces.includes(g.name)),
                ),
              });
            }}
            onChooseOther={(garment) => {
              setRequested(requestedForOther(garment, garments));
              setForm({ ...form, garment });
            }}
            summary={summary}
            missing={missing}
            differences={differences}
            hasEdits={hasEdits}
            observations={observations}
            setObservations={setObservations}
            questions={questions}
            setQuestions={setQuestions}
            provider={provider}
            followupsChecked={followupsChecked}
            setFollowupsChecked={setFollowupsChecked}
            back={() => setView("upload")}
            onGenerated={({
              title: t,
              sections: next,
              warnings: w,
              provider: p,
              key,
            }) => {
              if (sections.length > 0) setPrevious({ title, sections });
              setProvider(p);
              setTitle(t);
              setSections(next);
              setWarnings(w);
              setGeneratedFrom(key);
              setBaseline(JSON.stringify({ title: t, sections: next }));
              setView("editor");
            }}
          />
        )}
        {view === "editor" && (
          <Editor
            data={form}
            title={title}
            setTitle={setTitle}
            sections={sections}
            setSections={setSections}
            warnings={warnings}
            provider={provider}
            save={() => persist()}
            back={() => setView(observations.length ? "clarify" : "upload")}
            ready={() => {
              const out = persist("Ready");
              if (out.ok) setView("briefs");
              return out;
            }}
            stale={stale}
            hasPrevious={previous !== null}
            restore={() => {
              if (previous) {
                setTitle(previous.title);
                setSections(previous.sections);
                setPrevious(null);
              }
            }}
          />
        )}
        {view === "briefs" && (
          <div className="page">
            <div className="section-head">
              <div>
                <p className="eyebrow">Archive and active work</p>
                <h2>My briefs</h2>
              </div>
              <button className="primary" onClick={startNew}>
                <Plus /> New brief
              </button>
            </div>
            <div className="filters">
              {(["All", "Draft", "Needs clarification", "Ready"] as const).map(
                (f) => (
                  <button
                    className={filter === f ? "active" : ""}
                    onClick={() => setFilter(f)}
                    key={f}
                  >
                    {f === "All" ? f : statusLabel(f)}
                  </button>
                ),
              )}
            </div>
            <BriefRows
              briefs={allBriefs.filter(
                (b) => filter === "All" || b.status === filter,
              )}
              openBrief={openBrief}
            />
          </div>
        )}

        {view === "settings" && <Settings />}
      </div>
    </div>
  );
}

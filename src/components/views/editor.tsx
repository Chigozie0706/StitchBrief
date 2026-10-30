"use client";

import { useState } from "react";
import { ArrowLeft, Check, Clipboard, Printer, Save } from "lucide-react";
import { briefToMarkdown, briefToText } from "@/lib/brief";
import type { SaveOutcome } from "@/lib/storage";
import type { BriefForm, Provider, Section } from "@/lib/types";
import { MockNotice } from "./clarify";

export function Editor({ data, title, setTitle, sections, setSections, provider, save, back, ready, stale, hasPrevious, restore }: {
  data: BriefForm; title: string; setTitle: (t: string) => void; sections: Section[]; setSections: (s: Section[]) => void;
  provider: Provider | null; save: () => SaveOutcome; back: () => void; ready: () => SaveOutcome;
  stale: boolean; hasPrevious: boolean; restore: () => void;
}) {
  const [dirty, setDirty] = useState(true);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const report = (out: SaveOutcome) => {
    if (!out.ok) { setMessage(out.error ?? "Could not save this draft."); return false; }
    setDirty(false);
    setMessage(out.imageStored || !data.thumb ? "" : "Saved without the reference image because browser storage is limited. Keep the original file.");
    return true;
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(briefToText(title, sections)); setCopied(true); setTimeout(() => setCopied(false), 1400); }
    catch { setMessage("Copy was blocked by the browser. Use Export instead."); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([briefToMarkdown(title, sections)], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${(title || "sewing-brief").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sewing-brief"}.md`;
    a.click(); URL.revokeObjectURL(url);
  };
  return <div className="page editor-page">
    <div className="editor-toolbar"><button className="text-button" onClick={back}><ArrowLeft /> Back to clarification</button><div className="editor-actions"><span className={dirty ? "unsaved" : "saved"}><i />{dirty ? "Unsaved changes" : "Saved locally"}</span><button className="secondary" onClick={copy}><Clipboard />{copied ? "Copied" : "Copy brief"}</button><button className="secondary" onClick={download}>Download .md</button><button className="secondary" onClick={() => window.print()}><Printer /> Print</button><button className="primary" onClick={() => report(save())}><Save /> Save draft</button></div></div>
    <MockNotice provider={provider} />
    {stale && <div className="notice stale-notice" role="status"><p><strong>This brief may be out of date.</strong><br />Answers or observations changed after it was generated. Review them, then generate again.</p><button className="secondary" onClick={back}>Back to clarification</button></div>}
    {hasPrevious && <div className="notice" role="status"><p><strong>New version generated.</strong><br />Your earlier version is still available for this session.</p><button className="secondary" onClick={() => { restore(); setDirty(true); }}>Restore previous version</button></div>}
    {message && <div className="notice" role="status"><p>{message}</p></div>}
    <div className="editor-grid">
      <main className="document"><div className="doc-kicker">Sewing brief · Draft</div><input className="doc-title" aria-label="Brief title" value={title} onChange={(e) => { setDirty(true); setTitle(e.target.value); }} />
        <div className="doc-meta"><span>Prepared in StitchBrief</span><span>{new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span></div>
        {sections.map((section, i) => <section className="doc-section" key={section.title}><span>{String(i + 1).padStart(2, "0")}</span><div><h3>{section.title}</h3><textarea aria-label={section.title} value={section.body} onChange={(e) => { setDirty(true); setSections(sections.map((s, n) => n === i ? { ...s, body: e.target.value } : s)); }} /></div></section>)}
        <div className="disclaimer"><strong>Planning note</strong>This brief records visual observations, client requirements, and stated suggestions. It is not a sewing pattern and does not replace professional pattern drafting, fitting, or measurement taking.</div>
      </main>
      <aside className="context">{data.image && <img src={data.image} alt="Reference garment" />}<p className="eyebrow">Reference context</p><h3>{data.garment}</h3><p>{data.description}</p><hr /><strong>Source key</strong><ul><li><i className="dot observed" />Observed from image</li><li><i className="dot confirmed" />Confirmed by client</li><li><i className="dot suggested" />Suggested by AI</li><li><i className="dot unknown" />Still unanswered</li></ul><button className="primary full" onClick={() => { if (report(ready())) { /* app navigates */ } }}><Check /> Mark as ready</button></aside>
    </div>
  </div>;
}

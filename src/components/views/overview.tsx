import { ArrowRight, Sparkles } from "lucide-react";
import { BriefRows } from "@/components/shell";
import { sampleImage } from "@/lib/data";
import type { SavedBrief, View } from "@/lib/types";

export function Overview({ setView, briefs, openBrief }: { setView: (v: View) => void; briefs: SavedBrief[]; openBrief: (b: SavedBrief) => void }) {
  return <div className="page">
    <section className="hero">
      <div><p className="eyebrow">A clearer start to every commission</p><h2>From inspiration to a brief<br />you can sew from.</h2><p>Turn reference images and client notes into an organized, editable garment brief—without filling in what the image can’t tell you.</p><button className="primary" onClick={() => setView("upload")}>Create a new brief <ArrowRight /></button></div>
      <div className="hero-image"><img src={sampleImage} alt="Model wearing a burgundy evening dress" /><div><Sparkles /><span>Visual notes</span><strong>Bias-cut silhouette<br />Full length · Burgundy</strong></div></div>
    </section>
    <section className="section-head"><div><p className="eyebrow">Your workspace</p><h3>Recent briefs</h3></div><button className="text-button" onClick={() => setView("briefs")}>View all <ArrowRight /></button></section>
    <BriefRows briefs={briefs.slice(0, 3)} openBrief={openBrief} />
  </div>;
}

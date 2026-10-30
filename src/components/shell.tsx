import { ArrowRight, FileText, Image, LayoutGrid, Menu, Plus, Settings, X } from "lucide-react";
import type { BriefStatus, SavedBrief, View } from "@/lib/types";

export function Status({ children }: { children: BriefStatus }) {
  return <span className={`status status-${children.toLowerCase().replace(" ", "-")}`}><span />{children}</span>;
}

export function Sidebar({ view, setView, open, close }: { view: View; setView: (v: View) => void; open: boolean; close: () => void }) {
  const nav = [
    ["overview", LayoutGrid, "Overview"],
    ["briefs", FileText, "My briefs"],
    ["library", Image, "Inspiration library"],
    ["settings", Settings, "Settings"],
  ] as const;
  return (
    <>
      {open && <div className="scrim" onClick={close} />}
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand"><span className="brandmark">S</span><span>StitchBrief</span><button className="icon mobile-only" onClick={close} aria-label="Close menu"><X /></button></div>
        <button className="primary new-button" onClick={() => { setView("upload"); close(); }}><Plus /> New brief</button>
        <nav>
          {nav.map(([id, Icon, label]) => <button key={id} className={view === id ? "nav-active" : ""} onClick={() => { setView(id); close(); }}><Icon />{label}</button>)}
        </nav>
        <div className="profile"><span>AM</span><div><strong>Amara Mensah</strong><small>Independent studio</small></div></div>
      </aside>
    </>
  );
}

export function Header({ title, onMenu, status }: { title: string; onMenu: () => void; status: string }) {
  return <header className="topbar"><button className="icon mobile-only" onClick={onMenu} aria-label="Open menu"><Menu /></button><div><p className="eyebrow">StitchBrief workspace</p><h1>{title}</h1></div><div className="prototype"><span /> {status}</div></header>;
}

export function BriefRows({ briefs, openBrief }: { briefs: SavedBrief[]; openBrief: (b: SavedBrief) => void }) {
  return <div className="brief-list">{briefs.map((b) => <article className="brief-row" key={b.id}>
    {b.image ? <img src={b.image} alt="" /> : <span className="thumb-empty" aria-hidden />}<div className="brief-name"><strong>{b.title}</strong><span>{b.id.startsWith("demo") ? "Demo brief" : b.provider === "mock" ? "Your brief · mock data" : "Your brief"}</span></div>
    <span className="updated">{b.updated}</span><Status>{b.status}</Status><button className="secondary small" onClick={() => openBrief(b)}>Open <ArrowRight /></button>
  </article>)}</div>;
}

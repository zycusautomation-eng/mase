"use client";
import { useEffect, useRef, useState } from "react";

export type Opt = { value: string; label: string };

// Checkbox dropdown. Empty selection renders as `allLabel` and means "all".
export default function MultiSelect({
  allLabel, options, selected, onChange, single = false,
}: { allLabel: string; options: Opt[]; selected: string[]; onChange: (v: string[]) => void; single?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  useEffect(() => { if (!open) setQ(""); }, [open]);

  const searchable = options.length > 10;
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;

  const labelFor = (v: string) => options.find((o) => o.value === v)?.label || v;
  const toggle = (v: string) => {
    if (single) { onChange(selected.includes(v) ? [] : [v]); setOpen(false); return; }
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };
  const summary = selected.length === 0
    ? allLabel
    : selected.length <= 2
      ? selected.map(labelFor).join(", ")
      : `${selected.length} selected`;

  return (
    <div className={`msel ${open ? "open" : ""}`} ref={ref}>
      <button type="button" className="msel-btn" onClick={() => setOpen((o) => !o)} title={summary}>
        {summary}
      </button>
      {open ? (
        <div className="msel-menu">
          {searchable ? (
            <input className="msel-search" autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          ) : null}
          {selected.length > 0 ? (
            <button type="button" className="msel-opt clearrow" onClick={() => { onChange([]); if (single) setOpen(false); }}>Clear · {allLabel}</button>
          ) : null}
          {shown.length === 0 ? (
            <div className="msel-opt msel-none">{q ? "No matches" : "Nothing in scope"}</div>
          ) : shown.map((o) => (
            <label className="msel-opt" key={o.value}>
              <input type={single ? "radio" : "checkbox"} checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

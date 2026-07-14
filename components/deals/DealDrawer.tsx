"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Slide-in deal drawer (Deals list quick-look). Fetches the full record and renders
// the SAME shared DealDrawerView as the /deals/[id] page (hero + tabs + content), so
// the drawer and the full page are identical — just narrower (single-column grid).
//
// Rendered into a PORTAL on <body> so the fixed overlay + panel can never be trapped by
// an ancestor's stacking context / overflow / transform — the dimmed, blurred backdrop
// reliably covers the viewport and a click on it (or Escape) always closes the drawer.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { type Rec } from "@/lib/engine/helpers";
import { getCachedDeal, refetchDeal } from "@/lib/engine/dealCache";
import DealDrawerView from "@/components/deals/DealDrawerView";

export default function DealDrawer({
  record, onClose,
}: { record: Rec | null; records: Rec[]; playbook: any; onClose: () => void }) {
  const open = !!record;
  // Loaded SLIM for fast paint; fetch the FULL record by opp_id on open (same as the page).
  const [full, setFull] = useState<Rec | null>(null);
  // Portal target only exists after mount (client) — guard against SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const oid = record?.opp_id;
    if (!oid) { setFull(null); return; }
    // Instant paint: if the full record is already cached (row was hovered, or the deal was
    // opened before), show it synchronously — no blank-detail wait. Otherwise fall back to
    // the slim record while we fetch.
    setFull(getCachedDeal(oid));
    let off = false;
    const pull = () => { refetchDeal(oid)?.then((rec) => { if (!off && rec) setFull(rec); }); };
    // Always fetch FRESH on open (ignore the cache TTL) so the drawer shows the latest — not a
    // stale copy from a hover 4 minutes ago.
    pull();
    // Keep it LIVE while open: re-pull on the same ~20s cadence as the book poll, so a re-sweep
    // / CDC update surfaces in the open drawer — including the Scores & reasons modal — with no
    // reopen. Paused while the tab is hidden (no background churn).
    const poll = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      pull();
    }, 20000);
    return () => { off = true; clearInterval(poll); };
  }, [record?.opp_id]);

  // Close on Escape whenever the drawer is open (belt-and-suspenders alongside the backdrop click).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const rec: Rec | null = full || record;
  if (!mounted) return null;

  return createPortal(
    <>
      <div className={`overlay ${open ? "open" : ""}`} onClick={onClose} aria-hidden />
      <aside className={`drawer ${open ? "open" : ""}`} role="dialog" aria-modal="true">
        {rec ? <DealDrawerView rec={rec} onClose={onClose} /> : null}
      </aside>
    </>,
    document.body
  );
}

"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Slide-in deal drawer (Deals list quick-look). Fetches the full record and renders
// the SAME shared DealDetailView as the /deals/[id] page (hero + tabs + content), so
// the drawer and the full page are identical — just narrower (single-column grid).
import { useEffect, useState } from "react";
import { type Rec } from "@/lib/engine/helpers";
import DealDetailView from "@/components/deals/DealDetailView";

export default function DealDrawer({
  record, onClose,
}: { record: Rec | null; records: Rec[]; playbook: any; onClose: () => void }) {
  const open = !!record;
  // Loaded SLIM for fast paint; fetch the FULL record by opp_id on open (same as the page).
  const [full, setFull] = useState<Rec | null>(null);
  useEffect(() => {
    const oid = record?.opp_id;
    if (!oid) { setFull(null); return; }
    setFull(null);
    let off = false;
    (async () => {
      try {
        const r = await fetch(`/api/deal-engine/opportunities/${encodeURIComponent(oid)}`, { cache: "no-store" });
        const j = await r.json();
        if (!off && r.ok) setFull(j.record || j);
      } catch { /* keep the slim record */ }
    })();
    return () => { off = true; };
  }, [record?.opp_id]);
  const rec: Rec | null = full || record;

  return (
    <>
      <div className={`overlay ${open ? "open" : ""}`} onClick={onClose} />
      <aside className={`drawer ${open ? "open" : ""}`}>
        {rec ? (
          <div className="dp-drawerbody">
            <DealDetailView rec={rec} variant="drawer" onClose={onClose} />
          </div>
        ) : null}
      </aside>
    </>
  );
}

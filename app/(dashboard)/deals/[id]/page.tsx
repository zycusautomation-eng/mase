"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Full-page deal detail (/deals/[id]). Fetches the full record and renders the shared
// DealDetailView (the same hero + tabs + content the DealDrawer shows).
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { type Rec } from "@/lib/engine/helpers";
import DealDetailView from "@/components/deals/DealDetailView";

export default function DealDetailPage() {
  const params = useParams();
  const oid = decodeURIComponent(String((params as any)?.id || ""));
  const { records, loading } = useDashboard();

  const slim = useMemo(
    () => records.find((r) => String(r.opp_id) === oid || String(r.opp_id).slice(0, 15) === oid.slice(0, 15)) || null,
    [records, oid],
  );
  const [full, setFull] = useState<Rec | null>(null);
  useEffect(() => {
    if (!oid) return;
    setFull(null);
    let off = false;
    (async () => {
      try {
        const r = await fetch(`/api/deal-engine/opportunities/${encodeURIComponent(oid)}`, { cache: "no-store" });
        const j = await r.json();
        if (!off && r.ok) setFull(j.record || j);
      } catch { /* keep slim */ }
    })();
    return () => { off = true; };
  }, [oid]);
  const rec: Rec | null = full || slim;

  if (!rec) {
    return (
      <div className="empty">
        {loading ? "Loading deal…" : "Deal not found."}{" "}
        <Link href="/deals" style={{ color: "var(--accent)" }}>← Back to Deals</Link>
      </div>
    );
  }

  return (
    <div className="dp-wrap">
      <DealDetailView rec={rec} variant="page" />
    </div>
  );
}

"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Deal Drawer host. Lives in the persistent deals/layout.tsx so it opens OVER the still-
// mounted deals table. The OPEN deal now comes from the layout's drawer controller
// (useDealDrawer) — set instantly on row click from the slim record we already hold, so the
// panel appears on the next frame instead of waiting on an RSC navigation. The controller
// also mirrors the URL (/deals/<id>), so shareable links, refresh, and back/forward still work.
import { useMemo } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { useDealDrawer } from "@/components/deals/DrawerController";
import { type Rec } from "@/lib/engine/helpers";
import DealDrawer from "@/components/deals/DealDrawer";

export default function UrlDealDrawer() {
  const { openId, close } = useDealDrawer();
  const { records, playbook } = useDashboard();
  const oid = openId;

  // Prefer the slim record from the book (fast first paint); DealDrawer fetches the full
  // record by opp_id itself (from the hover-warmed cache, usually instant). If the book
  // hasn't loaded that id yet, seed a stub so the drawer still opens and the fetch fills it in.
  const slim = useMemo<Rec | null>(() => {
    if (!oid) return null;
    return (
      records.find((r) => String(r.opp_id) === oid || String(r.opp_id).slice(0, 15) === oid.slice(0, 15))
      || ({ opp_id: oid } as unknown as Rec)
    );
  }, [records, oid]);

  return (
    <DealDrawer
      record={slim}
      records={records}
      playbook={playbook}
      onClose={close}
    />
  );
}

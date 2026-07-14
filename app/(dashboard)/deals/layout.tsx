"use client";
// Persistent Deals layout + drawer controller.
//
// The open deal is tracked in the ?deal=<id> QUERY PARAM, not a route change. Opening a deal:
//   1. sets local openId INSTANTLY → the drawer renders on the next frame from the slim record
//      we already hold in memory (no RSC round-trip, no /deals/<id> segment swap), and
//   2. updates the URL to /deals?deal=<id> so the open deal is visible + shareable and the
//      browser back button closes it.
// A search-param change stays on the SAME /deals segment (the page reads nothing from it), so
// it's a light soft-navigation — far cheaper than the old segment change that mounted the
// /deals/[id] route + its own layout. useSearchParams is the source of truth, so direct loads
// (/deals?deal=<id>), back/forward, and old /deals/<id> links (which redirect here) all work.
import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DealsBoard from "@/components/deals/DealsBoard";
import UrlDealDrawer from "@/components/deals/UrlDealDrawer";
import { DrawerCtx } from "@/components/deals/DrawerController";

function DealsController({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlDeal = searchParams.get("deal");
  const [openId, setOpenId] = useState<string | null>(urlDeal);

  // Keep the drawer in sync with the URL: direct load / refresh, browser back/forward, and
  // old /deals/<id> links that redirect to ?deal=<id>.
  useEffect(() => { setOpenId(urlDeal); }, [urlDeal]);

  const open = useCallback((id: string) => {
    if (!id) return;
    setOpenId(id);                                   // INSTANT: drawer renders next frame
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("deal", id);
    router.push(`/deals?${sp.toString()}`, { scroll: false }); // URL catches up (shareable)
  }, [router, searchParams]);

  const close = useCallback(() => {
    setOpenId(null);                                 // INSTANT close
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("deal");
    const qs = sp.toString();
    router.push(qs ? `/deals?${qs}` : "/deals", { scroll: false }); // back to /deals
  }, [router, searchParams]);

  return (
    <DrawerCtx.Provider value={{ openId, open, close }}>
      <DealsBoard />
      {children}
      <UrlDealDrawer />
    </DrawerCtx.Provider>
  );
}

export default function DealsLayout({ children }: { children: React.ReactNode }) {
  // useSearchParams must sit under a Suspense boundary (Next build requirement). It resolves
  // synchronously on the client, so this fallback is effectively never shown at runtime.
  return (
    <Suspense fallback={null}>
      <DealsController>{children}</DealsController>
    </Suspense>
  );
}

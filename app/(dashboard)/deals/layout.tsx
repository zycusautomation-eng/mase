"use client";
// Persistent Deals layout. The board (table) and the deal drawer live HERE so they stay
// mounted across /deals and /deals/<id> — the table keeps its scroll + page while the drawer
// opens over it.
//
// SNAPPY OPEN: the drawer open/close state lives in local React state (this controller), NOT
// in a route navigation. Clicking a row opens the drawer on the NEXT FRAME from the slim
// record we already hold in memory — no waiting on an RSC round-trip (which is what made the
// drawer feel slow, especially in dev). The URL is still updated (router.push) so /deals/<id>
// stays a shareable link and back/forward work — but that happens in the background and never
// blocks the panel from appearing. A useEffect keeps local state in sync with the URL, so a
// direct load of /deals/<id>, the back button, or any external navigation still open/close it.
import { useState, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import DealsBoard from "@/components/deals/DealsBoard";
import UrlDealDrawer from "@/components/deals/UrlDealDrawer";
import { DrawerCtx } from "@/components/deals/DrawerController";

function idFromPath(pathname: string | null): string | null {
  const m = /^\/deals\/([^/]+)\/?$/.exec(pathname || "");
  return m ? decodeURIComponent(m[1]) : null;
}

export default function DealsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const urlId = idFromPath(pathname);
  const [openId, setOpenId] = useState<string | null>(urlId);

  // Keep the drawer in sync with the URL for the cases the click handler doesn't drive:
  // direct load of /deals/<id>, browser back/forward, or any programmatic navigation.
  useEffect(() => { setOpenId(urlId); }, [urlId]);

  const open = useCallback((id: string) => {
    if (!id) return;
    setOpenId(id);                                   // INSTANT: drawer renders next frame
    router.push(`/deals/${encodeURIComponent(id)}`); // URL catches up (shareable) — non-blocking
  }, [router]);

  const close = useCallback(() => {
    setOpenId(null);                                 // INSTANT close
    router.push("/deals");
  }, [router]);

  return (
    <DrawerCtx.Provider value={{ openId, open, close }}>
      <DealsBoard />
      {children}
      <UrlDealDrawer />
    </DrawerCtx.Provider>
  );
}

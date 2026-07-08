"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import "./dashboard.css";
import "../tailwind.css"; // global so the deal AI dock/panel (Tailwind UI) render on every page
import { DashboardProvider, useDashboard } from "@/lib/engine/DashboardContext";
import ScopeFilterBar from "@/components/ScopeFilterBar";
import AppSidebar from "@/components/AppSidebar";
import TopNav from "@/components/TopNav";
import DealsStats from "@/components/deals/DealsStats";
import { DealAiProvider } from "@/components/deals/DealAiProvider";
import { AgentRunProvider } from "@/components/agent/AgentRun";
import { SfdcProvider } from "@/components/sfdc/SfdcProvider";
import { AccountLogosProvider } from "@/lib/engine/AccountLogosProvider";
import { PageLoader } from "@/components/ui/page-loader";

function Shell({ children }: { children: React.ReactNode }) {
  const { loading, error, blocked } = useDashboard();
  const pathname = usePathname();
  const onDealDetail = /^\/deals\/[^/]+$/.test(pathname); // /deals/<id> — full-page detail
  const onDealsList = pathname === "/deals"; // the deals book (stat cards live here)
  // The scope + deal filters belong only to the deal-book views (not the detail page).
  const showScope = !pathname.startsWith("/chat") && !pathname.startsWith("/sync-quality")
    && !pathname.startsWith("/admin") && !pathname.startsWith("/omnivision") && !onDealDetail;
  const onEspresso = pathname.startsWith("/espresso");
  const onChat = pathname.startsWith("/chat");
  // Per-tab accent hue: warm/coffee on Espresso, green on Matcha (bg stays white).
  const onMatcha = pathname.startsWith("/matcha");
  const tabTheme = onEspresso ? "theme-espresso" : onMatcha ? "theme-matcha" : "";
  // The book loader matches the active tab accent (coffee / green / blue).
  const loaderTone = onEspresso ? "espresso" : onMatcha ? "matcha" : "blue";

  // Sticky offsets for the deal views. There is no global header anymore, so
  // --hdr-h is 0 (the espresso filter/tier bars read it and now pin to the top).
  useEffect(() => {
    const root = document.documentElement;
    const measure = () => {
      root.style.setProperty("--hdr-h", "0px");
      root.style.setProperty("--nav-h", (document.querySelector<HTMLElement>(".mase-nav")?.offsetHeight || 62) + "px");
      root.style.setProperty("--fb-h", (document.querySelector<HTMLElement>(".filterbar")?.offsetHeight || 0) + "px");
      root.style.setProperty("--sim-h", (document.querySelector<HTMLElement>(".simbar")?.offsetHeight || 0) + "px");
      // visible inner width of the deals scroll area (clientWidth excludes the vertical
      // scrollbar) − its 28px L/R padding — so the sticky-left stats/filters stay viewport-wide.
      const dw = document.querySelector<HTMLElement>(".wrap.deals-scroll");
      if (dw) root.style.setProperty("--dl-w", (dw.clientWidth - 56) + "px");
    };
    measure();
    const raf = requestAnimationFrame(measure);   // re-measure once layout has settled
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    const fb = document.querySelector(".filterbar"); if (fb) ro.observe(fb);
    const dw = document.querySelector(".wrap.deals-scroll"); if (dw) ro.observe(dw);  // width changes
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", measure); ro.disconnect(); };
  }, [pathname, loading]);

  // Chat owns its own full-screen 3-column workspace (its sidebar lives there).
  if (onChat) {
    return (
      <DealAiProvider>
        {blocked ? (
          <div className="empty">You don&apos;t have access to MASE.<br /><br /><span className="sub">This account isn&apos;t on the access list. If you believe this is a mistake, contact an admin.</span></div>
        ) : (
          <>{children}</>
        )}
      </DealAiProvider>
    );
  }

  // Every other page: global sidebar (fixed left) + a universal top navbar
  // (search + Ask AI). The deal-detail page has its own top bar, so no navbar there.
  return (
    <DealAiProvider>
      <AppSidebar />
      <div className={`mase-shell ${onDealsList ? "deals-shell" : ""} ${tabTheme}`}>
        {!onDealDetail && !blocked ? <TopNav /> : null}
        {onDealDetail ? (
          // The deal-detail page owns its own width/padding (.dp-wrap) — no .wrap
          // double-wrapper. It handles its own loading state internally.
          blocked ? (
            <div className="empty">You don&apos;t have access to MASE.<br /><br /><span className="sub">This account isn&apos;t on the access list. If you believe this is a mistake, contact an admin.</span></div>
          ) : (
            children
          )
        ) : (
          <div className={`wrap ${onDealsList ? "deals-scroll" : ""} ${onEspresso ? "esp-sticky" : ""} ${tabTheme}`}>
            {error ? (
              <div className="empty">Couldn&apos;t load the book.<br /><br /><span className="err">{error}</span></div>
            ) : loading ? (
              <PageLoader label="Loading the book…" tone={loaderTone} />
            ) : blocked ? (
              <div className="empty">You don&apos;t have access to MASE.<br /><br /><span className="sub">This account isn&apos;t on the access list. If you believe this is a mistake, contact an admin.</span></div>
            ) : (
              <>
                {onDealsList ? <DealsStats /> : null}
                {showScope ? <ScopeFilterBar /> : null}
                {children}
              </>
            )}
          </div>
        )}
      </div>
    </DealAiProvider>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <AgentRunProvider>
        <SfdcProvider>
          <AccountLogosProvider>
            <Shell>{children}</Shell>
          </AccountLogosProvider>
        </SfdcProvider>
      </AgentRunProvider>
    </DashboardProvider>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import "./dashboard.css";
import { DashboardProvider, useDashboard } from "@/lib/engine/DashboardContext";
import ScopeFilterBar from "@/components/ScopeFilterBar";
import AuthButton from "@/components/AuthButton";

const TABS = [
  { href: "/deals", label: "Deals" },
  { href: "/espresso", label: "Espresso" },
  { href: "/matcha", label: "Matcha" },
  { href: "/chat", label: "Chat" },
  { href: "/sync-quality", label: "Sync Quality" },
];

function Header() {
  const pathname = usePathname();
  const { records, scoped, locked, query, setQuery } = useDashboard();
  const shown = locked ? scoped.length : records.length;
  const onDeals = pathname.startsWith("/deals");
  // The header search is a Deals-only filter. `query` lives in the shared
  // DashboardContext and feeds `filtered`, which Matcha/Espresso also use — so a
  // leftover search would silently narrow those tabs too. Clear it whenever we
  // leave Deals so the search never leaks across routes.
  useEffect(() => {
    if (!onDeals && query) setQuery("");
  }, [onDeals, query, setQuery]);
  return (
    <header>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="brandmark-img" src="/mase-logo.svg" alt="MASE — Agents that close with you" />
      <span className="sub" id="subtitle">
        {shown ? `${shown} opportunit${shown === 1 ? "y" : "ies"} swept` : ""}
      </span>
      <div className="tabs">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={`tab ${pathname.startsWith(t.href) ? "active" : ""}`}>
            {t.label}
          </Link>
        ))}
      </div>
      <div className="spacer" />
      <input
        id="filter"
        type="text"
        name="deal-filter-no-autofill"
        placeholder="Filter account, opp, owner, stage…"
        autoComplete="off"
        spellCheck={false}
        data-lpignore="true"
        data-1p-ignore=""
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ visibility: onDeals ? "visible" : "hidden" }}
      />
      <AuthButton />
    </header>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { loading, error, blocked } = useDashboard();
  const pathname = usePathname();
  // The scope + filters don't apply to Chat (the strategist reads the whole book).
  const showScope = !pathname.startsWith("/chat") && !pathname.startsWith("/sync-quality");
  // On Espresso the filter bar + forecast ribbon are pinned while scrolling the
  // (long) to-do list. Header height varies with width, so measure it live and
  // expose --hdr-h / --fb-h for the sticky offsets.
  const onEspresso = pathname.startsWith("/espresso");
  // Chat is a full-bleed app surface (no narrow centered page wrap).
  const onChat = pathname.startsWith("/chat");
  // Per-tab accent hue: warm/coffee on Espresso, green on Matcha (bg stays white).
  const tabTheme = onEspresso ? "theme-espresso" : pathname.startsWith("/matcha") ? "theme-matcha" : "";
  useEffect(() => {
    const root = document.documentElement;
    const measure = () => {
      root.style.setProperty("--hdr-h", (document.querySelector<HTMLElement>("header")?.offsetHeight || 0) + "px");
      root.style.setProperty("--fb-h", (document.querySelector<HTMLElement>(".filterbar")?.offsetHeight || 0) + "px");
      root.style.setProperty("--sim-h", (document.querySelector<HTMLElement>(".simbar")?.offsetHeight || 0) + "px");
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    const hdr = document.querySelector("header"); if (hdr) ro.observe(hdr);
    const fb = document.querySelector(".filterbar"); if (fb) ro.observe(fb);
    const sim = document.querySelector(".simbar"); if (sim) ro.observe(sim);
    return () => { window.removeEventListener("resize", measure); ro.disconnect(); };
  }, [pathname, loading]);
  return (
    <>
      <Header />
      <div className={`wrap ${onEspresso ? "esp-sticky" : ""} ${onChat ? "chat-page" : ""} ${tabTheme}`}>
        {error ? (
          <div className="empty">Couldn&apos;t load the book.<br /><br /><span className="err">{error}</span></div>
        ) : loading ? (
          <div className="empty">Loading the book…</div>
        ) : blocked ? (
          <div className="empty">You don&apos;t have access to MASE.<br /><br /><span className="sub">This account isn&apos;t on the access list. If you believe this is a mistake, contact an admin.</span></div>
        ) : (
          <>
            {showScope ? <ScopeFilterBar /> : null}
            {children}
          </>
        )}
      </div>
    </>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <Shell>{children}</Shell>
    </DashboardProvider>
  );
}

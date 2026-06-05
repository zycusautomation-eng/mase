"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import "./dashboard.css";
import { DashboardProvider, useDashboard } from "@/lib/engine/DashboardContext";
import ScopeFilterBar from "@/components/ScopeFilterBar";

const TABS = [
  { href: "/deals", label: "Deals" },
  { href: "/espresso", label: "Espresso" },
  { href: "/matcha", label: "Matcha" },
  { href: "/chat", label: "Chat" },
];

function Header() {
  const pathname = usePathname();
  const { records, query, setQuery } = useDashboard();
  const onDeals = pathname.startsWith("/deals");
  return (
    <header>
      <h1>Deal Intelligence Engine</h1>
      <span className="sub" id="subtitle">
        {records.length ? `${records.length} opportunit${records.length === 1 ? "y" : "ies"} swept` : ""}
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
    </header>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { loading, error } = useDashboard();
  const pathname = usePathname();
  // The scope + filters don't apply to Chat (the strategist reads the whole book).
  const showScope = !pathname.startsWith("/chat");
  // On Espresso the filter bar + forecast ribbon are pinned while scrolling the
  // (long) to-do list. Header height varies with width, so measure it live and
  // expose --hdr-h / --fb-h for the sticky offsets.
  const onEspresso = pathname.startsWith("/espresso");
  useEffect(() => {
    const root = document.documentElement;
    const measure = () => {
      root.style.setProperty("--hdr-h", (document.querySelector<HTMLElement>("header")?.offsetHeight || 0) + "px");
      root.style.setProperty("--fb-h", (document.querySelector<HTMLElement>(".filterbar")?.offsetHeight || 0) + "px");
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    const hdr = document.querySelector("header"); if (hdr) ro.observe(hdr);
    const fb = document.querySelector(".filterbar"); if (fb) ro.observe(fb);
    return () => { window.removeEventListener("resize", measure); ro.disconnect(); };
  }, [pathname, loading]);
  return (
    <>
      <Header />
      <div className={`wrap ${onEspresso ? "esp-sticky" : ""}`}>
        {error ? (
          <div className="empty">Couldn&apos;t load the book.<br /><br /><span className="err">{error}</span></div>
        ) : loading ? (
          <div className="empty">Loading the book…</div>
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

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  return (
    <>
      <Header />
      <div className="wrap">
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

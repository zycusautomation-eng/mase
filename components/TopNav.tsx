"use client";
// Universal top navbar: a global search (binds to the deal-book query; ⌘K to focus,
// Enter jumps to /deals) + an "Ask AI" button that opens the deal conversation dock
// from any page. Rendered by the dashboard layout on every non-chat page.
import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { useDealAi } from "@/components/deals/DealAiProvider";

export default function TopNav() {
  const { query, setQuery } = useDashboard();
  const { openDock } = useDealAi();
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="mase-nav">
      <div className="mase-nav-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search deals, accounts, opportunities, people…"
          onKeyDown={(e) => { if (e.key === "Enter" && !pathname.startsWith("/deals")) router.push("/deals"); }}
          spellCheck={false}
          autoComplete="off"
        />
        <span className="kbd">⌘K</span>
      </div>
      <button type="button" className="mase-nav-ai" onClick={openDock} title="Ask AI — deal conversations">
        <svg viewBox="0 0 24 24" fill="currentColor" width={15} height={15} aria-hidden>
          <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z" />
        </svg>
        Ask AI
      </button>
    </div>
  );
}

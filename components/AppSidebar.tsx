"use client";
// Global left navigation sidebar — the primary nav for the whole app (replaces
// the old top header navbar). Rendered by (dashboard)/layout.tsx on every page
// EXCEPT /chat (which has its own richer sidebar). Styled with dashboard.css
// classes (.mase-side*) — NOT Tailwind — so it can't leak utility styles into
// the hand-written pages.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDashboard } from "@/lib/engine/DashboardContext";
import AuthButton from "@/components/AuthButton";
import {
  Handshake, Coffee, Leaf, MessageSquare, RefreshCw, ListChecks,
  GraduationCap, Bot, type LucideIcon,
} from "lucide-react";

// Same routes as the old header TABS. `adminOnly` mirrors the header's
// ADMIN_ONLY_TABS so non-admins only see Deals / Espresso / Matcha.
const NAV: { href: string; label: string; icon: LucideIcon; adminOnly?: boolean }[] = [
  { href: "/deals", label: "Deals", icon: Handshake },
  { href: "/espresso", label: "Espresso", icon: Coffee },
  { href: "/matcha", label: "Matcha", icon: Leaf },
  { href: "/chat", label: "Chat", icon: MessageSquare, adminOnly: true },
  { href: "/sync-quality", label: "Sync Quality", icon: RefreshCw, adminOnly: true },
  { href: "/runs", label: "Runs", icon: ListChecks, adminOnly: true },
  { href: "/learnings", label: "Learning", icon: GraduationCap, adminOnly: true },
  { href: "/admin", label: "Admin", icon: Bot, adminOnly: true },
];

export default function AppSidebar() {
  const pathname = usePathname();
  const { isAdminView, realIsAdmin, simEmail, scopeName, chatAllowed } = useDashboard();
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser()
      .then(({ data }) => setUserName((data.user?.user_metadata?.name as string) || data.user?.email || null))
      .catch(() => {});
  }, []);

  // Admin-only links are hidden for non-admins (and while an admin simulates a
  // rep/VP, isAdminView is false → they're hidden too, matching the old header).
  // EXCEPTION: Chat access is governed by the admin policy (admins / everyone /
  // allowlist) — show it whenever this user is allowed, even if not an admin.
  const items = NAV.filter((n) =>
    n.href === "/chat" ? (isAdminView || chatAllowed) : (!n.adminOnly || isAdminView)
  );
  const role = simEmail
    ? `Simulating · ${scopeName ?? ""}`.trim()
    : realIsAdmin ? "Admin" : (scopeName || "Member");
  // Match the per-route canvas (warm coffee on Espresso, green on Matcha) so the
  // sidebar tone + active-link color follow the active tab. Deals/others stay blue.
  const tabTheme = pathname.startsWith("/espresso") ? "theme-espresso"
    : pathname.startsWith("/matcha") ? "theme-matcha" : "";

  return (
    <aside className={`mase-side ${tabTheme}`}>
      <div className="mase-side-logo">
        {/* Inline so the brand gradient follows the route theme (blue on Deals,
            coffee on Espresso, green on Matcha) via the --logo-c* CSS vars. */}
        <svg viewBox="0 0 520 158" fill="none" role="img" aria-label="MASE — Agents that close with you">
          <defs>
            <linearGradient id="maseBrand" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--logo-c1)" />
              <stop offset="0.55" stopColor="var(--logo-c2)" />
              <stop offset="1" stopColor="var(--logo-c3)" />
            </linearGradient>
          </defs>
          <path d="M72,20 Q72,82 126,80 Q72,82 72,144 Q72,82 18,80 Q72,82 72,20 Z" fill="url(#maseBrand)" />
          <path d="M128,30 Q128,48 146,48 Q128,48 128,66 Q128,48 110,48 Q128,48 128,30 Z" fill="url(#maseBrand)" />
          <text x="182" y="112" fontFamily="'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif"
            fontWeight="800" fontSize="104" letterSpacing="-1" fill="url(#maseBrand)">MASE</text>
          <text x="322" y="146" textAnchor="middle" fontFamily="'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif"
            fontWeight="600" fontSize="17" letterSpacing="3" fill="#5b6b7e">AGENTS THAT CLOSE WITH YOU</text>
        </svg>
      </div>
      <nav className="mase-side-nav">
        {items.map((n) => {
          const Icon = n.icon;
          const active = pathname.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className={`mase-side-link ${active ? "active" : ""}`}>
              <Icon /> {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="mase-side-spacer" />
      <div className="mase-side-foot">
        <AuthButton />
        <div className="who">
          <div className="nm">{userName || scopeName || "Account"}</div>
          <div className="rl">{role}</div>
        </div>
      </div>
    </aside>
  );
}

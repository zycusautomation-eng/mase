"use client";
// Global left navigation sidebar — the primary nav for the whole app. Rendered by
// (dashboard)/layout.tsx on every page EXCEPT /chat (which has its own richer sidebar).
//
// Built on shadcn/ui primitives (Avatar, Separator) + Tailwind, but styled through the
// app's own design tokens (--surface / --ink / --muted / --accent / --accent-soft) so the
// PER-ROUTE THEME flows automatically: `--accent` flips blue → coffee (Espresso) → green
// (Matcha) via the .mase-side.theme-* rules in dashboard.css, and the active-link tint +
// the brand mark follow it with no extra code. The `.mase-side` wrapper is kept so the
// layout width/offset + themed background/border + logo-gradient vars still apply.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDashboard } from "@/lib/engine/DashboardContext";
import AuthButton from "@/components/AuthButton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  Handshake, Coffee, Leaf, MessageSquare, RefreshCw, ListChecks,
  GraduationCap, Bot, Users, Eye, type LucideIcon,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean; superOnly?: boolean };

// Same routes as before. `adminOnly` mirrors the header's ADMIN_ONLY_TABS so non-admins
// only see Deals / Espresso / Matcha. `superOnly` = SUPER-ADMINS only.
const NAV: NavItem[] = [
  { href: "/deals", label: "Deals", icon: Handshake },
  { href: "/espresso", label: "Espresso", icon: Coffee },
  { href: "/matcha", label: "Matcha", icon: Leaf },
  { href: "/chat", label: "Chat", icon: MessageSquare, adminOnly: true },
  { href: "/sync-quality", label: "Sync Quality", icon: RefreshCw, adminOnly: true },
  { href: "/runs", label: "Runs", icon: ListChecks, adminOnly: true },
  { href: "/learnings", label: "Learning", icon: GraduationCap, adminOnly: true },
  { href: "/teams", label: "Teams Bot", icon: Users, adminOnly: true },
  { href: "/admin", label: "Admin", icon: Bot, adminOnly: true },
  { href: "/omnivision", label: "Omnivision", icon: Eye, superOnly: true },
];

// Initials for the avatar fallback — first + last token of the name/email.
function initials(s: string | null | undefined): string {
  const parts = (s || "").trim().split(/[\s@._-]+/).filter(Boolean);
  if (!parts.length) return "MA";
  const a = parts[0][0] || "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] || "");
  return (a + b).toUpperCase().slice(0, 2) || "MA";
}

export default function AppSidebar() {
  const pathname = usePathname();
  const { isAdminView, isSuperAdminView, realIsAdmin, simEmail, scopeName, chatAllowed } = useDashboard();
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser()
      .then(({ data }) => setUserName((data.user?.user_metadata?.name as string) || data.user?.email || null))
      .catch(() => {});
  }, []);

  const items = NAV.filter((n) =>
    n.superOnly ? isSuperAdminView
      : n.href === "/chat" ? (isAdminView || chatAllowed) : (!n.adminOnly || isAdminView)
  );
  // Group by access level — the grouping is real information (what this account can reach),
  // not decoration, so admins get a labelled "Admin" section instead of one long list.
  const primary = items.filter((n) => !n.adminOnly && !n.superOnly);
  const adminItems = items.filter((n) => n.adminOnly);
  const superItems = items.filter((n) => n.superOnly);

  const role = simEmail
    ? `Simulating · ${scopeName ?? ""}`.trim()
    : realIsAdmin ? "Admin" : (scopeName || "Member");
  const tabTheme = pathname.startsWith("/espresso") ? "theme-espresso"
    : pathname.startsWith("/matcha") ? "theme-matcha" : "";

  const NavLink = ({ n }: { n: NavItem }) => {
    const Icon = n.icon;
    const active = pathname.startsWith(n.href);
    return (
      <Link
        href={n.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40",
          active
            ? "bg-[var(--accent-soft)] text-[var(--accent)]"
            : "text-[var(--muted)] hover:bg-[var(--surface2)] hover:text-[var(--ink)]"
        )}
      >
        {/* active indicator — a short accent bar on the left edge */}
        <span
          aria-hidden
          className={cn(
            "absolute left-0 top-1/2 h-5 -translate-y-1/2 rounded-r-full bg-[var(--accent)] transition-all",
            active ? "w-[3px] opacity-100" : "w-0 opacity-0"
          )}
        />
        <Icon className={cn("size-[17px] shrink-0 transition-colors", !active && "text-[var(--muted)] group-hover:text-[var(--ink)]")} />
        <span className="truncate">{n.label}</span>
      </Link>
    );
  };

  return (
    <aside className={cn("mase-side", tabTheme)}>
      <div className="px-4 pb-3 pt-4">
        {/* Inline SVG so the brand gradient follows the route theme via --logo-c* vars. */}
        <svg viewBox="0 0 520 158" fill="none" role="img" aria-label="MASE — Agents that close with you" className="block h-9 w-auto">
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

      <nav className="flex flex-col gap-0.5 overflow-y-auto px-2">
        {primary.map((n) => <NavLink key={n.href} n={n} />)}
        {adminItems.length ? (
          <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)] opacity-70">
            Admin
          </div>
        ) : null}
        {adminItems.map((n) => <NavLink key={n.href} n={n} />)}
        {superItems.map((n) => <NavLink key={n.href} n={n} />)}
      </nav>

      <div className="mt-auto px-3 pt-2">
        <Separator className="bg-[var(--line)]" />
        <div className="flex items-center gap-2.5 py-3">
          <Avatar className="size-9 shrink-0">
            <AvatarFallback className="bg-[var(--accent-soft)] text-[11px] font-bold text-[var(--accent)]">
              {initials(userName || scopeName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold text-[var(--ink)]">{userName || scopeName || "Account"}</div>
            <div className="truncate text-[11px] text-[var(--muted)]">{role}</div>
          </div>
          <AuthButton />
        </div>
      </div>
    </aside>
  );
}

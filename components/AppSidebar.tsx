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
import Link, { useLinkStatus } from "next/link";
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
  GraduationCap, Bot, Users, Eye, Loader2, PanelLeftClose, PanelLeftOpen, type LucideIcon,
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

// Descendant of <Link> — reads the pending navigation state so a clicked nav item shows a
// spinner the instant it's clicked while its route loads, instead of dead air that makes the
// app feel stuck. Icon ↔ spinner swap keeps the row from shifting.
function NavIcon({ Icon, active }: { Icon: LucideIcon; active: boolean }) {
  const { pending } = useLinkStatus();
  if (pending) return <Loader2 className="size-[17px] shrink-0 animate-spin text-[var(--accent)]" />;
  return <Icon className={cn("size-[17px] shrink-0 transition-colors", !active && "text-[var(--muted)] group-hover:text-[var(--ink)]")} />;
}

export default function AppSidebar() {
  const pathname = usePathname();
  const { isAdminView, isSuperAdminView, realIsAdmin, simEmail, scopeName, chatAllowed } = useDashboard();
  const [userName, setUserName] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser()
      .then(({ data }) => setUserName((data.user?.user_metadata?.name as string) || data.user?.email || null))
      .catch(() => {});
  }, []);

  // Collapse state persists per browser; a root class drives the sidebar width AND the shell's
  // left offset together (the shell is a sibling of this component, not a child).
  useEffect(() => {
    try { setCollapsed(localStorage.getItem("mase.side.collapsed") === "1"); } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("side-collapsed", collapsed);
    try { localStorage.setItem("mase.side.collapsed", collapsed ? "1" : "0"); } catch {}
  }, [collapsed]);

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
        title={collapsed ? n.label : undefined}
        className={cn(
          "group relative flex items-center gap-2.5 rounded-lg py-2 text-[13px] font-medium outline-none transition-colors",
          collapsed ? "justify-center px-0" : "px-3",
          "focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40",
          active
            ? "bg-[var(--accent-soft)] text-[var(--accent)]"
            : "text-[var(--muted)] hover:bg-[var(--surface2)] hover:text-[var(--ink)]"
        )}
      >
        {/* active indicator — a short accent bar on the left edge (hidden when collapsed) */}
        <span
          aria-hidden
          className={cn(
            "absolute left-0 top-1/2 h-5 -translate-y-1/2 rounded-r-full bg-[var(--accent)] transition-all",
            active && !collapsed ? "w-[3px] opacity-100" : "w-0 opacity-0"
          )}
        />
        <NavIcon Icon={Icon} active={active} />
        {!collapsed && <span className="truncate">{n.label}</span>}
      </Link>
    );
  };

  return (
    <aside className={cn("mase-side", tabTheme)}>
      <div className={cn("flex pb-3 pt-4", collapsed ? "flex-col items-center gap-2.5 px-2" : "items-center justify-between px-4")}>
        {collapsed ? (
          /* Star-only mark when collapsed. */
          <svg viewBox="0 0 144 164" fill="none" role="img" aria-label="MASE" className="block h-7 w-7">
            <defs>
              <linearGradient id="maseBrandMini" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="var(--logo-c1)" />
                <stop offset="0.55" stopColor="var(--logo-c2)" />
                <stop offset="1" stopColor="var(--logo-c3)" />
              </linearGradient>
            </defs>
            <path d="M72,20 L87,67 L134,82 L87,97 L72,144 L57,97 L10,82 L57,67 Z" fill="url(#maseBrandMini)" />
          </svg>
        ) : (
        /* Inline SVG so the brand gradient follows the route theme via --logo-c* vars. */
        <svg viewBox="0 0 520 158" fill="none" role="img" aria-label="MASE — Agents that close with you" className="block h-9 w-auto">
          <defs>
            <linearGradient id="maseBrand" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--logo-c1)" />
              <stop offset="0.55" stopColor="var(--logo-c2)" />
              <stop offset="1" stopColor="var(--logo-c3)" />
            </linearGradient>
            <clipPath id="maseStar">
              <path d="M72,20 L87,67 L134,82 L87,97 L72,144 L57,97 L10,82 L57,67 Z" />
            </clipPath>
          </defs>
          {/* Crisp 4-point brand star (sharp concave rays). The diagonal brand gradient gives
              the top-left→bottom-right sheen; a faint upper-left facet (clipped to the star)
              adds the bevel. */}
          <path d="M72,20 L87,67 L134,82 L87,97 L72,144 L57,97 L10,82 L57,67 Z" fill="url(#maseBrand)" />
          <path d="M72,20 L57,67 L10,82 L72,82 Z" fill="#ffffff" opacity="0.2" clipPath="url(#maseStar)" />
          <text x="182" y="112" fontFamily="'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif"
            fontWeight="800" fontSize="104" letterSpacing="-1" fill="url(#maseBrand)">MASE</text>
          <text x="322" y="146" textAnchor="middle" fontFamily="'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif"
            fontWeight="600" fontSize="17" letterSpacing="3" fill="#5b6b7e">AGENTS THAT CLOSE WITH YOU</text>
        </svg>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="side-toggle"
        >
          {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 overflow-y-auto px-2">
        {primary.map((n) => <NavLink key={n.href} n={n} />)}
        {adminItems.length && !collapsed ? (
          <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)] opacity-70">
            Admin
          </div>
        ) : null}
        {adminItems.map((n) => <NavLink key={n.href} n={n} />)}
        {superItems.map((n) => <NavLink key={n.href} n={n} />)}
      </nav>

      <div className="mt-auto px-3 pt-2">
        <Separator className="bg-[var(--line)]" />
        <div className={cn("flex items-center gap-2.5 py-3", collapsed && "justify-center")}>
          <Avatar className="size-9 shrink-0">
            <AvatarFallback className="bg-[var(--accent-soft)] text-[11px] font-bold text-[var(--accent)]">
              {initials(userName || scopeName)}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold text-[var(--ink)]">{userName || scopeName || "Account"}</div>
                <div className="truncate text-[11px] text-[var(--muted)]">{role}</div>
              </div>
              <AuthButton />
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

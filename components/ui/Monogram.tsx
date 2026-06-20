"use client";
// Deterministic initials monogram for accounts (square) and people (circle), with
// an optional logo `src` that falls back to initials on error. Self-contained inline
// styles so it renders identically on every dashboard page (no Tailwind dependency).
// Real company logos (account_logo_url from the sweep) can be passed as `src` later.
import React from "react";
import { useAccountLogos } from "@/lib/engine/AccountLogosProvider";

const PALETTE = [
  "#6366f1", "#8b5cf6", "#7c3aed", "#2563eb", "#0ea5e9", "#0a7ea4",
  "#14b8a6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#64748b",
];

const STOP = /^(inc|ltd|llc|corp|co|group|groupe|limited|holdings|the|plc|sa|ag|gmbh|nv|bv|pvt|technologies|technology|solutions|systems|software|global)$/i;

// Account-name slug → signed Supabase logo URL (generated from the bucket). Falls back to
// initials when an account has no logo. Backend will serve these at read time later.
function logoSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function accountInitials(name: string): string {
  const cleaned = name.replace(/[,.&]/g, " ").replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ").filter((w) => w && !STOP.test(w));
  const base = words[0] || cleaned || "?";
  return base.slice(0, 4).toUpperCase();
}

function personInitials(name: string): string {
  const words = name.replace(/[,.]/g, "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function Monogram({
  name = "",
  src,
  kind = "account",
  size = 32,
  className,
  style,
}: {
  name?: string;
  src?: string | null;
  kind?: "account" | "person";
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [err, setErr] = React.useState(false);
  const isPerson = kind === "person";
  const logos = useAccountLogos();
  // Use an explicit src, else the live account logo (Supabase signed URL), else initials.
  const resolved = src ?? (kind === "account" && name ? logos[logoSlug(name)] : undefined);
  const initials = isPerson ? personInitials(name) : accountInitials(name);
  const color = PALETTE[hashStr(name || "?") % PALETTE.length];
  const radius = isPerson ? "50%" : `${Math.max(6, Math.round(size * 0.26))}px`;
  const fontSize = Math.round(size * (initials.length >= 4 ? 0.32 : initials.length === 3 ? 0.37 : 0.42));

  const base: React.CSSProperties = {
    width: size, height: size, borderRadius: radius,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    flex: "0 0 auto", fontWeight: 700, lineHeight: 1, overflow: "hidden",
    letterSpacing: initials.length >= 4 ? "-0.03em" : 0, userSelect: "none", ...style,
  };

  if (resolved && !err) {
    return (
      <span className={className} style={{ ...base, background: "#fff", border: "1px solid var(--line,#e9edf4)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={resolved} alt={name} width={size} height={size}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          onError={() => setErr(true)} />
      </span>
    );
  }

  return (
    <span className={className} title={name}
      style={{ ...base, background: isPerson ? `${color}22` : color, color: isPerson ? color : "#fff", fontSize }}>
      {initials}
    </span>
  );
}

export default Monogram;

"use client";

import { useMemo } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { EMAIL_TO_OWNER, REGION_ADMINS, resolveAccess } from "@/lib/engine/helpers";

// A synthetic email used to preview the "blocked / non-member" view.
const BLOCKED_PREVIEW = "preview.nonmember@example.com";

type Opt = { email: string; name: string; role: "Region" | "VP" | "Rep" };

// Admin-only control: impersonate any allow-listed user (or a non-member) to see
// exactly what they'd see. Renders nothing for non-admins.
export default function SimulateBar() {
    const { realIsAdmin, simEmail, simulateAs, scopeName, blocked } = useDashboard();

    const opts = useMemo<Opt[]>(() => {
        const region: Opt[] = Object.entries(REGION_ADMINS).map(
            ([email, def]) => ({ email, name: def.name, role: "Region" as const }));
        const owners: Opt[] = Object.entries(EMAIL_TO_OWNER)
            .map(([email, name]) => {
                const a = resolveAccess(email) as any;
                const role: "VP" | "Rep" = a.kind === "scoped" && a.vps.length ? "VP" : "Rep";
                return { email, name, role } as Opt;
            })
            .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "VP" ? -1 : 1));
        return [...region, ...owners];
    }, []);

    if (!realIsAdmin) return null;

    const simulating = simEmail != null;
    const selectValue = simEmail === BLOCKED_PREVIEW ? "__blocked__" : simEmail ?? "";

    function onChange(v: string) {
        if (v === "") simulateAs(null);
        else if (v === "__blocked__") simulateAs(BLOCKED_PREVIEW);
        else simulateAs(v);
    }

    const status = !simulating
        ? null
        : blocked
            ? "a non-member — no access"
            : (() => {
                const role = opts.find((o) => o.email === simEmail)?.role;
                const suffix = role === "VP" ? " — whole team" : role === "Region" ? " — region (all its teams)" : " — own deals";
                return `${scopeName ?? simEmail}${selectValue ? suffix : ""}`;
            })();

    return (
        <div
            className={`simbar flex items-center gap-3 px-4 py-1.5 text-xs border-b ${
                simulating
                    ? "bg-amber-500/15 border-amber-500/40 text-amber-800 dark:text-amber-300"
                    : "bg-muted/40 text-muted-foreground"
            }`}
        >
            <span className="font-semibold whitespace-nowrap">
                {simulating ? "👁 Simulating:" : "Admin preview:"}
            </span>

            <select
                value={selectValue}
                onChange={(e) => onChange(e.target.value)}
                className="bg-background border rounded px-2 py-1 text-xs max-w-[280px]"
            >
                <option value="">Your view (admin · whole book)</option>
                {opts.some((o) => o.role === "Region") && (
                    <optgroup label="Region admins">
                        {opts.filter((o) => o.role === "Region").map((o) => (
                            <option key={o.email} value={o.email}>{o.name}</option>
                        ))}
                    </optgroup>
                )}
                <optgroup label="VPs">
                    {opts.filter((o) => o.role === "VP").map((o) => (
                        <option key={o.email} value={o.email}>{o.name} — VP</option>
                    ))}
                </optgroup>
                <optgroup label="Reps">
                    {opts.filter((o) => o.role === "Rep").map((o) => (
                        <option key={o.email} value={o.email}>{o.name}</option>
                    ))}
                </optgroup>
                <option value="__blocked__">A non-member (blocked / no access)</option>
            </select>

            {simulating && (
                <>
                    <span className="truncate">
                        Viewing as <b>{status}</b>. This is exactly what they see.
                    </span>
                    <button
                        onClick={() => simulateAs(null)}
                        className="ml-auto whitespace-nowrap rounded border border-amber-500/50 px-2 py-0.5 font-medium hover:bg-amber-500/20"
                    >
                        Exit simulation
                    </button>
                </>
            )}
        </div>
    );
}

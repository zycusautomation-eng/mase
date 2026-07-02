"use client";
// Teams Bot — Control Room. Admin-only surface to manage who can use the MASE Teams
// bot (allowlist), toggle enforcement + group-history reading, and watch recent bot
// activity. Talks to the backend via the same-origin /api/teams/* proxy (token +
// admin gate server-side). Gates on isAdminView like the other admin pages.
import { useCallback, useEffect, useState } from "react";
import { useDashboard } from "@/lib/engine/DashboardContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Users, Trash2, RefreshCw } from "lucide-react";

type AllowRow = {
  id: string; email: string | null; display_name: string | null;
  enabled: boolean; added_at: string | null;
};
type Settings = { enforce_allowlist: boolean; history_enabled: boolean };
type Activity = {
  id: string; ts: string | null; conversation_type: string | null;
  user_name: string | null; user_email: string | null;
  direction: string | null; status: string | null; text: string | null;
};

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative h-6 w-11 rounded-full transition-colors ${on ? "bg-indigo-600" : "bg-slate-300"}`}
      aria-pressed={on}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

const STATUS_STYLE: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-700",
  denied: "bg-rose-100 text-rose-700",
  error: "bg-amber-100 text-amber-700",
  ignored: "bg-slate-100 text-slate-600",
};

export default function TeamsControlRoomPage() {
  const { isAdminView } = useDashboard();
  if (!isAdminView)
    return (
      <div className="dq-lock"><div className="dq-lock-card">
        <div className="dq-lock-ttl">🔒 Admin</div>
        <div className="dq-lock-sub">The Teams bot control room is restricted to admins.</div>
      </div></div>
    );
  return <ControlRoom />;
}

function ControlRoom() {
  const [rows, setRows] = useState<AllowRow[]>([]);
  const [settings, setSettings] = useState<Settings>({ enforce_allowlist: false, history_enabled: false });
  const [activity, setActivity] = useState<Activity[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadAllowlist = useCallback(async () => {
    const r = await fetch("/api/teams/allowlist", { cache: "no-store" });
    if (!r.ok) { setErr(r.status === 403 ? "Admin only." : `Error ${r.status}`); return; }
    const j = await r.json();
    setRows(j.rows || []); setSettings(j.settings || settings); setErr(null);
  }, [settings]);

  const loadActivity = useCallback(async () => {
    const r = await fetch("/api/teams/activity?limit=60", { cache: "no-store" });
    if (r.ok) setActivity((await r.json()).rows || []);
  }, []);

  useEffect(() => { loadAllowlist(); loadActivity(); }, [loadAllowlist, loadActivity]);

  async function saveSetting(key: keyof Settings, value: boolean) {
    setSettings((s) => ({ ...s, [key]: value })); // optimistic
    const r = await fetch("/api/teams/settings", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    if (r.ok) setSettings((await r.json()).settings);
  }

  async function addUser() {
    const e = email.trim();
    if (!e) { setErr("Enter an email"); return; }
    setBusy(true);
    const r = await fetch("/api/teams/allowlist", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: e, display_name: name.trim() }),
    });
    setBusy(false);
    if (!r.ok) { setErr(`Add failed (${r.status})`); return; }
    setEmail(""); setName(""); loadAllowlist();
  }

  async function toggleUser(id: string, enabled: boolean) {
    await fetch(`/api/teams/allowlist/${id}/toggle`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    loadAllowlist();
  }

  async function removeUser(id: string) {
    await fetch(`/api/teams/allowlist/${id}`, { method: "DELETE" });
    loadAllowlist();
  }

  return (
    <div className="mx-auto max-w-4xl px-1 py-2">
      <div className="mb-4 flex items-center gap-2">
        <Users className="h-5 w-5 text-indigo-600" />
        <h1 className="text-lg font-semibold">Teams Bot — Control Room</h1>
        {err && <span className="ml-2 text-sm text-rose-600">{err}</span>}
      </div>

      <Card className="mb-4">
        <CardHeader><CardTitle className="text-sm uppercase tracking-wide text-slate-500">Settings</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Toggle on={settings.enforce_allowlist} onClick={() => saveSetting("enforce_allowlist", !settings.enforce_allowlist)} />
            <div><div className="font-medium">Enforce allowlist</div>
              <div className="text-sm text-slate-500">Off = anyone in a chat can use MASE. On = only listed users.</div></div>
          </div>
          <div className="flex items-center gap-3">
            <Toggle on={settings.history_enabled} onClick={() => saveSetting("history_enabled", !settings.history_enabled)} />
            <div><div className="font-medium">Read group history</div>
              <div className="text-sm text-slate-500">Needs the metered Teams Graph API (pending IT) — leave off until enabled.</div></div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader><CardTitle className="text-sm uppercase tracking-wide text-slate-500">Allowlist</CardTitle></CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input type="email" placeholder="user@zycus.com" value={email}
              onChange={(e) => setEmail(e.target.value)} className="max-w-xs"
              onKeyDown={(e) => e.key === "Enter" && addUser()} />
            <Input type="text" placeholder="Display name (optional)" value={name}
              onChange={(e) => setName(e.target.value)} className="max-w-xs" />
            <Button onClick={addUser} disabled={busy}>Add user</Button>
          </div>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr><th className="p-2 text-left">Email</th><th className="p-2 text-left">Name</th>
                  <th className="p-2 text-left">Enabled</th><th className="p-2 text-left">Added</th><th /></tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="p-3 text-slate-500">
                    No users yet. With enforcement ON and an empty list, nobody can use the bot.</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">{r.email || <span className="text-slate-400">—</span>}</td>
                    <td className="p-2">{r.display_name || <span className="text-slate-400">—</span>}</td>
                    <td className="p-2"><Toggle on={r.enabled} onClick={() => toggleUser(r.id, !r.enabled)} /></td>
                    <td className="p-2 text-slate-500">{(r.added_at || "").slice(0, 10)}</td>
                    <td className="p-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => removeUser(r.id)}
                        className="text-rose-600 hover:text-rose-700">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm uppercase tracking-wide text-slate-500">Recent activity</CardTitle>
          <Button variant="ghost" size="sm" onClick={loadActivity}><RefreshCw className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr><th className="p-2 text-left">Time</th><th className="p-2 text-left">User</th>
                  <th className="p-2 text-left">Type</th><th className="p-2 text-left">Dir</th>
                  <th className="p-2 text-left">Status</th><th className="p-2 text-left">Message</th></tr>
              </thead>
              <tbody>
                {activity.length === 0 && (
                  <tr><td colSpan={6} className="p-3 text-slate-500">No activity yet.</td></tr>
                )}
                {activity.map((a) => (
                  <tr key={a.id} className="border-t align-top">
                    <td className="p-2 text-slate-500">{(a.ts || "").slice(11, 19)}</td>
                    <td className="p-2">{a.user_name || a.user_email || "—"}</td>
                    <td className="p-2 text-slate-500">{a.conversation_type || "—"}</td>
                    <td className="p-2 text-slate-500">{a.direction || ""}</td>
                    <td className="p-2">
                      <Badge className={STATUS_STYLE[a.status || "ignored"] || STATUS_STYLE.ignored}>
                        {a.status || ""}
                      </Badge>
                    </td>
                    <td className="p-2 max-w-md truncate">{(a.text || "").slice(0, 140)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

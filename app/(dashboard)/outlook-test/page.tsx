"use client";

// Direct Outlook test surface — exercises the backend /api/outlook/* endpoints
// (same logic as the outlook_* MCP tools) WITHOUT the agent/LLM. Acts as the
// signed-in user; identity is injected server-side by the proxy.
import { useEffect, useState } from "react";

type Json = Record<string, unknown>;

export default function OutlookTestPage() {
  const [status, setStatus] = useState<string>("checking…");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("MASE Outlook test");
  const [body, setBody] = useState("Testing Outlook send from MASE — please ignore.");
  const [out, setOut] = useState<Json | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(path: string, init?: RequestInit) {
    setBusy(true);
    setOut(null);
    try {
      const res = await fetch(`/api/outlook/${path}`, init);
      const json = await res.json();
      setOut({ http: res.status, ...json });
      return json;
    } catch (e) {
      setOut({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus() {
    setStatus("checking…");
    const j = await call("status");
    if (j?.connected) setStatus(`connected as ${j.mailbox ?? j.display_name ?? "?"}`);
    else if (j?.connected === false) setStatus("NOT connected — sign in with Microsoft to grant mail access");
    else setStatus("error — see result below");
  }

  useEffect(() => {
    checkStatus(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const post = (path: string) =>
    call(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, subject, body }),
    });

  const btn: React.CSSProperties = {
    padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1",
    background: "#2E5BFF", color: "#fff", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1,
  };
  const ghost: React.CSSProperties = { ...btn, background: "#fff", color: "#1e293b" };
  const input: React.CSSProperties = {
    width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", marginTop: 4,
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Outlook test</h1>
      <p style={{ color: "#64748b", marginBottom: 16 }}>
        Sends/reads from <b>your own</b> Outlook via the backend Outlook tools (no chatbot).
      </p>

      <div style={{ padding: 12, borderRadius: 10, background: "#f1f5f9", marginBottom: 20 }}>
        <b>Status:</b> {status}{" "}
        <button style={{ ...ghost, padding: "4px 10px", marginLeft: 8 }} disabled={busy} onClick={checkStatus}>
          refresh
        </button>
      </div>

      <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
        <label>To<input style={input} value={to} onChange={(e) => setTo(e.target.value)} placeholder="someone@zycus.com" /></label>
        <label>Subject<input style={input} value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
        <label>Body<textarea style={{ ...input, minHeight: 90 }} value={body} onChange={(e) => setBody(e.target.value)} /></label>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
        <button style={btn} disabled={busy} onClick={() => post("send")}>Send email</button>
        <button style={ghost} disabled={busy} onClick={() => post("draft")}>Create draft</button>
        <button style={ghost} disabled={busy} onClick={() => call("messages?limit=5")}>List inbox (5)</button>
      </div>

      {out && (
        <pre style={{ background: "#0f172a", color: "#e2e8f0", padding: 14, borderRadius: 10, overflow: "auto", fontSize: 13 }}>
          {JSON.stringify(out, null, 2)}
        </pre>
      )}
    </div>
  );
}

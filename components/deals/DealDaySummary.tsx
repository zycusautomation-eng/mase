"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// "24h Summary" drawer tab. Reads ONLY ai.day_summary off the deal record (the same
// deal_records source the rest of the drawer uses) — built from Salesforce activity by
// build_day_summaries.py and refreshed on every sweep. It shows the LAST DAY THAT HAD
// ACTIVITY (with its date), each meeting/call/email/movement named with a one-line
// what-happened, plus an overall narrative. It NEVER queries the separate, stale
// deal_daily_summaries table (that was the "No activity" disconnect), and it never dumps
// raw email/transcript text or "what to do next" (that lives in the to-dos).

// A date-only ('YYYY-MM-DD') label, e.g. "Jul 4".
function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(String(iso).slice(0, 10) + "T00:00:00").toLocaleDateString(undefined, {
      month: "short", day: "numeric",
    });
  } catch { return String(iso); }
}
// Strip logging-tool metadata prefixes so a name reads like plain English.
function cleanName(s?: string | null): string {
  let t = String(s || "").trim();
  t = t.replace(/^(\s*\[[^\]]*\]\s*)+/g, "");
  t = t.replace(/^(avoma|clari|gong|outreach|lemlist)\s*[-:–]\s*/i, "");
  return t.trim() || "Activity";
}
const KIND_ICON: Record<string, string> = { email: "✉", call: "📞", meeting: "📅", task: "✓", movement: "⇅" };
const KNOWN = new Set(["email", "call", "meeting", "task", "movement"]);
const kindClass = (k: any) => (KNOWN.has(String(k)) ? String(k) : "neu");

export function DealDaySummary({ daySummary }: { daySummary?: any }) {
  const ds = daySummary && typeof daySummary === "object" ? daySummary : null;
  const items: any[] = ds && Array.isArray(ds.items) ? ds.items : [];
  const has = !!(ds && (String(ds.overall || "").trim() || items.length));

  if (!has) {
    return (
      <div className="card card-pad ic-body">
        No activity recorded for this deal in the last 120 days.
      </div>
    );
  }

  return (
    <>
      <div className="ai-hero mb14">
        <div className="spine" />
        <div className="ai-head">
          <div className="ai-mark">🕐</div>
          <div className="ai-title">What happened{ds.as_of ? ` · ${fmtDate(ds.as_of)}` : ""}</div>
          <span className="sum-tag t-ai" style={{ marginLeft: "auto" }}>{ds.source === "sf_activity" ? "From Salesforce" : "AI summary"}</span>
        </div>
        {String(ds.overall || "").trim()
          ? <div className="ai-lede" style={{ whiteSpace: "pre-wrap" }}>{ds.overall}</div>
          : null}
      </div>
      {items.length ? (
        <div className="card card-pad mb14">
          {items.map((it: any, i: number) => (
            <div className="sum-row" key={i}>
              <div className={`sum-ic k-${kindClass(it.kind)}`}>{KIND_ICON[it.kind] || "•"}</div>
              <div className="sum-main">
                <div className="sum-t"><b>{cleanName(it.name)}</b></div>
                {String(it.summary || "").trim()
                  ? <div className="ic-body" style={{ color: "var(--ink-soft)", marginTop: 2, fontSize: 12.5, lineHeight: 1.5 }}>{it.summary}</div>
                  : null}
                <div className="sum-meta">{it.kind}{it.at ? ` · ${fmtDate(it.at)}` : ""}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

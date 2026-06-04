"use client";
import { useState, useMemo } from "react";
import { dealEngine } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { TodoItem, TodoResponse } from "@/lib/types";
import { Loading, ErrorBanner, Empty } from "./states";

// Sub-groups in display order, matching the upstream To-Do colors.
const GROUPS: { key: keyof Omit<TodoResponse, "owner">; title: string; cls: string }[] = [
  { key: "critical", title: "Critical", cls: "crit" },
  { key: "important", title: "Important commitments", cls: "impt" },
  { key: "explicitRequirements", title: "Explicit requirements", cls: "exp" },
  { key: "implicit", title: "Implicit needs", cls: "impl" },
  { key: "bestPractice", title: "Best-practice checks", cls: "bpr" },
];

const DONE_KEY = "deal_engine_todo_done";

function loadDone(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

// Pull whatever human-readable text an item carries without inventing fields.
function itemText(it: TodoItem): string {
  for (const k of ["flag", "action", "commitment", "requirement", "inferred_need", "text", "title", "note"]) {
    const v = it[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return it.opp_name || it.account_name || it.opp_id;
}

interface DealBucket {
  opp_id: string;
  account_name: string;
  opp_name: string;
  owner_name: string;
  groups: Record<string, { text: string; id: string }[]>;
  total: number;
}

export default function EspressoTab({ owner }: { owner: string }) {
  const { data, loading, error, reload } = useAsync(() => dealEngine.todo(owner), [owner]);
  const [done, setDone] = useState<Set<string>>(loadDone);

  // Regroup the flat /todo response into one card per deal (upstream layout).
  const deals = useMemo<DealBucket[]>(() => {
    if (!data) return [];
    const byOpp = new Map<string, DealBucket>();
    for (const g of GROUPS) {
      for (const it of data[g.key] ?? []) {
        let bucket = byOpp.get(it.opp_id);
        if (!bucket) {
          bucket = {
            opp_id: it.opp_id,
            account_name: it.account_name || it.opp_id,
            opp_name: it.opp_name || "",
            owner_name: it.owner_name || "",
            groups: {},
            total: 0,
          };
          byOpp.set(it.opp_id, bucket);
        }
        const text = itemText(it);
        (bucket.groups[g.key] ||= []).push({ text, id: `${it.opp_id}:${slug(text)}` });
        bucket.total++;
      }
    }
    return [...byOpp.values()];
  }, [data]);

  const { total, doneCount } = useMemo(() => {
    let t = 0,
      d = 0;
    for (const deal of deals)
      for (const items of Object.values(deal.groups))
        for (const it of items) {
          t++;
          if (done.has(it.id)) d++;
        }
    return { total: t, doneCount: d };
  }, [deals, done]);

  function toggle(id: string) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(DONE_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }

  if (loading) return <Loading label="Loading to-dos…" />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (total === 0) {
    return <Empty title="No open items" hint="Critical moves, commitments, and requirements will appear here once deals are loaded." />;
  }

  return (
    <div className="espresso">
      <div className="todo-top">
        <div className="ttl">
          To-do across the book — <b>{total}</b> open {total === 1 ? "item" : "items"}
        </div>
        <div className="todo-prog">
          {doneCount} of {total} done
        </div>
      </div>

      {deals.map((deal) => (
        <div className="todo-card" key={deal.opp_id}>
          <div className="todo-head">
            <div>
              <div className="nm">{deal.account_name}</div>
              <div className="meta">
                {[deal.opp_name, deal.owner_name].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>

          {GROUPS.map((g) => {
            const items = deal.groups[g.key];
            if (!items || items.length === 0) return null;
            return (
              <div key={g.key}>
                <div className={`todo-grp ${g.cls}`}>
                  {g.title} <span className="c">{items.length}</span>
                </div>
                <ul className="todo-list">
                  {items.map((it) => {
                    const isDone = done.has(it.id);
                    return (
                      <li className={`todo-item ${isDone ? "done" : ""}`} key={it.id}>
                        <input type="checkbox" checked={isDone} onChange={() => toggle(it.id)} />
                        <div className="td-body">
                          <div className="td-txt">{it.text}</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function money(n?: number): string {
  if (n == null || isNaN(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export function dateStr(s?: string): string {
  return s && s.length ? s : "—";
}

// Map a verdict / status string to a badge color class.
export function tone(s?: string): "green" | "amber" | "red" | "" {
  if (!s) return "";
  const v = s.toLowerCase();
  if (/(on track|adequate|won|healthy|hungry|strong|addressed|leading|good)/.test(v)) return "green";
  if (/(at risk|inadequate|stalled|curious|moderate|watch|slipping)/.test(v)) return "amber";
  if (/(critical|lost|exposed|resistant|weak|blocked|overdue|gap)/.test(v)) return "red";
  return "";
}

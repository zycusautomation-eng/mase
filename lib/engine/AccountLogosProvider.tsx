"use client";
// Holds the account-name → logo-URL map at runtime. Seeded synchronously from the
// build-time map (lib/engine/accountLogos.ts) so logos paint instantly with no flash,
// then refreshed once from /api/account-logos (the live signed map) so logos added by
// the Apollo enrichment job show up without regenerating the static file or rebuilding.
//
// Monogram reads this via useAccountLogos(); the context default IS the static seed, so
// Monogram still works anywhere it renders, even outside this provider.
import React from "react";
import { ACCOUNT_LOGOS as SEED } from "./accountLogos";

type Logos = Record<string, string>;
const LogosCtx = React.createContext<Logos>(SEED);

export function useAccountLogos(): Logos {
  return React.useContext(LogosCtx);
}

export function AccountLogosProvider({ children }: { children: React.ReactNode }) {
  // Logos discovered live from the bucket (Supabase signed URLs). The static SEED — the
  // full tracked book by real Salesforce domain — always wins; the route only fills in
  // any slug the seed doesn't have.
  const [routeLogos, setRouteLogos] = React.useState<Logos>({});
  React.useEffect(() => {
    let alive = true;
    fetch("/api/account-logos", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && d.logos) setRouteLogos(d.logos);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const value = React.useMemo(() => ({ ...routeLogos, ...SEED }), [routeLogos]);
  return <LogosCtx.Provider value={value}>{children}</LogosCtx.Provider>;
}

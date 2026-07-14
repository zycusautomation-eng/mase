"use client";
// The open deal now lives in the ?deal=<id> query param on /deals (see deals/layout.tsx), not
// in this route segment. This page only exists to keep OLD /deals/<id> links (shared, bookmarked)
// working: it redirects to the canonical /deals?deal=<id>, which opens the drawer over the board.
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function DealDetailPage() {
  const params = useParams();
  const router = useRouter();
  useEffect(() => {
    const id = String((params?.id as string) || "");
    router.replace(id ? `/deals?deal=${encodeURIComponent(id)}` : "/deals");
  }, [params, router]);
  return null;
}

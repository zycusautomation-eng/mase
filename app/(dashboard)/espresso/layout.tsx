// Espresso route layout. Imports the scoped Tailwind/shadcn stylesheet so the
// per-deal AI panel (DealAgentPanel) — which reuses the chat's Tailwind UI — can
// render here. tailwind.css ships theme + utilities but NOT preflight and uses
// namespaced tokens (--sc-*), so it does not restyle the hand-written Espresso
// page; the chat styles only take effect inside the panel's .mase-chat-root.
import "../../tailwind.css";

export default function EspressoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

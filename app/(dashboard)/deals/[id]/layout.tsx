// Deal-detail route layout. Imports the scoped Tailwind/shadcn stylesheet so the
// AI copilot panel (DealAgentPanel, which reuses the chat's Tailwind UI) renders
// correctly here, exactly like the Espresso route does. tailwind.css ships theme +
// utilities but NOT preflight and uses namespaced tokens (--sc-*), so it does not
// restyle the hand-written deal page (which uses dashboard.css).
import "../../../tailwind.css";

export default function DealDetailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

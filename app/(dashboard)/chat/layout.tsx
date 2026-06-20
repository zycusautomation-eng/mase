// Chat-route layout. This is the ONLY place app/tailwind.css is imported, so
// Tailwind utilities + the shadcn tokens are available on the chat page WITHOUT
// touching the rest of the app. (tailwind.css imports theme + utilities but NOT
// preflight, so no global reset is injected even from here.)
//
// The GeistSans font variable is attached to the chat wrapper so the new
// workspace renders in Geist; the other pages keep their own font stack.
import "../../tailwind.css";
import { GeistSans } from "geist/font/sans";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  // The global header is dropped on /chat (see (dashboard)/layout.tsx), so the
  // workspace fills the ENTIRE viewport edge-to-edge — no border card, no header
  // offset, no trailing gap — matching the Notion/Claude/Linear mockup.
  return (
    <div
      className={`mase-chat-root ${GeistSans.variable}`}
      style={{
        fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
        height: "100vh",
        width: "100%",
        overflow: "hidden",
        background: "var(--background)",
      }}
    >
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
    </div>
  );
}

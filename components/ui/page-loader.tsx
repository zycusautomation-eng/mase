import { GooeyLoader } from "@/components/ui/loader-10";

/**
 * Full-area loading state: the gooey loader centered in the viewport content
 * area with a label underneath. Used for the deals / Espresso / Matcha (book)
 * load states.
 *
 * `tone` matches the loader to the active tab accent (see dashboard.css):
 *   blue     — default MASE accent (deals + everything else)
 *   espresso — warm coffee accent (.wrap.theme-espresso → --accent:#9a5b2d)
 *   matcha   — green accent        (.wrap.theme-matcha   → --accent:#5d8a2c)
 */
export type LoaderTone = "blue" | "espresso" | "matcha";

const TONES: Record<LoaderTone, { primary: string; secondary: string; border: string }> = {
  blue: { primary: "#5277F0", secondary: "#7B9CFF", border: "#dbe2ee" },
  espresso: { primary: "#9a5b2d", secondary: "#c07d3f", border: "#efe2d3" },
  matcha: { primary: "#5d8a2c", secondary: "#7db83f", border: "#e5efd7" },
};

export function PageLoader({ label = "Loading…", tone = "blue" }: { label?: string; tone?: LoaderTone }) {
  const c = TONES[tone];
  return (
    <div className="flex min-h-[70vh] w-full flex-col items-center justify-center gap-6">
      <GooeyLoader primaryColor={c.primary} secondaryColor={c.secondary} borderColor={c.border} />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

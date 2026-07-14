import { cn } from "@/lib/utils";

// shadcn/ui Skeleton — a pulsing placeholder block. Tokenised to the app so it reads on the
// book surface (a soft tint of the line colour) rather than the default shadcn grey.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-[var(--line)]/60", className)}
      {...props}
    />
  );
}

export { Skeleton };

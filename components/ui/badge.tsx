import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "bg-navy-50 text-navy-700",
      gold: "bg-gold-100 text-gold-700",
      positive: "bg-emerald-50 text-positive",
      negative: "bg-red-50 text-negative",
      warning: "bg-amber-50 text-warning",
      muted: "bg-slate-100 text-muted",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

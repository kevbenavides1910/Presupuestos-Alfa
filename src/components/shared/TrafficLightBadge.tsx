import { cn } from "@/lib/utils/cn";
import type { TrafficLight } from "@/lib/utils/constants";

interface Props {
  light: TrafficLight;
  pct?: number;
  size?: "sm" | "md" | "lg";
}

const colors: Record<TrafficLight, { bg: string; text: string; dot: string; label: string }> = {
  GREEN:  { bg: "bg-green-100",  text: "text-green-800",  dot: "bg-green-500",  label: "Normal" },
  YELLOW: { bg: "bg-yellow-100", text: "text-yellow-800", dot: "bg-yellow-500", label: "Precaución" },
  RED:    { bg: "bg-red-100",    text: "text-red-800",    dot: "bg-red-500 animate-pulse", label: "Crítico" },
};

export function TrafficLightBadge({ light, pct, size = "md" }: Props) {
  const c = colors[light];
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full font-medium",
      c.bg, c.text,
      size === "sm" && "px-2 py-0.5 text-xs",
      size === "md" && "px-2.5 py-1 text-xs",
      size === "lg" && "px-3 py-1.5 text-sm",
    )}>
      <span className={cn("rounded-full", c.dot, size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2")} />
      {pct !== undefined ? `${pct.toFixed(1)}%` : c.label}
    </span>
  );
}

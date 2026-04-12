import { cn } from "@/lib/utils/cn";
import type { TrafficLight } from "@/lib/utils/constants";

interface Props {
  pct: number; // 0-100
  light: TrafficLight;
  showLabel?: boolean;
  height?: "sm" | "md";
}

const barColors: Record<TrafficLight, string> = {
  GREEN: "bg-green-500",
  YELLOW: "bg-yellow-500",
  RED: "bg-red-500",
};

export function BudgetBar({ pct, light, showLabel = true, height = "md" }: Props) {
  const capped = Math.min(pct, 100);
  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>Ejecución</span>
          <span className="font-medium">{pct.toFixed(1)}%</span>
        </div>
      )}
      <div className={cn("w-full bg-slate-200 rounded-full overflow-hidden", height === "sm" ? "h-1.5" : "h-2.5")}>
        <div
          className={cn("h-full rounded-full transition-all duration-500", barColors[light])}
          style={{ width: `${capped}%` }}
        />
      </div>
    </div>
  );
}

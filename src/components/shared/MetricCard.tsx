import { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

interface Props {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  color?: "blue" | "green" | "yellow" | "red" | "purple";
}

const colorMap = {
  blue:   { bg: "bg-blue-50",   icon: "text-blue-600",   border: "border-blue-200" },
  green:  { bg: "bg-green-50",  icon: "text-green-600",  border: "border-green-200" },
  yellow: { bg: "bg-yellow-50", icon: "text-yellow-600", border: "border-yellow-200" },
  red:    { bg: "bg-red-50",    icon: "text-red-600",    border: "border-red-200" },
  purple: { bg: "bg-purple-50", icon: "text-purple-600", border: "border-purple-200" },
};

export function MetricCard({ title, value, subtitle, icon: Icon, color = "blue" }: Props) {
  const c = colorMap[color];
  return (
    <Card className={cn("border", c.border)}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-slate-500 font-medium">{title}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
            {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
          </div>
          <div className={cn("p-3 rounded-xl", c.bg)}>
            <Icon className={cn("h-5 w-5", c.icon)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

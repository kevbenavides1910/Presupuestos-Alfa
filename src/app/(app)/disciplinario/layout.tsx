import { DisciplinarySectionNav } from "@/components/disciplinary/DisciplinarySectionNav";

export default function DisciplinarioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex flex-col">
      <DisciplinarySectionNav />
      {children}
    </div>
  );
}

import { Topbar } from "@/components/layout/Topbar";
import { ContractForm } from "@/components/contracts/ContractForm";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default function NewContractPage() {
  return (
    <>
      <Topbar title="Nuevo Contrato" />
      <div className="p-6 max-w-4xl mx-auto">
        <Link href="/contracts" className="inline-flex items-center text-sm text-slate-500 hover:text-slate-700 mb-6 gap-1">
          <ChevronLeft className="h-4 w-4" />
          Volver a Contratos
        </Link>
        <h2 className="text-xl font-bold text-slate-800 mb-6">Registrar Nuevo Contrato</h2>
        <ContractForm mode="create" />
      </div>
    </>
  );
}

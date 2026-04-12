"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { ContractForm } from "@/components/contracts/ContractForm";

export default function EditContractPage() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ["contract", id],
    queryFn: () => fetch(`/api/contracts/${id}`).then((r) => r.json()),
  });

  const contract = data?.data;

  return (
    <>
      <Topbar title="Editar Contrato" />
      <div className="p-6 max-w-4xl mx-auto">
        <Link href={`/contracts/${id}`} className="inline-flex items-center text-sm text-slate-500 hover:text-slate-700 mb-6 gap-1">
          <ChevronLeft className="h-4 w-4" />
          Volver al contrato
        </Link>
        <h2 className="text-xl font-bold text-slate-800 mb-6">
          Editar Contrato {contract?.licitacionNo}
        </h2>
        {!isLoading && contract && (
          <ContractForm
            mode="edit"
            defaultValues={{
              ...contract,
              monthlyBilling: contract.baseMonthlyBilling ?? contract.monthlyBilling,
              id,
            }}
          />
        )}
      </div>
    </>
  );
}

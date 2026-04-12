import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { redirect } from "next/navigation";
import { listExpensesForSession } from "@/lib/server/expenses-list";
import ExpensesPageClient from "./ExpensesPageClient";

export default async function ExpensesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const { data } = await listExpensesForSession(session, { pageSize: 200, page: 1 });
  const initialExpenses = JSON.parse(JSON.stringify(data));

  return <ExpensesPageClient initialExpenses={initialExpenses} />;
}

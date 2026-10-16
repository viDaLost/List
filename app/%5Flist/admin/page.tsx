import { notFound } from "next/navigation";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { isAdminUser } from "@/lib/operations";
import AdminPanel from "@/app/components/admin-panel";
export const dynamic = "force-dynamic";
export const metadata = { title: "Управление Листом", robots: { index: false, follow: false } };
export default async function AdminPage() {
  const user = await requireChatGPTUser("/_list/admin");
  if (!isAdminUser(user)) notFound();
  return <AdminPanel />;
}

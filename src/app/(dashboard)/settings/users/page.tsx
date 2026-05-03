import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth";
import { listUsers } from "./actions";
import { UsersAdminPanel } from "@/components/settings/users-admin-panel";

export const metadata = {
  title: "Usuarios · Configuración",
};

export default async function UsersAdminPage() {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    redirect("/settings");
  }

  const users = await listUsers();

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="Configuración"
          title="Usuarios"
          description="Invita compañeros, ajusta sus permisos y administra el acceso a la correduría."
        />
        <UsersAdminPanel initialUsers={users} currentUserId={user.id} />
      </div>
    </div>
  );
}

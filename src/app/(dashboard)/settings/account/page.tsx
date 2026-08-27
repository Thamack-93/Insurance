import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { requireOrganizationContext } from "@/lib/organization-context";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { roleLabel } from "@/lib/ui-labels";

export const metadata = {
  title: "Mi cuenta · Configuración",
};

export default async function MyAccountPage() {
  const user = await requireUser();
  const organization = await requireOrganizationContext();

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHeader
          eyebrow="Configuración"
          title="Mi cuenta"
          description="Revisa tus datos y actualiza tu contraseña."
        />
        <Card>
          <CardHeader>
            <CardTitle>Datos de la cuenta</CardTitle>
            <CardDescription>
              {user.name} · {user.email} · {roleLabel(organization.membershipRole)}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Si necesitas cambiar tu nombre, correo o rol, pídeselo a un Administrador.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cambiar contraseña</CardTitle>
            <CardDescription>
              La nueva contraseña debe tener al menos 8 caracteres y combinar letras y números.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

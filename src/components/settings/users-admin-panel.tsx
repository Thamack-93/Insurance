"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, KeyRound, ShieldCheck, UserPlus, UserX, UserCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  inviteUser,
  changeUserRole,
  setUserActive,
  resetUserPassword,
  deleteUser,
  type AdminUserRow,
} from "@/app/(dashboard)/settings/users/actions";
import type { UserRole } from "@/lib/auth";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-MX", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function UsersAdminPanel({
  initialUsers,
  currentUserId,
  canResetPasswords,
}: {
  initialUsers: AdminUserRow[];
  currentUserId: string;
  canResetPasswords: boolean;
}) {
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [tempCredential, setTempCredential] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("AGENT");
  const [deleteTarget, setDeleteTarget] = useState<AdminUserRow | null>(null);
  const [replacementUserId, setReplacementUserId] = useState("");

  function refresh() {
    router.refresh();
  }

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await inviteUser({ name, email, role });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setTempCredential({ email, password: result.tempPassword });
      setInviteOpen(false);
      setName("");
      setEmail("");
      setRole("AGENT");
      refresh();
    });
  }

  function handleRoleChange(userId: string, value: UserRole) {
    startTransition(async () => {
      const result = await changeUserRole(userId, value);
      if (result.ok) {
        toast.success(result.message);
        refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleToggleActive(user: AdminUserRow) {
    startTransition(async () => {
      const result = await setUserActive(user.id, !user.active);
      if (result.ok) {
        toast.success(result.message);
        refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleReset(user: AdminUserRow) {
    if (!confirm(`¿Generar una nueva contraseña temporal para ${user.email}?`)) return;
    startTransition(async () => {
      const result = await resetUserPassword(user.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setTempCredential({ email: user.email, password: result.tempPassword });
    });
  }

  function handleDelete() {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteUser(deleteTarget.id, replacementUserId || undefined);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setDeleteTarget(null);
      setReplacementUserId("");
      refresh();
    });
  }

  async function copyCredential() {
    if (!tempCredential) return;
    try {
      await navigator.clipboard.writeText(
        `${tempCredential.email} / ${tempCredential.password}`,
      );
      toast.success("Credenciales copiadas.");
    } catch {
      toast.error("No se pudo copiar al portapapeles.");
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Equipo</CardTitle>
            <CardDescription>
              {initialUsers.length} usuario{initialUsers.length !== 1 ? "s" : ""} con acceso a la correduría.
            </CardDescription>
          </div>
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-2 size-4" />
            Invitar usuario
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Correo</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Último ingreso</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialUsers.map((user) => {
                  const isMe = user.id === currentUserId;
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        {user.name}
                        {isMe ? <span className="ml-2 text-xs text-muted-foreground">(tú)</span> : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell>
                        <Select
                          value={user.role}
                          onValueChange={(v) => handleRoleChange(user.id, v as UserRole)}
                          disabled={pending || user.role === "OWNER"}
                        >
                          <SelectTrigger className="w-[160px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {user.role === "OWNER" ? <SelectItem value="OWNER">Owner</SelectItem> : null}
                            <SelectItem value="ADMIN">Administrador</SelectItem>
                            <SelectItem value="AGENT">Agente</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {user.active ? (
                          <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
                            Activo
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-stone-200 text-stone-600">
                            Inactivo
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtDate(user.lastLoginAt)}
                      </TableCell>
                      <TableCell className="space-x-1 text-right">
                        {canResetPasswords ? <Button
                          variant="outline"
                          size="sm"
                          disabled={pending || isMe || user.role === "OWNER"}
                          onClick={() => handleReset(user)}
                          title={isMe || user.role === "OWNER" ? "El Owner no puede resetearse a sí mismo" : "Resetear contraseña"}
                        >
                          <KeyRound className="size-4" />
                        </Button> : null}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending || isMe}
                          onClick={() => handleToggleActive(user)}
                          title={user.active ? "Desactivar" : "Activar"}
                        >
                          {user.active ? <UserX className="size-4" /> : <UserCheck className="size-4" />}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending || isMe || user.active}
                          onClick={() => {
                            setDeleteTarget(user);
                            setReplacementUserId("");
                          }}
                          title={user.active ? "Desactiva antes de eliminar" : "Eliminar usuario"}
                          aria-label={user.active ? "Desactiva antes de eliminar" : "Eliminar usuario"}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {initialUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      No hay usuarios todavía.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invitar usuario</DialogTitle>
            <DialogDescription>
              Generaremos una contraseña temporal para que puedas compartirla.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="invite-name">Nombre</Label>
              <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="invite-email">Correo</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="invite-role">Rol</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">Administrador</SelectItem>
                  <SelectItem value="AGENT">Agente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                <ShieldCheck className="mr-2 size-4" />
                {pending ? "Invitando…" : "Crear usuario"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setReplacementUserId("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar usuario</DialogTitle>
            <DialogDescription>
              Esta acción elimina la cuenta, pero conserva clientes, pólizas, recibos, pagos y operaciones.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget ? (
            <div className="space-y-4">
              <p className="text-sm">
                Confirma la eliminación de <strong>{deleteTarget.name}</strong> ({deleteTarget.email}).
              </p>
              {deleteTarget.portfolioClients > 0 ? (
                <div className="space-y-2">
                  <Label htmlFor="delete-replacement">Reasignar cartera</Label>
                  <Select value={replacementUserId} onValueChange={(value) => setReplacementUserId(value ?? "")}>
                    <SelectTrigger id="delete-replacement">
                      <SelectValue placeholder="Selecciona un usuario activo" />
                    </SelectTrigger>
                    <SelectContent>
                      {initialUsers
                        .filter((candidate) => candidate.id !== deleteTarget.id && candidate.active)
                        .map((candidate) => (
                          <SelectItem key={candidate.id} value={candidate.id}>
                            {candidate.name} · {candidate.email}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Se reasignarán {deleteTarget.portfolioClients} cliente{deleteTarget.portfolioClients === 1 ? "" : "s"}.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending || (Boolean(deleteTarget?.portfolioClients) && !replacementUserId)}
              onClick={handleDelete}
            >
              {pending ? "Eliminando…" : "Eliminar usuario"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={tempCredential !== null}
        onOpenChange={(open) => {
          if (!open) setTempCredential(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Contraseña temporal</DialogTitle>
            <DialogDescription>
              Compártela por un canal seguro. Solo la verás una vez.
            </DialogDescription>
          </DialogHeader>
          {tempCredential ? (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
              <div>
                <span className="text-muted-foreground">Correo:</span>{" "}
                <span className="font-medium">{tempCredential.email}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Contraseña:</span>{" "}
                <code className="rounded bg-background px-2 py-1 font-mono text-sm">
                  {tempCredential.password}
                </code>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTempCredential(null)}>
              Cerrar
            </Button>
            <Button onClick={copyCredential}>
              <Copy className="mr-2 size-4" />
              Copiar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}

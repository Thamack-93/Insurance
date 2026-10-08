"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bookmark, Check, ChevronDown, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/drawers/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listSavedQueueAction, saveSavedQueueAction, deleteSavedQueueAction } from "@/app/(dashboard)/saved-queues-actions";
import type { SavedQueue } from "@/lib/saved-queues";

export function SavedQueueControls({
  route,
  config,
  loadRoutes,
  compact = false,
}: {
  route: SavedQueue["route"];
  config: unknown;
  loadRoutes?: readonly SavedQueue["route"][];
  compact?: boolean;
}) {
  const [queues, setQueues] = useState<SavedQueue[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [updateSelected, setUpdateSelected] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const selectedQueue = queues.find((queue) => queue.id === selected);

  useEffect(() => {
    startTransition(async () => {
      const routes = loadRoutes ?? [route];
      const groups = await Promise.all(routes.map((savedRoute) => listSavedQueueAction(savedRoute)));
      const combined = groups.flat();
      setQueues(loadRoutes ? combined.filter((queue) => queue.route === "renewal-board" || queue.filters.view === "renewals") : combined);
    });
  }, [route, loadRoutes]);

  function openQueue(queue: SavedQueue) {
    setSelected(queue.id);
    const params = new URLSearchParams();
    if (queue.search) params.set("q", queue.search);
    for (const [key, value] of Object.entries(queue.filters ?? {})) if (value) params.set(key, value);
    if (queue.sort) params.set("sort", queue.sort);
    if (queue.dateWindow && queue.route === "operations") params.set("window", queue.dateWindow);
    if (queue.route === "operations" && params.get("view") === "renewals" && !params.has("mode")) params.set("mode", "list");
    if (queue.route === "renewal-board") params.set("view", "renewal-board");
    router.push(`/${queue.route === "renewal-board" ? "operations" : queue.route}${params.toString() ? `?${params}` : ""}`);
  }

  function save(update = false) {
    if (!name.trim()) return;
    startTransition(async () => {
      try {
        const saved = await saveSavedQueueAction(name, config, update ? selected : undefined);
        setQueues((current) => update
          ? current.map((queue) => queue.id === selected ? saved : queue)
          : [saved, ...current]);
        setSelected(saved.id);
        setName("");
        setSaveOpen(false);
        toast.success(update ? "Vista actualizada." : "Vista guardada.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo guardar la vista.");
      }
    });
  }

  function remove() {
    if (!selected) return;
    startTransition(async () => {
      try {
        await deleteSavedQueueAction(selected);
        setQueues((current) => current.filter((queue) => queue.id !== selected));
        setSelected("");
        setDeleteOpen(false);
        toast.success("Vista eliminada.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo eliminar la vista.");
      }
    });
  }

  if (!compact) {
    return <div className="flex flex-wrap items-center gap-2" aria-label="Colas guardadas">
      <Bookmark className="size-4 text-muted-foreground" aria-hidden="true" />
      <Select value={selected} onValueChange={(value) => setSelected(value ?? "")} disabled={pending}>
        <SelectTrigger className="w-48" aria-label="Colas guardadas"><SelectValue placeholder="Colas guardadas" /></SelectTrigger>
        <SelectContent>{queues.map((queue) => <SelectItem key={queue.id} value={queue.id}>{queue.name}</SelectItem>)}</SelectContent>
      </Select>
      <Button type="button" variant="outline" size="sm" onClick={() => selectedQueue && openQueue(selectedQueue)} disabled={pending || !selected}>Abrir</Button>
      <Input value={name} onChange={(event) => setName(event.target.value.slice(0, 80))} placeholder="Nombre" className="w-32" aria-label="Nombre de cola" />
      <Button type="button" variant="outline" size="sm" onClick={() => save(Boolean(selected))} disabled={pending || !name.trim()}>{selected ? "Actualizar" : "Guardar"}</Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteOpen(true)} disabled={pending || !selected} aria-label="Eliminar cola"><Trash2 className="size-4" /></Button>
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="¿Eliminar esta cola guardada?" description="Esta acción no se puede deshacer." confirmLabel="Eliminar" destructive onConfirm={remove} />
    </div>;
  }

  return (
    <>
      <div className="flex items-center gap-2" aria-label="Vistas guardadas">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button type="button" variant="outline" className="h-9 gap-2 px-3" disabled={pending} />}
          >
            <Bookmark className="size-4 text-muted-foreground" aria-hidden="true" />
            <span>Vistas</span>
            {selectedQueue ? <span className="hidden max-w-32 truncate text-muted-foreground sm:inline">· {selectedQueue.name}</span> : null}
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Vistas guardadas</DropdownMenuLabel>
            {queues.length ? queues.map((queue) => (
              <DropdownMenuItem key={queue.id} onClick={() => openQueue(queue)} className="min-h-9">
                <span className="min-w-0 flex-1 truncate">{queue.name}</span>
                {queue.id === selected ? <Check className="size-4 text-primary" aria-label="Vista actual" /> : null}
              </DropdownMenuItem>
            )) : <p className="px-2 py-2 text-sm text-muted-foreground">Aún no guardas vistas.</p>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { setName(""); setUpdateSelected(false); setSaveOpen(true); }} className="min-h-9">
              Guardar filtros actuales…
            </DropdownMenuItem>
            {selectedQueue ? (
              <>
                <DropdownMenuItem onClick={() => { setName(selectedQueue.name); setUpdateSelected(true); setSaveOpen(true); }} className="min-h-9">
                  Actualizar “{selectedQueue.name}”
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDeleteOpen(true)} variant="destructive" className="min-h-9">
                  <Trash2 className="size-4" />Eliminar “{selectedQueue.name}”
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{updateSelected ? "Actualizar vista" : "Guardar vista"}</DialogTitle>
            <DialogDescription>Guarda la búsqueda y los filtros actuales para volver a usarlos después.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, 80))}
            placeholder="Ej. Renovaciones de este mes"
            aria-label="Nombre de la vista"
            onKeyDown={(event) => { if (event.key === "Enter") save(updateSelected); }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSaveOpen(false)}>Cancelar</Button>
            <Button type="button" onClick={() => save(updateSelected)} disabled={pending || !name.trim()}>
              {updateSelected ? "Actualizar" : "Guardar vista"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="¿Eliminar esta vista guardada?"
        description={selectedQueue ? `Se eliminará “${selectedQueue.name}”. Esta acción no se puede deshacer.` : "Esta acción no se puede deshacer."}
        confirmLabel="Eliminar vista"
        destructive
        onConfirm={remove}
      />
    </>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bookmark, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listSavedQueueAction, saveSavedQueueAction, deleteSavedQueueAction } from "@/app/(dashboard)/saved-queues-actions";
import type { SavedQueue } from "@/lib/saved-queues";

export function SavedQueueControls({ route, config }: { route: SavedQueue["route"]; config: unknown }) {
  const [queues, setQueues] = useState<SavedQueue[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => { startTransition(async () => setQueues(await listSavedQueueAction(route))); }, [route]);

  function save() {
    if (!name.trim()) return;
    startTransition(async () => {
      try { const saved = await saveSavedQueueAction(name, config, selected || undefined); setQueues((current) => selected ? current.map((queue) => queue.id === selected ? saved : queue) : [saved, ...current]); setSelected(saved.id); setName(""); toast.success(selected ? "Cola actualizada." : "Cola guardada."); }
      catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar la cola."); }
    });
  }

  function open() {
    const queue = queues.find((item) => item.id === selected);
    if (!queue) return;
    const params = new URLSearchParams();
    if (queue.search) params.set("q", queue.search);
    for (const [key, value] of Object.entries(queue.filters ?? {})) if (value) params.set(key, value);
    if (queue.sort) params.set("sort", queue.sort);
    if (queue.dateWindow && queue.route === "operations") params.set("window", queue.dateWindow);
    if (queue.route === "renewal-board") params.set("view", "renewal-board");
    router.push(`/${queue.route === "renewal-board" ? "operations" : queue.route}${params.toString() ? `?${params}` : ""}`);
  }

  function remove() {
    if (!selected) return;
    startTransition(async () => { await deleteSavedQueueAction(selected); setQueues((current) => current.filter((queue) => queue.id !== selected)); setSelected(""); toast.success("Cola eliminada."); });
  }

  return <div className="flex flex-wrap items-center gap-2" aria-label="Colas guardadas">
    <Bookmark className="size-4 text-muted-foreground" aria-hidden="true" />
    <Select value={selected} onValueChange={(value) => setSelected(value ?? "")} disabled={pending}>
      <SelectTrigger className="w-48"><SelectValue placeholder="Colas guardadas" /></SelectTrigger>
      <SelectContent>{queues.map((queue) => <SelectItem key={queue.id} value={queue.id}>{queue.name}</SelectItem>)}</SelectContent>
    </Select>
    <Button type="button" variant="outline" size="sm" onClick={open} disabled={pending || !selected}>Abrir</Button>
    <Input value={name} onChange={(event) => setName(event.target.value.slice(0, 80))} placeholder="Nombre" className="w-32" aria-label="Nombre de cola" />
    <Button type="button" variant="outline" size="sm" onClick={save} disabled={pending || !name.trim()}>{selected ? "Actualizar" : "Guardar"}</Button>
    <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={pending || !selected} aria-label="Eliminar cola"><Trash2 className="size-4" /></Button>
  </div>;
}

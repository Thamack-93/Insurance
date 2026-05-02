"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useGlobalShortcuts } from "./use-global-shortcuts";

type ShortcutGroup = {
  label: string;
  items: Array<{ keys: string[]; description: string }>;
};

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: "Navegación",
    items: [
      { keys: ["g", "d"], description: "Ir a Dashboard" },
      { keys: ["g", "h"], description: "Ir a Hoy" },
      { keys: ["g", "c"], description: "Ir a Clientes" },
      { keys: ["g", "p"], description: "Ir a Pólizas" },
      { keys: ["g", "t"], description: "Ir a Pendientes" },
      { keys: ["g", "r"], description: "Ir a Recibos" },
      { keys: ["g", "s"], description: "Ir a Aseguradoras" },
      { keys: ["g", "q"], description: "Ir a Cotizaciones" },
      { keys: ["g", "x"], description: "Ir a Siniestros" },
    ],
  },
  {
    label: "Acciones",
    items: [
      { keys: ["n"], description: "Crear nuevo registro en la sección actual" },
      { keys: ["/"], description: "Enfocar búsqueda de la lista" },
      { keys: ["⌘", "K"], description: "Abrir paleta de comandos" },
      { keys: ["?"], description: "Mostrar esta ayuda" },
      { keys: ["Esc"], description: "Cerrar diálogos" },
    ],
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-7 items-center justify-center rounded-md border border-stone-300 bg-white px-1.5 py-0.5 text-[11px] font-medium text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  useGlobalShortcuts(() => setOpen(true));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Atajos de teclado</DialogTitle>
          <DialogDescription>
            Acelera tu operación con estos accesos rápidos.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 pt-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.label} className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li
                    key={item.description}
                    className="flex items-center justify-between gap-3 rounded-lg border border-stone-200/80 bg-stone-50/60 px-3 py-2 text-sm"
                  >
                    <span className="text-foreground">{item.description}</span>
                    <span className="flex items-center gap-1">
                      {item.keys.map((key, index) => (
                        <span key={`${item.description}-${key}-${index}`} className="flex items-center gap-1">
                          <Kbd>{key}</Kbd>
                          {index < item.keys.length - 1 ? (
                            <span className="text-xs text-muted-foreground">luego</span>
                          ) : null}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

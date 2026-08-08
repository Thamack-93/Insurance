"use client";

import { useState, useEffect, useCallback, useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Calculator,
  CheckSquare,
  Users,
  FolderKanban,
  ReceiptText,
  FileText,
  AlertTriangle,
  Sparkles,
  Plus,
  Clock,
} from "lucide-react";
import { CommandPalette, type CommandPaletteGroup } from "./command-palette";
import { EMPTY_RECENT_ITEMS, getRecentItems, RECENTLY_VIEWED_EVENT } from "@/lib/recently-viewed";
import type { SearchResult, SearchResultType } from "@/components/search/search-provider";
import { Highlight } from "@/components/search/highlight";
import { getUtilityNavigation, globalNavigation } from "@/lib/navigation";

const dynamicEntityIcon: Record<SearchResultType, React.ReactNode> = {
  client: <Users className="size-4" />,
  policy: <FolderKanban className="size-4" />,
  receipt: <ReceiptText className="size-4" />,
  workItem: <CheckSquare className="size-4" />,
  claim: <AlertTriangle className="size-4" />,
  quote: <Calculator className="size-4" />,
  insurer: <Building2 className="size-4" />,
  document: <FileText className="size-4" />,
};

const dynamicEntityLabel: Record<SearchResultType, string> = {
  client: "Clientes",
  policy: "Pólizas",
  receipt: "Recibos",
  workItem: "Pendientes",
  claim: "Siniestros",
  quote: "Cotizaciones",
  insurer: "Aseguradoras",
  document: "Documentos",
};

const groupOrder: SearchResultType[] = [
  "client",
  "policy",
  "receipt",
  "claim",
  "quote",
  "workItem",
  "insurer",
  "document",
];

function getServerRecentItems() {
  return EMPTY_RECENT_ITEMS;
}

export function CommandPaletteWrapper({ isAdmin = false }: { isAdmin?: boolean }) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const router = useRouter();
  const recentItems = useSyncExternalStore(
    useCallback((onStoreChange) => {
      if (typeof window === "undefined") return () => {};
      const handler = () => onStoreChange();
      window.addEventListener("storage", handler);
      window.addEventListener(RECENTLY_VIEWED_EVENT, handler);
      return () => {
        window.removeEventListener("storage", handler);
        window.removeEventListener(RECENTLY_VIEWED_EVENT, handler);
      };
    }, []),
    getRecentItems,
    getServerRecentItems,
  );

  const handleSelect = useCallback((href: string) => {
    router.push(href);
    setOpen(false);
  }, [router]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    const openHandler = () => setOpen(true);
    document.addEventListener("keydown", down);
    window.addEventListener("pg:open-command-palette", openHandler);
    return () => {
      document.removeEventListener("keydown", down);
      window.removeEventListener("pg:open-command-palette", openHandler);
    };
  }, []);

  useEffect(() => {
    if (open) return;
    queueMicrotask(() => {
      setInputValue("");
      setSearchResults([]);
      setIsSearching(false);
    });
  }, [open]);

  // Debounced server search whenever the user types 2+ chars in the palette.
  useEffect(() => {
    const q = inputValue.trim();
    if (q.length < 2) {
      queueMicrotask(() => {
        setSearchResults([]);
        setIsSearching(false);
      });
      return;
    }
    const ctrl = new AbortController();
    queueMicrotask(() => setIsSearching(true));
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((data: SearchResult[]) => {
          setSearchResults(Array.isArray(data) ? data : []);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setSearchResults([]);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setIsSearching(false);
        });
    }, 220);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [inputValue]);

  const dynamicGroups = useMemo<CommandPaletteGroup[]>(() => {
    if (inputValue.trim().length < 2) return [];
    const buckets = new Map<SearchResultType, SearchResult[]>();
    for (const r of searchResults) {
      const arr = buckets.get(r.type) ?? [];
      arr.push(r);
      buckets.set(r.type, arr);
    }
    const out: CommandPaletteGroup[] = [];
    for (const t of groupOrder) {
      const items = buckets.get(t);
      if (!items?.length) continue;
      out.push({
        label: dynamicEntityLabel[t],
        items: items.map((r) => ({
          id: `search-${r.type}-${r.id}`,
          searchValue: `${r.title} ${r.subtitle ?? ""} ${r.match?.snippet ?? ""}`,
          label: <Highlight text={r.title} query={inputValue} />,
          description: (
            <span className="flex flex-col gap-0.5">
              {r.subtitle ? <span className="truncate">{r.subtitle}</span> : null}
              {r.match ? (
                <span className="truncate">
                  Coincidencia en {r.match.fieldLabel}: “
                  <Highlight text={r.match.snippet} query={inputValue} />”
                </span>
              ) : null}
            </span>
          ),
          icon: dynamicEntityIcon[t],
          onSelect: () => handleSelect(r.href),
        })),
      });
    }
    return out;
  }, [searchResults, inputValue, handleSelect]);

  const recentGroup: CommandPaletteGroup[] = recentItems.length > 0
    ? [{
        label: "Vistos recientemente",
        items: recentItems.map((item) => ({
          id: `recent-${item.id}`,
          label: item.label,
          description: item.type,
          icon: <Clock className="size-4" />,
          onSelect: () => handleSelect(item.href),
        })),
      }]
    : [];

  const staticGroups: CommandPaletteGroup[] = [
    {
      label: "PolicyDesk",
      items: globalNavigation.map((item) => {
        const Icon = item.icon;
        return {
          id: item.id,
          label: item.label,
          icon: <Icon className="size-4" />,
          onSelect: () => handleSelect(item.href),
        };
      }),
    },
    {
      label: "Acciones rápidas",
      items: [
        { id: "new-client", label: "Nuevo cliente", icon: <Plus className="size-4" />, onSelect: () => handleSelect("/clients/new") },
        { id: "new-policy", label: "Nueva póliza", icon: <Plus className="size-4" />, onSelect: () => handleSelect("/policies/new") },
        { id: "new-task", label: "Nuevo pendiente", icon: <Plus className="size-4" />, onSelect: () => handleSelect("/tasks/new") },
        { id: "new-receipt", label: "Nuevo recibo", icon: <Plus className="size-4" />, onSelect: () => handleSelect("/receipts/new") },
        { id: "new-quote", label: "Nueva cotización", icon: <Calculator className="size-4" />, onSelect: () => handleSelect("/quotes/new") },
      ],
    },
    {
      label: "Herramientas",
      items: [
        { id: "assistant", label: "Abrir workspace de Nora", icon: <Sparkles className="size-4" />, onSelect: () => handleSelect("/assistant") },
        ...getUtilityNavigation(isAdmin).map((item) => {
          const Icon = item.icon;
          return {
            id: item.id,
            label: item.label,
            icon: <Icon className="size-4" />,
            onSelect: () => handleSelect(item.href),
          };
        }),
      ],
    },
    ...recentGroup,
  ];

  // When the user is searching (2+ chars), show server results instead of
  // static navigation, and disable cmdk's local filter so we trust the server.
  const isDynamic = inputValue.trim().length >= 2;
  const groups = isDynamic
    ? dynamicGroups.length > 0
      ? dynamicGroups
      : isSearching
        ? [{ label: "Resultados", items: [{ id: "loading", label: "Buscando...", disabled: true }] }]
        : [{ label: "Resultados", items: [{ id: "empty", label: "Sin resultados", disabled: true }] }]
    : staticGroups;

  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      groups={groups}
      placeholder="Buscar páginas, clientes, pólizas, documentos..."
      title="Paleta de comandos"
      description="Navegación rápida y acciones de PolicyDesk"
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      shouldFilter={!isDynamic}
    />
  );
}

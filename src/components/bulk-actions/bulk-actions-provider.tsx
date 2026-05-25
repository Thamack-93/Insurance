"use client";

import { createContext, useContext, useState, useCallback } from "react";

type BulkActionsContextType = {
  selectedItems: Set<string>;
  isAllSelected: boolean;
  hasSelection: boolean;
  toggleItem: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  getSelectedIds: () => string[];
};

const BulkActionsContext = createContext<BulkActionsContextType | undefined>(undefined);

export function BulkActionsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const toggleItem = useCallback((id: string) => {
    setSelectedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedItems(new Set(ids));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedItems(new Set());
  }, []);

  const getSelectedIds = useCallback(() => {
    return Array.from(selectedItems);
  }, [selectedItems]);

  const isAllSelected = selectedItems.size > 0;
  const hasSelection = selectedItems.size > 0;

  return (
    <BulkActionsContext.Provider
      value={{
        selectedItems,
        isAllSelected,
        hasSelection,
        toggleItem,
        selectAll,
        clearSelection,
        getSelectedIds,
      }}
    >
      {children}
    </BulkActionsContext.Provider>
  );
}

export function useBulkActions() {
  const context = useContext(BulkActionsContext);
  if (context === undefined) {
    throw new Error("useBulkActions must be used within a BulkActionsProvider");
  }
  return context;
}

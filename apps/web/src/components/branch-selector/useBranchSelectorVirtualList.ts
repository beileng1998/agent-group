import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef } from "react";

import { getCurrentBranchChangeSummary } from "./branchSelectorValues";
import type { BranchSelectorReadModel } from "./useBranchSelectorReadModel";

interface BranchSelectorVirtualListInput {
  isBranchMenuOpen: boolean;
  readModel: BranchSelectorReadModel;
}

export function useBranchSelectorVirtualList(input: BranchSelectorVirtualListInput) {
  const { isBranchMenuOpen, readModel } = input;
  const branchListScrollElementRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: readModel.filteredBranchPickerItems.length,
    estimateSize: (index) => {
      const itemValue = readModel.filteredBranchPickerItems[index];
      if (!itemValue) return 28;
      if (itemValue === readModel.checkoutPullRequestItemValue) return 44;
      const branch = readModel.branchByName.get(itemValue);
      return branch && getCurrentBranchChangeSummary(branch, readModel.branchStatusQuery.data)
        ? 48
        : 28;
    },
    getScrollElement: () => branchListScrollElementRef.current,
    overscan: 12,
    enabled: isBranchMenuOpen && readModel.shouldVirtualizeBranchList,
    initialRect: { height: 224, width: 0 },
  });
  const setBranchListRef = useCallback(
    (element: HTMLDivElement | null) => {
      branchListScrollElementRef.current =
        (element?.parentElement as HTMLDivElement | null) ?? null;
      if (element) virtualizer.measure();
    },
    [virtualizer],
  );

  useEffect(() => {
    if (!isBranchMenuOpen || !readModel.shouldVirtualizeBranchList) return;
    queueMicrotask(() => virtualizer.measure());
  }, [
    isBranchMenuOpen,
    readModel.branchStatusQuery.data,
    readModel.filteredBranchPickerItems.length,
    readModel.shouldVirtualizeBranchList,
    virtualizer,
  ]);

  return {
    setBranchListRef,
    virtualBranchRows: virtualizer.getVirtualItems(),
    virtualizer,
  };
}

export type BranchSelectorVirtualList = ReturnType<typeof useBranchSelectorVirtualList>;

import { ChevronDownIcon, PlusIcon } from "~/lib/icons";
import { CentralIcon } from "~/lib/central-icons";
import type { CSSProperties } from "react";

import {
  ENVIRONMENT_ROW_CLASS_NAME,
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentRowBody,
  EnvironmentRowChevron,
} from "../chat/environment/EnvironmentRow";
import { COMPOSER_TOOLBAR_PICKER_TRIGGER_CLASS_NAME } from "../chat/composerPickerStyles";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "../ui/combobox";
import { BranchSelectorDialogs } from "./BranchSelectorDialogs";
import { BranchSelectorRow } from "./BranchSelectorRow";
import type { BranchToolbarBranchSelectorProps } from "./branchSelectorTypes";
import { getBranchTriggerLabel, getCreateBranchActionLabel } from "./branchSelectorValues";
import type { BranchSelectorController } from "./useBranchSelectorController";

interface BranchSelectorSurfaceProps {
  controller: BranchSelectorController;
  props: BranchToolbarBranchSelectorProps;
}

export function BranchSelectorSurface({ controller, props }: BranchSelectorSurfaceProps) {
  const { readModel, virtualList } = controller;
  const isPanel = props.variant === "panel";
  const triggerLabel = getBranchTriggerLabel({
    activeWorktreePath: props.activeWorktreePath,
    effectiveEnvMode: props.effectiveEnvMode,
    resolvedActiveBranch: controller.resolvedActiveBranch,
  });
  const renderRow = (itemValue: string, index: number, style?: CSSProperties) => (
    <BranchSelectorRow
      activeProjectCwd={props.activeProjectCwd}
      controller={controller}
      index={index}
      itemValue={itemValue}
      key={itemValue}
      onCheckoutPullRequestRequest={props.onCheckoutPullRequestRequest}
      onComposerFocusRequest={props.onComposerFocusRequest}
      {...(style ? { style } : {})}
    />
  );

  return (
    <Combobox
      items={readModel.branchPickerItems}
      filteredItems={readModel.filteredBranchPickerItems}
      autoHighlight
      virtualized={readModel.shouldVirtualizeBranchList}
      onItemHighlighted={(_value, eventDetails) => {
        if (!controller.isBranchMenuOpen || eventDetails.index < 0) return;
        virtualList.virtualizer.scrollToIndex(eventDetails.index, { align: "auto" });
      }}
      onOpenChange={controller.handleOpenChange}
      open={controller.isBranchMenuOpen}
      value={controller.resolvedActiveBranch}
    >
      <ComboboxTrigger
        className={
          isPanel
            ? ENVIRONMENT_ROW_CLASS_NAME
            : `${COMPOSER_TOOLBAR_PICKER_TRIGGER_CLASS_NAME} disabled:cursor-not-allowed disabled:opacity-50`
        }
        disabled={
          (readModel.branchesQuery.isLoading && readModel.branches.length === 0) ||
          controller.isBranchActionPending
        }
      >
        {isPanel ? (
          <EnvironmentRowBody
            icon={<CentralIcon name="branch" className={ENVIRONMENT_ROW_ICON_CLASS_NAME} />}
            label={triggerLabel}
            trailing={<EnvironmentRowChevron />}
          />
        ) : (
          <>
            <CentralIcon name="branch" className="size-3.5 shrink-0" />
            <span className="max-w-[240px] truncate">{triggerLabel}</span>
            <ChevronDownIcon className="size-3 opacity-60" />
          </>
        )}
      </ComboboxTrigger>
      <ComboboxPopup align="end" side={isPanel ? "bottom" : "top"} className="w-80">
        <div className="border-b p-1">
          <ComboboxInput
            className="rounded-xl border-[color:var(--color-border)] bg-[var(--color-background-control-opaque)] shadow-none before:hidden has-focus-visible:border-[color:var(--color-border-focus)] has-focus-visible:ring-0 [&_input]:font-sans"
            inputClassName="ring-0"
            placeholder="Search branches..."
            showTrigger={false}
            size="sm"
            value={controller.branchQuery}
            onChange={(event) => controller.setBranchQuery(event.target.value)}
          />
        </div>
        <ComboboxEmpty>No branches found.</ComboboxEmpty>
        <ComboboxList ref={virtualList.setBranchListRef} className="max-h-56">
          {readModel.shouldVirtualizeBranchList ? (
            <div
              className="relative"
              style={{ height: `${virtualList.virtualizer.getTotalSize()}px` }}
            >
              {virtualList.virtualBranchRows.map((virtualRow) => {
                const itemValue = readModel.filteredBranchPickerItems[virtualRow.index];
                if (!itemValue) return null;
                return renderRow(itemValue, virtualRow.index, {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                });
              })}
            </div>
          ) : (
            readModel.filteredBranchPickerItems.map((itemValue, index) =>
              renderRow(itemValue, index),
            )
          )}
        </ComboboxList>
        {!readModel.isSelectingWorktreeBase ? (
          <div className="border-t border-[color:var(--color-border-light)] p-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--color-text-foreground)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={controller.isBranchActionPending}
              onClick={controller.openCreateBranchDialog}
            >
              <PlusIcon className="size-3.5 shrink-0" />
              <span className="truncate">
                {getCreateBranchActionLabel(readModel.trimmedBranchQuery)}
              </span>
            </button>
          </div>
        ) : null}
      </ComboboxPopup>
      <BranchSelectorDialogs controller={controller} />
    </Combobox>
  );
}

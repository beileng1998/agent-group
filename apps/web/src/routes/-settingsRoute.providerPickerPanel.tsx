import type { ProviderKind } from "@agent-group/contracts";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";

import { SettingResetButton } from "../components/settings/SettingControls";
import { SettingsRow, SettingsSection } from "../components/settings/SettingsPanelPrimitives";
import { pluralize } from "@agent-group/shared/text";
import {
  PROVIDER_VISIBILITY_OPTIONS,
  setProviderHidden,
  SortableProviderVisibilityRow,
} from "./-settingsRoute.options";

export interface ProviderPickerSettingsPanelProps {
  providerOrder: ReadonlyArray<ProviderKind>;
  hiddenProviders: ReadonlyArray<ProviderKind>;
  isProviderOrderDirty: boolean;
  onProviderOrderChange: (providerOrder: ProviderKind[]) => void;
  onHiddenProvidersChange: (hiddenProviders: ProviderKind[]) => void;
  onReset: () => void;
}

export function ProviderPickerSettingsPanel(props: ProviderPickerSettingsPanelProps) {
  const hiddenProviderSet = new Set<ProviderKind>(props.hiddenProviders);
  const hiddenProviderCount = hiddenProviderSet.size;
  const optionByProvider = new Map(
    PROVIDER_VISIBILITY_OPTIONS.map((option) => [option.provider, option]),
  );
  const orderedOptions = props.providerOrder.flatMap((provider) => {
    const option = optionByProvider.get(provider);
    return option ? [option] : [];
  });
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const fromIndex = props.providerOrder.indexOf(active.id as ProviderKind);
    const toIndex = props.providerOrder.indexOf(over.id as ProviderKind);
    if (fromIndex < 0 || toIndex < 0) {
      return;
    }
    props.onProviderOrderChange(arrayMove([...props.providerOrder], fromIndex, toIndex));
  };

  return (
    <SettingsSection title="Provider picker">
      <SettingsRow
        title="Visible providers"
        description="Drag providers into your preferred picker order and hide the ones you don't use. The provider you're currently using on a thread always stays visible."
        status={
          hiddenProviderCount > 0
            ? `${hiddenProviderCount} ${pluralize(hiddenProviderCount, "provider")} hidden`
            : props.isProviderOrderDirty
              ? "Custom order"
              : "All providers visible"
        }
        resetAction={
          hiddenProviderCount > 0 || props.isProviderOrderDirty ? (
            <SettingResetButton label="provider picker" onClick={props.onReset} />
          ) : null
        }
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={orderedOptions.map((option) => option.provider)}
            strategy={verticalListSortingStrategy}
          >
            <div className="mt-4 space-y-2">
              {orderedOptions.map((option) => (
                <SortableProviderVisibilityRow
                  key={option.provider}
                  option={option}
                  isHidden={hiddenProviderSet.has(option.provider)}
                  onHiddenChange={(hidden) =>
                    props.onHiddenProvidersChange(
                      setProviderHidden(props.hiddenProviders, option.provider, hidden),
                    )
                  }
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </SettingsRow>
    </SettingsSection>
  );
}

// FILE: ComposerModelControls.tsx
// Purpose: Render loading, split, or combined model/trait controls in the composer footer.
// Layer: Chat composer UI

import type { ComponentProps } from "react";

import { ComposerModelEffortPicker } from "./ComposerModelEffortPicker";
import { ComposerControlSkeleton, ComposerModelLoadingControl } from "./ComposerLoadingControls";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { TraitsPicker } from "./TraitsPicker";

export type ComposerModelControlsModel =
  | {
      kind: "loading";
      layout: "split" | "combined";
      compact: boolean;
      modelDiscoveryPending: boolean;
    }
  | {
      kind: "split";
      modelPicker: ComponentProps<typeof ProviderModelPicker>;
      traitsPicker: ComponentProps<typeof TraitsPicker>;
    }
  | {
      kind: "combined";
      picker: ComponentProps<typeof ComposerModelEffortPicker>;
    };

export function ComposerModelControls({ model }: { model: ComposerModelControlsModel }) {
  if (model.kind === "loading") {
    if (model.layout === "split") {
      const modelWidth = model.compact ? "w-32" : "w-36 sm:w-44";
      const optionsWidth = model.compact ? "w-28" : "w-32";
      return (
        <>
          {model.modelDiscoveryPending ? (
            <ComposerModelLoadingControl widthClassName={modelWidth} />
          ) : (
            <ComposerControlSkeleton widthClassName={modelWidth} />
          )}
          <ComposerControlSkeleton widthClassName={optionsWidth} />
        </>
      );
    }
    const width = model.compact ? "w-40" : "w-44 sm:w-52";
    return model.modelDiscoveryPending ? (
      <ComposerModelLoadingControl widthClassName={width} />
    ) : (
      <ComposerControlSkeleton widthClassName={width} />
    );
  }
  if (model.kind === "split") {
    return (
      <>
        <ProviderModelPicker {...model.modelPicker} />
        <TraitsPicker {...model.traitsPicker} />
      </>
    );
  }
  return <ComposerModelEffortPicker {...model.picker} />;
}

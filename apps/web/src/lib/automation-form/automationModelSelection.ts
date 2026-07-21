import type {
  AutomationDefinition,
  ModelSelection,
  ProviderStartOptions,
} from "@agent-group/contracts";

import {
  defaultModelSelection,
  type AutomationFormState,
  type AutomationProjectModelSelectionSource,
} from "./automationFormTypes";

export function projectModelSelection(
  projects: readonly AutomationProjectModelSelectionSource[],
  projectId: string,
): ModelSelection {
  return (
    projects.find((project) => project.id === projectId)?.defaultModelSelection ??
    defaultModelSelection
  );
}

function modelSelectionsMatch(left: ModelSelection, right: ModelSelection): boolean {
  const leftOptions = "options" in left ? left.options : undefined;
  const rightOptions = "options" in right ? right.options : undefined;
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    JSON.stringify(leftOptions ?? null) === JSON.stringify(rightOptions ?? null)
  );
}

function modelIdentityMatches(left: ModelSelection, right: ModelSelection): boolean {
  return left.provider === right.provider && left.model === right.model;
}

/** Preserve saved options unless the provider/model identity changes. */
export function providerOptionsForAutomationModelSelection(
  definition: Pick<AutomationDefinition, "modelSelection" | "providerOptions">,
  nextModelSelection: ModelSelection,
  currentProviderOptions?: ProviderStartOptions,
): ProviderStartOptions | undefined {
  return modelIdentityMatches(definition.modelSelection, nextModelSelection)
    ? definition.providerOptions
    : (currentProviderOptions ?? {});
}

export function providerOptionsForAutomationEdit(
  definition: Pick<AutomationDefinition, "modelSelection" | "providerOptions">,
  form: Pick<AutomationFormState, "modelSelection">,
  currentProviderOptions?: ProviderStartOptions,
): ProviderStartOptions | undefined {
  return providerOptionsForAutomationModelSelection(
    definition,
    form.modelSelection,
    currentProviderOptions,
  );
}

export function modelSelectionForProjectChange(
  projects: readonly AutomationProjectModelSelectionSource[],
  currentProjectId: string,
  nextProjectId: string,
  currentModelSelection: ModelSelection,
): ModelSelection {
  const currentDefaultModelSelection = projectModelSelection(projects, currentProjectId);
  const nextDefaultModelSelection = projectModelSelection(projects, nextProjectId);
  return modelSelectionsMatch(currentModelSelection, currentDefaultModelSelection)
    ? nextDefaultModelSelection
    : currentModelSelection;
}

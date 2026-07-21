// FILE: automationDialogTypes.ts
// Purpose: Shared narrow contracts between automation dialog surfaces.
// Layer: Automation dialog

import type { AutomationFormState } from "~/lib/automationForm";

export type SetAutomationFormField = <K extends keyof AutomationFormState>(
  key: K,
  value: AutomationFormState[K],
) => void;

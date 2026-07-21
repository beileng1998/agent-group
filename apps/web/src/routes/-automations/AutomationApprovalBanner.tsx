// FILE: AutomationApprovalBanner.tsx
// Purpose: Presents one-time automation risk approval actions.
// Layer: Automation web feature

import type { AutomationDraftWarning } from "~/lib/automationDraft";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";

export function AutomationApprovalBanner({
  warnings,
  busy,
  onApprove,
  onApproveAndRun,
}: {
  readonly warnings: readonly AutomationDraftWarning[];
  readonly busy: boolean;
  readonly onApprove: () => void;
  readonly onApproveAndRun: () => void;
}) {
  if (warnings.length === 0) {
    return null;
  }
  return (
    <Alert variant="warning">
      <AlertTitle>Approval needed</AlertTitle>
      <AlertDescription>
        <span>
          This automation needs your approval once before Agent Group can save changes. When a
          warning blocks manual runs, Run now stays disabled until you approve it.
        </span>
        <ul className="flex flex-col gap-1.5">
          {warnings.map((warning) => (
            <li key={warning.id} className="text-xs">
              <span className="font-medium text-foreground/90">{warning.title}</span>
              <span className="block">{warning.detail}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onApprove}>
            Approve
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={onApproveAndRun}>
            Approve &amp; run now
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

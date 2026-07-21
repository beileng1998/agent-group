// FILE: OpenSourceLicensesDialog.tsx
// Purpose: Show the project, upstream, and third-party distribution notices offline.
// Layer: Settings overlay

import licenseText from "../../../../LICENSE?raw";
import noticeText from "../../../../NOTICE.md?raw";
import thirdPartyNoticesText from "../../../../THIRD_PARTY_NOTICES.md?raw";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

const NOTICE_SECTIONS = [
  { title: "Agent Group and Agent Group", contents: noticeText },
  { title: "MIT License", contents: licenseText },
  { title: "Third-party components", contents: thirdPartyNoticesText },
] as const;

export function OpenSourceLicensesDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-2xl gap-0 p-0" surface="solid">
        <DialogHeader className="gap-1 p-4 pr-12">
          <DialogTitle className="text-base">Open source licenses</DialogTitle>
          <DialogDescription className="text-xs">
            Copyright, upstream attribution, and third-party distribution notices.
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="max-h-[min(68vh,620px)] space-y-5 px-4 py-3">
          {NOTICE_SECTIONS.map((section) => (
            <section key={section.title} className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">{section.title}</h3>
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                {section.contents.trim()}
              </pre>
            </section>
          ))}
        </DialogPanel>

        <DialogFooter>
          <Button size="sm" onClick={() => props.onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

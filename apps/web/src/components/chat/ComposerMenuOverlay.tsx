// FILE: ComposerMenuOverlay.tsx
// Purpose: Render the active composer command or local-directory picker overlay.
// Layer: Chat composer UI

import type { ComponentProps } from "react";

import { ComposerCommandMenu } from "./ComposerCommandMenu";
import { ComposerLocalDirectoryMenu } from "./ComposerLocalDirectoryMenu";
import { COMPOSER_COMMAND_MENU_FLOATING_WRAPPER_CLASS_NAME } from "./composerPickerStyles";

export type ComposerMenuOverlayModel =
  | {
      kind: "local-directory";
      props: ComponentProps<typeof ComposerLocalDirectoryMenu>;
    }
  | {
      kind: "commands";
      props: ComponentProps<typeof ComposerCommandMenu>;
    }
  | null;

export function ComposerMenuOverlay({ model }: { model: ComposerMenuOverlayModel }) {
  if (!model) return null;
  return (
    <div className={COMPOSER_COMMAND_MENU_FLOATING_WRAPPER_CLASS_NAME}>
      {model.kind === "local-directory" ? (
        <ComposerLocalDirectoryMenu {...model.props} />
      ) : (
        <ComposerCommandMenu {...model.props} />
      )}
    </div>
  );
}

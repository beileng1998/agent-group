import { memo } from "react";
import { LocalDirectoryMenuSurface } from "./LocalDirectoryMenuSurface";
import type { ComposerLocalDirectoryMenuProps } from "./localDirectoryTypes";
import { useLocalDirectoryMenuController } from "./useLocalDirectoryMenuController";

export const ComposerLocalDirectoryMenu = memo(function ComposerLocalDirectoryMenu(
  props: ComposerLocalDirectoryMenuProps,
) {
  const controller = useLocalDirectoryMenuController(props);
  return <LocalDirectoryMenuSurface controller={controller} />;
});

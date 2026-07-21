// FILE: editorAppIcons.ts
// Purpose: Expose cached native editor app icons through a stable server API.
// Layer: Server HTTP utility facade

export { EDITOR_ICON_ROUTE_PATH } from "@agent-group/shared/editorIcons";

export {
  clearEditorIconInFlightCache,
  resolveCachedEditorIcon,
} from "./editor-app-icons/editorIconCache";
export type { CachedEditorIcon } from "./editor-app-icons/editorIconShared";

// Compatibility facade for tool-call timeline labels. Domain logic lives in tool-call-label/.
export {
  deriveInlineCommandCall,
  deriveReadableCommandDisplay,
  isInspectCommand,
  resolveCommandVisualKind,
} from "./tool-call-label/commandDisplay";
export { isGenericToolTitle, normalizeCompactToolLabel } from "./tool-call-label/normalization";
export { deriveReadableToolTitle } from "./tool-call-label/toolTitle";
export type {
  CommandVisualKind,
  ReadableCommandDisplay,
  ReadableToolTitleInput,
} from "./tool-call-label/types";
export { extractWebFetchUrl } from "./tool-call-label/webFetch";

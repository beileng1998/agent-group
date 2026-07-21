import type { EditorIconSource, EditorIconSourceInput } from "./editorIconShared";
import { resolveLinuxEditorIconSource } from "./linuxEditorIconSource";
import { resolveMacEditorIconSource } from "./macEditorIconSource";
import { resolveWindowsEditorIconSource } from "./windowsEditorIconSource";

export async function resolveEditorIconSource(
  input: EditorIconSourceInput,
): Promise<EditorIconSource | null> {
  return (
    (await resolveMacEditorIconSource(input)) ??
    (await resolveLinuxEditorIconSource(input)) ??
    (await resolveWindowsEditorIconSource(input))
  );
}

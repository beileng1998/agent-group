import type { ProviderRuntimeEvent } from "@agent-group/contracts";

export function isProviderChildRuntimeEvent(event: ProviderRuntimeEvent): boolean {
  const providerThreadId = event.providerRefs?.providerThreadId?.trim();
  const providerParentThreadId = event.providerRefs?.providerParentThreadId?.trim();
  return (
    providerThreadId !== undefined &&
    providerThreadId.length > 0 &&
    providerParentThreadId !== undefined &&
    providerParentThreadId.length > 0 &&
    providerThreadId !== providerParentThreadId
  );
}

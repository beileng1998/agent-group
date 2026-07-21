import type { NativeApiOrchestrationDomains } from "./nativeApiOrchestrationDomains";
import type { NativeApiRepositoryDomains } from "./nativeApiRepositoryDomains";
import type { NativeApiServiceDomains } from "./nativeApiServiceDomains";
import type { NativeApiWorkspaceDomains } from "./nativeApiWorkspaceDomains";

export interface NativeApi
  extends
    NativeApiWorkspaceDomains,
    NativeApiRepositoryDomains,
    NativeApiServiceDomains,
    NativeApiOrchestrationDomains {}

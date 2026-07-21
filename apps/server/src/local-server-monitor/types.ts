// FILE: local-server-monitor/types.ts
// Purpose: Shared local-server discovery records and classification input contracts.
// Layer: Server runtime utility domain types.

import type { ServerLocalServerAddress } from "@agent-group/contracts";

export const PROCESS_LINEAGE_MAX_DEPTH = 4;

export interface ParsedLsofListener {
  readonly pid: number;
  readonly command: string;
  readonly protocol: "tcp";
  readonly host: string;
  readonly port: number;
  readonly family: ServerLocalServerAddress["family"];
}

export interface LocalServerProcessInfo {
  readonly ppid: number;
  readonly commandLine: string;
}

export interface DevServerCandidateInput {
  readonly command: string;
  readonly args: string;
  readonly ports: readonly number[];
}

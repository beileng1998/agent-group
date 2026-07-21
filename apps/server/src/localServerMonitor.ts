// FILE: localServerMonitor.ts
// Purpose: Stable public facade for local development server discovery and stop operations.
// Layer: Server runtime utility used by the WebSocket RPC layer.

export {
  enrichLocalServerProcessesWithPageTitles,
  extractLocalServerPageTitle,
} from "./local-server-monitor/pageTitles";
export {
  isIgnoredLocalServerProcess,
  isLikelyDevServerProcess,
} from "./local-server-monitor/processClassification";
export {
  parseLsofCwdOutput,
  parseLsofTcpListenOutput,
} from "./local-server-monitor/processParsing";
export { buildLocalServerProcesses } from "./local-server-monitor/processProjection";
export { listLocalServers, stopLocalServer } from "./local-server-monitor/runtime";
export type { LocalServerProcessInfo, ParsedLsofListener } from "./local-server-monitor/types";

import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { TerminalAgentBridgeHandler } from "../terminalAgentBridgeServer";

export interface TerminalAgentBridgeRegistration {
  readonly token: string;
  readonly pause: () => Promise<void>;
  readonly resume: () => void;
  readonly unregister: () => void;
}

export interface TerminalAgentBridgeShape {
  readonly endpoint: string;
  readonly register: (
    runtimeInstanceId: string,
    handler: TerminalAgentBridgeHandler,
  ) => Effect.Effect<TerminalAgentBridgeRegistration, Error>;
}

export class TerminalAgentBridge extends ServiceMap.Service<
  TerminalAgentBridge,
  TerminalAgentBridgeShape
>()("agent-group/terminalAgent/Services/TerminalAgentBridge") {}

import { WsRpcGroup } from "@agent-group/contracts";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

export type WsRpcHandlers = RpcGroup.HandlersFrom<RpcGroup.Rpcs<typeof WsRpcGroup>>;

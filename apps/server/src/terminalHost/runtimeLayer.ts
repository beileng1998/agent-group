// FILE: runtimeLayer.ts
// Purpose: Layer composition for the managed-agent terminal host.
// Layer: Server terminal host composition

import { Layer } from "effect";

import { makeRuntimePtyAdapterLayer } from "../terminal/runtimeLayer";
import { TerminalHostServiceLive } from "./TerminalHostService";

export const TerminalHostLayerLive = TerminalHostServiceLive.pipe(
  Layer.provide(makeRuntimePtyAdapterLayer()),
);

import { Schema } from "effect";

export const RemoteAccessState = Schema.Literals([
  "disabled",
  "unavailable",
  "starting",
  "needs-login",
  "needs-approval",
  "ready",
  "error",
]);
export type RemoteAccessState = typeof RemoteAccessState.Type;

export const RemoteAccessTransport = Schema.Literals(["https", "http"]);
export type RemoteAccessTransport = typeof RemoteAccessTransport.Type;

export const RemoteAccessStatus = Schema.Struct({
  enabled: Schema.Boolean,
  state: RemoteAccessState,
  hostname: Schema.String,
  processName: Schema.String,
  url: Schema.optionalKey(Schema.String),
  authUrl: Schema.optionalKey(Schema.String),
  transport: Schema.optionalKey(RemoteAccessTransport),
  ipv4: Schema.optionalKey(Schema.String),
  dnsName: Schema.optionalKey(Schema.String),
  health: Schema.Array(Schema.String),
  message: Schema.optionalKey(Schema.String),
});
export type RemoteAccessStatus = typeof RemoteAccessStatus.Type;

// FILE: ChatViewSurface.tsx
// Purpose: Render the final ChatView surfaces from prepared models.
// Layer: Web chat view

import { cn } from "../../lib/utils";
import type { HTMLAttributes } from "react";
import { ChatDialogLayer, ChatOverlayLayer } from "./ChatOverlayLayer";
import { ChatHeaderSurface } from "./ChatHeaderSurface";
import { ChatWorkspaceSurface } from "./ChatWorkspaceSurface";
import { CHAT_BACKGROUND_CLASS_NAME } from "./composerPickerStyles";
import { ProviderHealthBanner } from "./ProviderHealthBanner";
import { RateLimitBanner } from "./RateLimitBanner";
import { ThreadErrorBanner } from "./ThreadErrorBanner";

type HeaderModel = Parameters<typeof ChatHeaderSurface>[0]["model"];
type DialogModel = Parameters<typeof ChatDialogLayer>[0]["model"];
type OverlayModel = Parameters<typeof ChatOverlayLayer>[0]["model"];
type WorkspaceModel = Parameters<typeof ChatWorkspaceSurface>[0]["model"];
type ProviderStatus = Parameters<typeof ProviderHealthBanner>[0]["status"];
type ThreadErrorProps = Parameters<typeof ThreadErrorBanner>[0];
type RateLimitStatus = Parameters<typeof RateLimitBanner>[0]["rateLimitStatus"];

export interface ChatViewSurfaceProps {
  readonly drag: {
    readonly active: boolean;
    readonly dropzone: Pick<
      HTMLAttributes<HTMLDivElement>,
      "onDragEnter" | "onDragLeave" | "onDragOver" | "onDrop"
    >;
  };
  readonly header: HeaderModel;
  readonly dialogs: DialogModel;
  readonly workspace: WorkspaceModel;
  readonly overlays: OverlayModel;
  readonly banners: {
    readonly providerStatus: ProviderStatus;
    readonly onDismissProvider: () => void;
    readonly threadError: ThreadErrorProps;
    readonly rateLimitStatus: RateLimitStatus;
    readonly onDismissRateLimit: () => void;
  };
}

export function ChatViewSurface(props: ChatViewSurfaceProps) {
  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        CHAT_BACKGROUND_CLASS_NAME,
      )}
      {...props.drag.dropzone}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 z-50 transition-opacity duration-150",
          "bg-info/8 ring-1 ring-inset ring-info/30",
          props.drag.active ? "opacity-100" : "opacity-0",
        )}
      />
      <ChatHeaderSurface model={props.header} />
      <ChatDialogLayer model={props.dialogs} />
      <ProviderHealthBanner
        status={props.banners.providerStatus}
        onDismiss={props.banners.onDismissProvider}
      />
      <ThreadErrorBanner {...props.banners.threadError} />
      <RateLimitBanner
        rateLimitStatus={props.banners.rateLimitStatus}
        onDismiss={props.banners.onDismissRateLimit}
      />
      <ChatWorkspaceSurface model={props.workspace} />
      <ChatOverlayLayer model={props.overlays} />
    </div>
  );
}

// FILE: AgentGroupLogo.tsx
// Purpose: Render the Agent Group mark as an inline SVG that follows theme foreground color.
// Layer: Shared app branding primitive

import type { SVGProps } from "react";
import {
  AGENT_GROUP_LOGO_BAR_RADIUS,
  AGENT_GROUP_LOGO_BARS,
} from "~/assets/agentGroupLogoGeometry";
import { cn } from "~/lib/utils";

export function AgentGroupLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  const ariaLabel = props["aria-label"];

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={ariaLabel ? undefined : true}
      {...props}
      className={cn("shrink-0 text-foreground", className)}
    >
      {AGENT_GROUP_LOGO_BARS.map((bar) => (
        <rect
          key={bar.y}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          rx={AGENT_GROUP_LOGO_BAR_RADIUS}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}

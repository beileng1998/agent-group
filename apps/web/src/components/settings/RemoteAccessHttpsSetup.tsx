import { Button } from "~/components/ui/button";

export function RemoteAccessHttpsSetup({
  busy,
  onOpenDnsSettings,
  onRecheck,
}: {
  readonly busy: boolean;
  readonly onOpenDnsSettings: () => void;
  readonly onRecheck: () => void;
}) {
  return (
    <aside className="mt-3 rounded-xl border border-warning/20 bg-warning/6 p-3 text-xs">
      <p className="font-medium text-foreground">Finish secure app setup</p>
      <p className="mt-1 max-w-2xl leading-5 text-muted-foreground">
        Enable MagicDNS and HTTPS Certificates for this Tailnet. Tailscale will publish the
        certificate hostname in public Certificate Transparency logs, while Agent Group remains
        reachable only inside your Tailnet.
      </p>
      <p className="mt-2 leading-5 text-muted-foreground">
        No certificate files or terminal commands are needed. Agent Group will check automatically
        when you return, or you can check again below.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={onOpenDnsSettings}>
          Open Tailscale DNS
        </Button>
        <Button size="sm" disabled={busy} onClick={onRecheck}>
          {busy ? "Checking…" : "I've enabled HTTPS"}
        </Button>
      </div>
    </aside>
  );
}

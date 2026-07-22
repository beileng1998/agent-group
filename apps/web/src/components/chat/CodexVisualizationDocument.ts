// FILE: CodexVisualizationDocument.ts
// Purpose: Build an isolated document around a Codex visualization fragment.
// Layer: Web chat visualization compatibility

const APPROVED_CDNS = [
  "https://cdnjs.cloudflare.com",
  "https://esm.sh",
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://fonts.bunny.net",
].join(" ");

const BASE_STYLES = String.raw`
:root {
  color-scheme: light;
  --font-size-base: 14px;
  --background: #ffffff; --foreground: #18181b; --card: #fafafa;
  --card-foreground: #18181b; --primary: #2563eb; --primary-foreground: #ffffff;
  --secondary: #f4f4f5; --secondary-foreground: #27272a; --muted: #f4f4f5;
  --muted-foreground: #71717a; --accent: #eff6ff; --accent-foreground: #1d4ed8;
  --popover: #ffffff; --popover-foreground: #18181b;
  --border: #e4e4e7; --input: #d4d4d8; --ring: #3b82f6; --destructive: #dc2626;
  --viz-series-1: #2563eb; --viz-series-2: #0d9488; --viz-series-3: #7c3aed;
  --viz-series-4: #ea580c; --viz-series-5: #db2777; --viz-series-6: #4f46e5;
  --chart-1: #2563eb; --chart-2: #0d9488; --chart-3: #7c3aed;
  --chart-4: #ea580c; --chart-5: #db2777;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --background: #111113; --foreground: #f4f4f5; --card: #18181b;
  --card-foreground: #f4f4f5; --primary: #60a5fa; --primary-foreground: #0c1222;
  --secondary: #27272a; --secondary-foreground: #f4f4f5; --muted: #27272a;
  --muted-foreground: #a1a1aa; --accent: #172554; --accent-foreground: #bfdbfe;
  --popover: #18181b; --popover-foreground: #f4f4f5;
  --border: #3f3f46; --input: #52525b; --ring: #60a5fa; --destructive: #f87171;
  --viz-series-1: #60a5fa; --viz-series-2: #2dd4bf; --viz-series-3: #a78bfa;
  --viz-series-4: #fb923c; --viz-series-5: #f472b6; --viz-series-6: #818cf8;
  --chart-1: #60a5fa; --chart-2: #2dd4bf; --chart-3: #a78bfa;
  --chart-4: #fb923c; --chart-5: #f472b6;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-width: 0; overflow-x: hidden; }
body {
  background: transparent; color: var(--foreground);
  font: 400 var(--font-size-base)/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", sans-serif; padding: 2px;
}
h1, h2, h3 { margin: 0; color: var(--foreground); font-weight: 500; line-height: 1.25; }
h1 { font-size: 1.35em; } h2 { font-size: 1.2em; } h3 { font-size: 1.08em; }
p { margin-block: 0.65em; }
button, input, select, textarea { color: inherit; font: inherit; }
button, a, input, select, textarea { outline-color: var(--ring); }
a { color: var(--primary); }
svg { display: block; max-width: 100%; }
.card { border: 1px solid var(--border); border-radius: 12px; background: var(--card); color: var(--card-foreground); }
.card-header, .card-content, .card-footer { padding: 14px 16px; }
.card-header + .card-content { padding-top: 0; }
.card-title { margin: 0; font-size: 1.05em; font-weight: 500; }
.card-description { margin: 4px 0 0; color: var(--muted-foreground); }
.viz-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr)); gap: 10px; }
.viz-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.viz-controls { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; margin-block: 10px; }
.viz-stat { min-width: 0; }
.viz-stat-value { margin-top: 3px; color: var(--card-foreground); font-size: 1.35em; font-weight: 500; font-variant-numeric: tabular-nums; }
.btn {
  display: inline-flex; min-height: 34px; align-items: center; justify-content: center; gap: 7px;
  border: 1px solid var(--border); border-radius: 8px; background: var(--secondary);
  color: var(--secondary-foreground); padding: 7px 11px; cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
}
.btn:hover { border-color: color-mix(in srgb, var(--foreground) 26%, var(--border)); }
.btn:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.btn-primary { border-color: var(--primary); background: var(--primary); color: var(--primary-foreground); }
.btn-ghost { border-color: transparent; background: transparent; }
.btn-block { width: 100%; }
.viz-tile { width: 100%; min-height: 72px; justify-content: flex-start; text-align: left; }
.viz-tile[aria-pressed="true"], .viz-tile[aria-selected="true"], .viz-tile.is-selected { box-shadow: 0 0 0 2px var(--ring); }
.viz-badge { display: inline-flex; align-items: center; border-radius: 999px; background: var(--accent); color: var(--accent-foreground); padding: 2px 8px; font-size: 0.86em; font-weight: 500; }
.form-label { display: grid; min-width: min(180px, 100%); gap: 5px; color: var(--muted-foreground); font-size: 12px; }
.form-control, .form-select {
  width: 100%; min-height: 34px; border: 1px solid var(--input); border-radius: 8px;
  background: var(--background); color: var(--foreground); padding: 6px 9px;
}
.form-range { width: 100%; accent-color: var(--primary); }
.form-control-color { width: 48px; padding: 3px; }
.form-check { display: inline-flex; align-items: center; gap: 7px; }
.form-check-input { accent-color: var(--primary); }
.form-check-label { color: var(--foreground); }
.form-switch .form-check-input { width: 2.25em; height: 1.2em; }
.table-responsive { max-width: 100%; overflow-x: auto; }
.table { width: 100%; border-collapse: collapse; }
.table th, .table td { border-bottom: 1px solid var(--border); padding: 9px 10px; text-align: left; vertical-align: top; }
.table th { color: var(--muted-foreground); font-size: 12px; font-weight: 600; }
.table-sm th, .table-sm td { padding: 6px 8px; }
.text-small { font-size: 12px; }
.text-muted { color: var(--muted-foreground); }
.text-destructive { color: var(--destructive); }
.text-end { text-align: end !important; font-variant-numeric: tabular-nums; }
.text-center { text-align: center !important; }
.text-nowrap { white-space: nowrap; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
.tooltip { position: fixed; z-index: 20; max-width: min(260px, calc(100vw - 16px)); pointer-events: none; border: 1px solid var(--border); border-radius: 6px; background: var(--popover); color: var(--popover-foreground); padding: 5px 7px; font-size: 0.86em; box-shadow: 0 4px 16px rgb(0 0 0 / 0.16); }
code { border-radius: 4px; background: var(--muted); padding: 1px 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
pre { max-width: 100%; overflow: auto; border-radius: 8px; background: var(--muted); padding: 10px; }
[data-lucide] { width: 16px; height: 16px; flex: none; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; } }
`;

function hostScript(bridgeToken: string): string {
  return String.raw`
(() => {
  const token = ${JSON.stringify(bridgeToken)};
  let requestNumber = 0;
  const pending = new Map();
  const paths = {
    "chevron-right": '<path d="m9 18 6-6-6-6"/>', "chevron-left": '<path d="m15 18-6-6 6-6"/>',
    "chevron-up": '<path d="m18 15-6-6-6 6"/>', "chevron-down": '<path d="m6 9 6 6 6-6"/>',
    "arrow-right": '<path d="M5 12h14M13 6l6 6-6 6"/>', "arrow-left": '<path d="M19 12H5m6 6-6-6 6-6"/>',
    "check": '<path d="m5 12 4 4L19 6"/>', "x": '<path d="M6 6l12 12M18 6 6 18"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>', "minus": '<path d="M5 12h14"/>',
    "search": '<circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/>',
    "focus": '<circle cx="12" cy="12" r="4"/><path d="M3 9V4h5M21 9V4h-5M3 15v5h5M21 15v5h-5"/>',
    "scan-eye": '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="1"/><path d="M18.9 12a7.5 7.5 0 0 0-13.8 0 7.5 7.5 0 0 0 13.8 0"/>',
    "radar": '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/><path d="m13 11 6-6"/>',
    "bot": '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8"/>',
    "info": '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    "circle-help": '<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1.2.9-1.2 1.8M12 17h.01"/>',
    "play": '<path d="m9 7 8 5-8 5z"/>', "pause": '<path d="M9 7v10M15 7v10"/>',
    "rotate-ccw": '<path d="M4 8V4m0 0h4M4 4l3 3a7 7 0 1 1-1 9"/>'
  };
  const iconMarkup = (name) => paths[name] || '<circle cx="12" cy="12" r="7"/>';
  const createIcons = () => {
    document.querySelectorAll('[data-lucide]').forEach((node) => {
      const name = node.getAttribute('data-lucide') || '';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const attribute of node.attributes) if (attribute.name !== 'data-lucide') svg.setAttribute(attribute.name, attribute.value);
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('data-icon-name', name); svg.innerHTML = iconMarkup(name); node.replaceWith(svg);
    });
  };
  window.lucide = { createIcons };
  window.openai = Object.freeze({
    sendFollowUpMessage(payload) {
      if (navigator.userActivation && !navigator.userActivation.isActive) return Promise.resolve(false);
      return new Promise((resolve) => {
        const requestId = String(++requestNumber);
        pending.set(requestId, resolve);
        parent.postMessage({ type: 'agent-group.visualization.follow-up', token, requestId, payload }, '*');
        setTimeout(() => { if (pending.delete(requestId)) resolve(false); }, 30000);
      });
    }
  });
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.type !== 'agent-group.visualization.follow-up-result' || data.token !== token) return;
    const resolve = pending.get(data.requestId); if (!resolve) return;
    pending.delete(data.requestId); resolve(data.ok === true);
  });
  let tooltip = null;
  const hideTooltip = () => { tooltip?.remove(); tooltip = null; };
  const showTooltip = (target) => {
    const label = target.getAttribute('data-tooltip'); if (!label) return;
    hideTooltip(); tooltip = document.createElement('div'); tooltip.className = 'tooltip';
    tooltip.setAttribute('role', 'tooltip'); tooltip.textContent = label; document.body.appendChild(tooltip);
    const targetRect = target.getBoundingClientRect(); const tipRect = tooltip.getBoundingClientRect();
    const placement = target.getAttribute('data-tooltip-placement') || 'top'; const gap = 6;
    let left = targetRect.left + (targetRect.width - tipRect.width) / 2;
    let top = targetRect.top - tipRect.height - gap;
    if (placement === 'bottom') top = targetRect.bottom + gap;
    if (placement === 'left') { left = targetRect.left - tipRect.width - gap; top = targetRect.top + (targetRect.height - tipRect.height) / 2; }
    if (placement === 'right') { left = targetRect.right + gap; top = targetRect.top + (targetRect.height - tipRect.height) / 2; }
    left = Math.max(8, Math.min(left, innerWidth - tipRect.width - 8));
    top = Math.max(8, Math.min(top, innerHeight - tipRect.height - 8));
    tooltip.style.left = left + 'px'; tooltip.style.top = top + 'px';
  };
  document.addEventListener('pointerover', (event) => { const target = event.target.closest?.('[data-tooltip]'); if (target) showTooltip(target); });
  document.addEventListener('pointerout', (event) => { if (event.target.closest?.('[data-tooltip]')) hideTooltip(); });
  document.addEventListener('focusin', (event) => { const target = event.target.closest?.('[data-tooltip]'); if (target) showTooltip(target); });
  document.addEventListener('focusout', hideTooltip);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideTooltip(); });
  const reportHeight = () => {
    const height = Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight || 0);
    parent.postMessage({ type: 'agent-group.visualization.height', token, height }, '*');
  };
  addEventListener('DOMContentLoaded', () => {
    createIcons(); reportHeight();
    new ResizeObserver(reportHeight).observe(document.documentElement);
  });
  addEventListener('load', reportHeight);
})();`;
}

export function buildCodexVisualizationDocument(input: {
  readonly fragment: string;
  readonly theme: "light" | "dark";
  readonly bridgeToken: string;
}): string {
  const contentSecurityPolicy = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${APPROVED_CDNS}`,
    `style-src 'unsafe-inline' ${APPROVED_CDNS}`,
    `font-src data: ${APPROVED_CDNS}`,
    `img-src data: blob: ${APPROVED_CDNS}`,
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return `<!doctype html><html data-theme="${input.theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}"><style>${BASE_STYLES}</style><script>${hostScript(input.bridgeToken)}</script></head><body>${input.fragment}</body></html>`;
}

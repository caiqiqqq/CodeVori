const RESOURCE_ORIGINS =
  "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://esm.sh https://fonts.bunny.net https://fonts.googleapis.com https://fonts.gstatic.com https://unpkg.com";
const CSP = `default-src 'none'; script-src 'unsafe-inline' ${RESOURCE_ORIGINS}; style-src 'unsafe-inline' ${RESOURCE_ORIGINS}; img-src data: blob: ${RESOURCE_ORIGINS}; font-src ${RESOURCE_ORIGINS}; media-src data: blob: ${RESOURCE_ORIGINS}; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;

// 可视化内容有独立字号；外层应用控件继续使用 text-ui-*，不把应用样式注入不可信文档。
const STYLES = `
:root{--background:light-dark(#fff,#18191c);--foreground:light-dark(#24272e,#eceef2);--card:light-dark(#f7f8fa,#202125);--card-foreground:var(--foreground);--popover:var(--card);--popover-foreground:var(--foreground);--primary:light-dark(#3567c8,#99bbff);--primary-foreground:var(--background);--secondary:light-dark(#f0f2f5,#292b30);--secondary-foreground:var(--foreground);--muted:var(--secondary);--muted-foreground:light-dark(#646c7b,#a3abb9);--accent:var(--secondary);--accent-foreground:var(--foreground);--destructive:light-dark(#b91c1c,#fca5a5);--border:light-dark(#e4e7ec,#353840);--input:var(--border);--ring:var(--primary);--radius:.5rem;--font-sans:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;--font-mono:ui-monospace,monospace}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:transparent;color:var(--foreground);font:14px/1.5 var(--font-sans);overflow-wrap:anywhere}img,svg,canvas{max-width:100%}button,input,select,textarea{font:inherit;color:inherit}button{cursor:pointer}button:disabled{cursor:default;opacity:.5}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--ring);outline-offset:2px}[hidden]{display:none!important}
h1,h2,h3,p{margin:0 0 .75rem}h1{font-size:1.75rem}h2{font-size:1.5rem}h3{font-size:1.125rem}.card{padding:1rem;background:var(--card);border:1px solid var(--border);border-radius:var(--radius)}.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;padding:.5rem .75rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--secondary)}.btn-primary{background:var(--primary);color:var(--primary-foreground)}.btn-outline{background:transparent}.muted,.text-muted-foreground{color:var(--muted-foreground)}.text-foreground{color:var(--foreground)}.font-mono{font-family:var(--font-mono)}.font-medium{font-weight:500}.font-semibold{font-weight:600}.text-sm{font-size:.875rem}.text-xs{font-size:.75rem}.text-lg{font-size:1.125rem}.text-xl{font-size:1.25rem}.flex{display:flex}.grid{display:grid}.flex-col{flex-direction:column}.flex-wrap{flex-wrap:wrap}.items-center{align-items:center}.justify-between{justify-content:space-between}.gap-2{gap:.5rem}.gap-3{gap:.75rem}.gap-4{gap:1rem}.w-full{width:100%}.tooltip{position:fixed;z-index:10;padding:.4rem .6rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--popover);color:var(--popover-foreground);font-size:12px;pointer-events:none}svg.lucide{width:1em;height:1em;vertical-align:middle;flex-shrink:0}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;

const BOOTSTRAP = `
(() => {
  const report = () => parent.postMessage({type:'zcode-visualization-height',height:Math.ceil(document.body.getBoundingClientRect().height)}, '*');
  document.addEventListener('DOMContentLoaded', () => {
    new ResizeObserver(report).observe(document.body);
    report();
    document.addEventListener('submit', event => event.preventDefault());
    document.addEventListener('click', event => {
      const link = event.target.closest?.('a');
      if (link && !link.getAttribute('href')?.startsWith('#')) event.preventDefault();
    });
  });
})();
`;

const ICONS = `
(() => {
  const render = () => {
    if (document.querySelector('i[data-lucide]')) window.lucide?.createIcons();
  };
  render();
  new MutationObserver(render).observe(document.body, {childList:true,subtree:true});
})();
`;

/** 只构造隔离文档；片段不进入父页面 DOM，也不获得文件服务或会话桥接。 */
export function buildVisualizationDocument(fragment: string, theme: "light" | "dark"): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>:root{color-scheme:${theme}}${STYLES}</style><script>${BOOTSTRAP}</script></head><body>${fragment}<script async src="https://unpkg.com/lucide@1.17.0/dist/umd/lucide.min.js" onload="window.lucide?.createIcons()"></script><script>${ICONS}</script></body></html>`;
}

export function resolveVisualizationHeight(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  return value.type === "zcode-visualization-height" &&
    typeof value.height === "number" &&
    Number.isFinite(value.height)
    ? Math.min(1400, Math.max(64, Math.ceil(value.height)))
    : null;
}

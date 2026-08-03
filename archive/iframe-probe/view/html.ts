import {
  EMBED_API_SCRIPT_URL,
  UI_PROTOCOL_VERSION,
  embedUrlFor,
  type ProbeDef,
} from "../probes.js";
import { DIAGNOSTICS_SCRIPT } from "./diagnostics.js";

/**
 * Safe to drop into an inline `<script>`: escaping `<` and `>` neutralizes both
 * `</script>` and `<!--`. U+2028 / U+2029 need no handling — they are legal inside
 * JS string literals since ES2019.
 */
function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STYLE = `
  :root { color-scheme: light; }
  html, body {
    margin: 0;
    padding: 0;
    background: #f6f5f0;
    color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans",
      "Noto Sans JP", Meiryo, sans-serif;
    font-size: 13px;
    line-height: 1.6;
  }
  .root { padding: 16px; max-width: 1100px; margin: 0 auto; }
  header { border-bottom: 2px solid #1a1a1a; padding-bottom: 8px; margin-bottom: 16px; }
  h1 { font-size: 16px; margin: 0; }
  h2 { font-size: 13px; margin: 0 0 6px; letter-spacing: .04em; }
  .sub { margin: 4px 0 0; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; color: #555; }
  .note { margin: 0 0 6px; color: #555; }
  section { margin-bottom: 18px; }
  table.kv { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d8d5cc; }
  table.kv th, table.kv td { text-align: left; vertical-align: top; padding: 5px 8px; border-bottom: 1px solid #ece9e1; }
  table.kv th { width: 210px; font-weight: 600; background: #faf9f5; }
  table.kv td.v { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
  td.v.ok { color: #0a6b3d; }
  td.v.ng { color: #b3261e; font-weight: 600; }
  td.v.warn { color: #8a5300; font-weight: 600; }
  pre { margin: 0; font: inherit; white-space: pre-wrap; }
  .embed-section .embed {
    border: 1px dashed #b9b4a7;
    background: #fff;
    min-height: 480px;
    display: flex;
    overflow: hidden;
  }
  .embed iframe, .embed tableau-viz { flex: 1 1 auto; width: 100%; min-height: 480px; border: 0; }
  .embed img { max-width: 100%; height: auto; object-fit: contain; }
`;

export function renderProbeHtml(
  probe: ProbeDef,
  defaultVizUrl: string,
  serverVersion: string,
): string {
  const config = {
    probeId: probe.id,
    title: probe.title,
    resourceUri: probe.resourceUri,
    embedMode: probe.embedMode,
    declaredCsp: probe.csp ?? null,
    defaultEmbedUrl: embedUrlFor(probe.embedMode, defaultVizUrl),
    embedApiScriptUrl: EMBED_API_SCRIPT_URL,
    protocolVersion: UI_PROTOCOL_VERSION,
    serverVersion,
    expectation: probe.expectation,
  };

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MCP Apps iframe probe ${escapeHtml(probe.id)}</title>
<style>${STYLE}</style>
</head>
<body>
<script>window.__PROBE_CONFIG__ = ${inlineJson(config)};</script>
<script>${DIAGNOSTICS_SCRIPT}</script>
</body>
</html>
`;
}

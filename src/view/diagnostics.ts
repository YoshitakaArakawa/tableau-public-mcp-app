/**
 * @file Size/display diagnostics overlay for host measurements.
 *
 * Answers three questions about the host's widget frame, from inside it:
 * 1. What viewport (width x height) does the widget actually get?
 * 2. What size-related signals does the host expose (`window.openai` globals on ChatGPT)?
 * 3. Does a display-mode change request (fullscreen) work, and what does it return?
 *
 * The overlay renders the numbers in-page so a screenshot of the widget IS the measurement, and
 * mirrors them on `window.__DIAG` for programmatic readout where same-origin access exists.
 */
import type { HostChannel } from "./hostBridge.js";

/** Size-ish keys worth printing verbatim when present on `window.openai`. */
const OPENAI_SIZE_KEYS = ["displayMode", "maxHeight", "safeArea", "viewMode"] as const;

type DiagSnapshot = {
  viewport: string;
  openaiKeys: string[];
  openaiSizeInfo: Record<string, unknown>;
  hostKind: string;
  lastDisplayModeResult?: unknown;
};

export function startDiagnostics(getHost: () => HostChannel | undefined): void {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;left:4px;bottom:4px;z-index:9999;font:10px/1.4 monospace;" +
    "background:rgba(0,0,0,.65);color:#9f9;padding:4px 6px;border-radius:4px;" +
    "pointer-events:none;max-width:95vw;white-space:pre-wrap;word-break:break-all;";

  const button = document.createElement("button");
  button.textContent = "⛶ fullscreen";
  button.style.cssText =
    "position:fixed;right:4px;bottom:4px;z-index:9999;font:11px monospace;" +
    "padding:2px 6px;opacity:.8;pointer-events:auto;";

  const diag: DiagSnapshot = {
    viewport: "",
    openaiKeys: [],
    openaiSizeInfo: {},
    hostKind: "connecting",
  };
  (window as { __DIAG?: DiagSnapshot }).__DIAG = diag;

  const refresh = (): void => {
    const openai = (window as { openai?: Record<string, unknown> }).openai;

    diag.viewport =
      `${window.innerWidth}x${window.innerHeight}` +
      ` (doc ${document.documentElement.clientWidth}x${document.documentElement.clientHeight},` +
      ` dpr ${window.devicePixelRatio})`;
    diag.hostKind = getHost()?.kind ?? "connecting";

    if (openai) {
      diag.openaiKeys = Object.keys(openai);
      diag.openaiSizeInfo = {};
      for (const key of OPENAI_SIZE_KEYS) {
        if (key in openai) {
          diag.openaiSizeInfo[key] = openai[key];
        }
      }
    }

    const lines = [
      `viewport ${diag.viewport}`,
      `host ${diag.hostKind}`,
      openai
        ? `openai ${JSON.stringify(diag.openaiSizeInfo)}\nkeys: ${diag.openaiKeys.join(",")}`
        : "openai absent",
    ];
    if (diag.lastDisplayModeResult !== undefined) {
      lines.push(`displayMode result: ${JSON.stringify(diag.lastDisplayModeResult)}`);
    }
    overlay.textContent = lines.join("\n");
  };

  button.addEventListener("click", () => {
    void (async () => {
      try {
        const result = await getHost()?.requestDisplayMode?.("fullscreen");
        diag.lastDisplayModeResult = result ?? "no-op (host has no channel)";
      } catch (error) {
        diag.lastDisplayModeResult = `error: ${error instanceof Error ? error.message : String(error)}`;
      }
      refresh();
    })();
  });

  window.addEventListener("resize", refresh);
  window.addEventListener("openai:set_globals", refresh);
  setInterval(refresh, 2000);
  refresh();

  document.body.appendChild(overlay);
  document.body.appendChild(button);
}

/**
 * @file Widget entry point: embed the viz, connect to whichever host is present, start the bridge.
 *
 * The bridge is started BEFORE the host handshake resolves: `firstinteractive` can fire while the
 * ext-apps connect race (up to 3s) is still pending, and the initial snapshot must not be lost. The
 * lazy channel below buffers the latest payload until a real channel exists — latest-wins, because
 * every push is a complete snapshot and an older one has no value.
 */
import { startDiagnostics } from "./diagnostics.js";
import type { TableauVizElement } from "./embeddingApiTypes.js";
import { connectHost, type HostChannel, type ToolData } from "./hostBridge.js";
import type { VizStatePayload } from "./payload.js";
import { startVizStateBridge } from "./vizStateBridge.js";

/** Injected by the server into the page before this bundle runs. */
type AppConfig = { name?: string; version?: string };

/** Only Tableau Public view URLs are ever loaded, no matter what a tool result claims. */
const VIZ_URL_PREFIX = "https://public.tableau.com/views/";

const config: AppConfig =
  (window as { __APP_CONFIG?: AppConfig }).__APP_CONFIG ?? {};

const viz = document.getElementById("viz") as TableauVizElement | null;
const wrap = document.getElementById("wrap");

if (viz === null) {
  console.error("[tableau-public-mcp-app] no #viz element in the widget HTML");
} else {
  // No initial src and NO default-viz fallback: the element stays empty until a URL arrives from
  // the host — a fresh tool result (`toolOutput` / SEP-1865 ontoolresult) or, on a re-rendered
  // widget, the `restore` block of the previously saved widget state. Showing an unrelated
  // default dashboard instead of the view the user had open is worse than showing nothing.
  let currentVizUrl: string | undefined;
  let currentHeightPx: number | undefined;

  const applyToolData = (data: ToolData): void => {
    if (data.vizUrl !== undefined) {
      if (!data.vizUrl.startsWith(VIZ_URL_PREFIX)) {
        console.warn("[tableau-public-mcp-app] ignoring non-Tableau-Public viz url", data.vizUrl);
      } else if (data.vizUrl !== currentVizUrl) {
        currentVizUrl = data.vizUrl;
        // The custom element observes `src`; swapping it reloads the viz and re-fires
        // `firstinteractive`, which the bridge treats as a fresh capture trigger.
        viz.setAttribute("src", data.vizUrl);
      }
    }

    // An explicit height replaces the fill-the-frame default; ChatGPT sizes the inline card to
    // the widget's content height (measured 20260803: 1200 and 3000 both honored 1:1).
    if (data.heightPx !== undefined && wrap !== null) {
      currentHeightPx = data.heightPx;
      wrap.style.height = `${data.heightPx}px`;
    }
  };

  // Latest-wins buffer for pushes that happen before the host channel resolves.
  let resolvedHost: HostChannel | undefined;
  let bufferedPayload: VizStatePayload | undefined;

  const lazyHost: HostChannel = {
    kind: "none",
    pushState: async (payload) => {
      if (resolvedHost !== undefined) {
        await resolvedHost.pushState(payload);
      } else {
        bufferedPayload = payload;
      }
    },
  };

  startVizStateBridge({
    host: lazyHost,
    viz,
    getVizUrl: () => currentVizUrl,
    // Standalone diagnostics (`/widget` in a plain tab has no host): the last captured snapshot is
    // observable from the console even when there is nowhere to push it.
    onPushed: (payload) => {
      (window as { __LAST_VIZ_STATE?: unknown }).__LAST_VIZ_STATE = payload;
    },
  });

  startDiagnostics(() => resolvedHost);

  void connectHost({
    appName: config.name ?? "tableau-public-mcp-app",
    appVersion: config.version ?? "0.0.0",
    onToolData: applyToolData,
    getRestoreState: () => ({ vizUrl: currentVizUrl, heightPx: currentHeightPx }),
  }).then(async (host) => {
    resolvedHost = host;
    console.info(`[tableau-public-mcp-app] host channel: ${host.kind}`);

    // Standalone `/widget` debugging (no host): allow ?viz=<public.tableau.com/views/...> in the
    // page URL. Hosted widgets get their URL from the host, never from the page URL.
    if (currentVizUrl === undefined) {
      const standaloneUrl = new URLSearchParams(window.location.search).get("viz");
      if (standaloneUrl !== null) {
        applyToolData({ vizUrl: standaloneUrl });
      }
    }

    if (bufferedPayload !== undefined) {
      const payload = bufferedPayload;
      bufferedPayload = undefined;
      await host.pushState(payload);
    }
  });
}

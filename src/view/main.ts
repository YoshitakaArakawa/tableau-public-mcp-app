/**
 * @file Widget entry point: embed the viz, connect to whichever host is present, start the bridge.
 *
 * The bridge is started BEFORE the host handshake resolves: `firstinteractive` can fire while the
 * ext-apps connect race (up to 3s) is still pending, and the initial snapshot must not be lost. The
 * lazy channel below buffers the latest payload until a real channel exists — latest-wins, because
 * every push is a complete snapshot and an older one has no value.
 */
import type { TableauVizElement } from "./embeddingApiTypes.js";
import { connectHost, type HostChannel } from "./hostBridge.js";
import type { VizStatePayload } from "./payload.js";
import { startVizStateBridge } from "./vizStateBridge.js";

/** Injected by the server into the page before this bundle runs. */
type AppConfig = { name?: string; version?: string; defaultVizUrl?: string };

/** Only Tableau Public view URLs are ever loaded, no matter what a tool result claims. */
const VIZ_URL_PREFIX = "https://public.tableau.com/views/";

const config: AppConfig =
  (window as { __APP_CONFIG?: AppConfig }).__APP_CONFIG ?? {};

/**
 * Grace period after the host handshake settles before falling back to the default viz. A host
 * that has a URL for us normally delivers it with (or before) the handshake; the fallback exists
 * for the standalone `/widget` debug page and hosts that render the widget without a tool result.
 */
const VIZ_URL_FALLBACK_DELAY_MS = 3_000;

const viz = document.getElementById("viz") as TableauVizElement | null;

if (viz === null) {
  console.error("[tableau-public-mcp-app] no #viz element in the widget HTML");
} else {
  // No initial src: loading a default viz just to swap it out moments later wastes a full viz
  // load and flashes an unrelated dashboard at the user. The element stays empty until a URL
  // arrives from the host (or the fallback below gives up waiting).
  let currentVizUrl: string | undefined;

  const applyVizUrl = (url: string): void => {
    if (!url.startsWith(VIZ_URL_PREFIX)) {
      console.warn("[tableau-public-mcp-app] ignoring non-Tableau-Public viz url", url);
      return;
    }
    if (url === currentVizUrl) {
      return;
    }

    currentVizUrl = url;
    // The custom element observes `src`; swapping it reloads the viz and re-fires
    // `firstinteractive`, which the bridge treats as a fresh capture trigger.
    viz.setAttribute("src", url);
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

  void connectHost({
    appName: config.name ?? "tableau-public-mcp-app",
    appVersion: config.version ?? "0.0.0",
    onVizUrl: applyVizUrl,
  }).then(async (host) => {
    resolvedHost = host;
    console.info(`[tableau-public-mcp-app] host channel: ${host.kind}`);

    // The handshake settled without a viz URL: give a late tool result a moment, then fall back.
    if (currentVizUrl === undefined && config.defaultVizUrl !== undefined) {
      setTimeout(() => {
        if (currentVizUrl === undefined && config.defaultVizUrl !== undefined) {
          applyVizUrl(config.defaultVizUrl);
        }
      }, VIZ_URL_FALLBACK_DELAY_MS);
    }

    if (bufferedPayload !== undefined) {
      const payload = bufferedPayload;
      bufferedPayload = undefined;
      await host.pushState(payload);
    }
  });
}

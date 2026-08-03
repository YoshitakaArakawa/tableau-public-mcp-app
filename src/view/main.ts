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

  /** An explicit height (tool arg or restore) always beats the published-size auto height. */
  let explicitHeight = false;

  const applyToolData = (data: ToolData): void => {
    // Height FIRST: `<tableau-viz>` sizes its internal iframe from the container at the moment
    // `src` is set and does not follow later container resizes (measured 20260803: src-then-height
    // left the viz at the old 480px inside a 1200px card). ChatGPT sizes the inline card to the
    // widget's content height, so this is what makes the card grow.
    let heightChanged = false;

    if (data.heightPx !== undefined) {
      explicitHeight = true;
      if (wrap !== null && data.heightPx !== currentHeightPx) {
        currentHeightPx = data.heightPx;
        wrap.style.height = `${data.heightPx}px`;
        heightChanged = true;
      }
    }

    if (data.vizUrl !== undefined) {
      if (!data.vizUrl.startsWith(VIZ_URL_PREFIX)) {
        console.warn("[tableau-public-mcp-app] ignoring non-Tableau-Public viz url", data.vizUrl);
      } else if (data.vizUrl !== currentVizUrl) {
        currentVizUrl = data.vizUrl;
        // The custom element observes `src`; swapping it reloads the viz and re-fires
        // `firstinteractive`, which the bridge treats as a fresh capture trigger.
        viz.setAttribute("src", data.vizUrl);
        heightChanged = false;
      }
    }

    // Height changed under an already-loaded viz: force a re-render, since the embedded iframe
    // keeps its creation-time size otherwise.
    if (heightChanged && currentVizUrl !== undefined && viz.getAttribute("src") !== null) {
      viz.setAttribute("src", currentVizUrl);
    }
  };

  // The Embedding API sizes its internal iframe from the VIEWPORT, not from its container
  // (measured 20260803: window 480 / container 950 → iframe style.height 480px). In ChatGPT the
  // widget window starts at the default 480px and grows to the content height afterwards, so the
  // viz iframe gets stuck at 480 with an internal scrollbar. Overriding the iframe's height
  // through the open shadow root keeps it in step with the wrapper without a reload.
  const syncVizFrameHeight = (): void => {
    if (wrap === null) {
      return;
    }

    const iframe = viz.shadowRoot?.querySelector("iframe");
    if (iframe instanceof HTMLIFrameElement) {
      const rect = wrap.getBoundingClientRect();
      const targetH = Math.round(rect.height);
      const targetW = Math.round(rect.width);
      if (targetH > 0 && Math.abs(iframe.getBoundingClientRect().height - targetH) > 1) {
        iframe.style.height = `${targetH}px`;
      }
      if (targetW > 0 && Math.abs(iframe.getBoundingClientRect().width - targetW) > 1) {
        iframe.style.width = `${targetW}px`;
      }
    }
  };

  // --- Auto height from the dashboard's published size --------------------------------------
  // When nothing specified a height, size the widget to the sheet itself: 'exactly'/'range'
  // publish a height (measured 20260803: exactly carries identical minSize/maxSize), 'automatic'
  // adapts to whatever it is given, so the 100vh default stays. Clamped so one card cannot
  // flood the conversation.
  const TOOLBAR_HEIGHT_PX = 35;
  const AUTO_HEIGHT_MIN_PX = 480;
  const AUTO_HEIGHT_MAX_PX = 1200;

  const computeAutoHeight = (): number | undefined => {
    const size = viz.workbook?.activeSheet?.size;
    if (size === undefined || size.behavior === "automatic") {
      return undefined;
    }

    const published = size.maxSize?.height ?? size.minSize?.height;
    if (typeof published !== "number" || !Number.isFinite(published) || published <= 0) {
      return undefined;
    }

    return Math.min(
      AUTO_HEIGHT_MAX_PX,
      Math.max(AUTO_HEIGHT_MIN_PX, Math.round(published) + TOOLBAR_HEIGHT_PX),
    );
  };

  /**
   * Published width, when the sheet has one and it is narrower than the frame. Whether the host
   * shrinks the CARD to a narrower content width is unknown (height tracking is measured, width
   * is not) — worst case this centers the viz instead of leaving a one-sided gutter.
   */
  const computeAutoWidth = (): number | undefined => {
    const size = viz.workbook?.activeSheet?.size;
    if (size === undefined || size.behavior === "automatic") {
      return undefined;
    }

    const published = size.maxSize?.width ?? size.minSize?.width;
    if (typeof published !== "number" || !Number.isFinite(published) || published <= 0) {
      return undefined;
    }

    const available = document.documentElement.clientWidth;
    return published < available ? Math.round(published) : undefined;
  };

  const applyAutoSize = (): void => {
    if (wrap === null) {
      return;
    }

    let changed = false;

    if (!explicitHeight) {
      const height = computeAutoHeight();
      if (height !== undefined && height !== currentHeightPx) {
        currentHeightPx = height;
        wrap.style.height = `${height}px`;
        changed = true;
      }
    }

    const width = computeAutoWidth();
    if (width !== undefined) {
      wrap.style.width = `${width}px`;
      wrap.style.margin = "0 auto";
      changed = true;
    }

    if (changed) {
      syncVizFrameHeight();
      setTimeout(syncVizFrameHeight, 250);
    }
  };

  // The iframe exists only after the viz renders; the window resize fires when the host grows
  // the widget frame. Both are cheap, so sync on each plus a short settle delay. Auto height
  // runs at the same moments: `size` is readable once the viz is interactive, and a tab switch
  // can land on a sheet with a different published size.
  const handleVizReady = (): void => {
    syncVizFrameHeight();
    applyAutoSize();
    setTimeout(syncVizFrameHeight, 250);
  };

  viz.addEventListener("firstinteractive", handleVizReady);
  viz.addEventListener("tabswitched", handleVizReady);
  window.addEventListener("resize", () => {
    setTimeout(syncVizFrameHeight, 0);
  });

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

  // Measurement aid, opt-in only: hosted widgets never carry query params, so the overlay is
  // invisible in normal use and available on the standalone page via /widget?debug&viz=...
  if (new URLSearchParams(window.location.search).has("debug")) {
    startDiagnostics(() => resolvedHost);
  }

  void connectHost({
    appName: config.name ?? "tableau-public-mcp-app",
    appVersion: config.version ?? "0.0.0",
    onToolData: applyToolData,
    getRestoreState: () => ({ vizUrl: currentVizUrl, heightPx: currentHeightPx }),
  }).then(async (host) => {
    resolvedHost = host;
    console.info(`[tableau-public-mcp-app] host channel: ${host.kind}`);

    // Standalone `/widget` debugging (no host): allow ?viz=<public.tableau.com/views/...> and
    // ?height=<px> in the page URL. Hosted widgets get both from the host, never from the page URL.
    if (currentVizUrl === undefined) {
      const params = new URLSearchParams(window.location.search);
      const standaloneUrl = params.get("viz");
      if (standaloneUrl !== null) {
        const heightParam = Number(params.get("height"));
        applyToolData({
          vizUrl: standaloneUrl,
          ...(Number.isFinite(heightParam) && heightParam > 0 && { heightPx: heightParam }),
        });
      }
    }

    if (bufferedPayload !== undefined) {
      const payload = bufferedPayload;
      bufferedPayload = undefined;
      await host.pushState(payload);
    }
  });
}

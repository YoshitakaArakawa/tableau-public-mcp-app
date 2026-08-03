/**
 * @file Host-dialect adapter: one `HostChannel` interface over two widget runtimes.
 *
 * - SEP-1865 hosts (Claude, MCPJam): `@modelcontextprotocol/ext-apps` App over postMessage.
 *   Snapshots go to `updateModelContext`; the viz URL arrives via `ontoolresult`.
 * - ChatGPT (Apps SDK): the injected `window.openai` global. Snapshots go to `setWidgetState`
 *   (widget state is visible to the model); the viz URL arrives via `toolOutput`, which mirrors the
 *   tool's structuredContent.
 *
 * Detection order matters: `window.openai` is injected before the widget script runs, so its
 * presence is checked first. The ext-apps handshake is raced against a timeout because on a host
 * that speaks neither dialect `App.connect()` would wait forever — the viz must render regardless.
 */
import { App } from "@modelcontextprotocol/ext-apps";

import { fitPayloadToBudget, PUSH_BUDGET_BYTES, type VizStatePayload } from "./payload.js";
import { utf8ByteLength } from "./sanitize.js";

/** How long the SEP-1865 handshake gets before the widget gives up on having a host channel. */
export const EXT_APPS_CONNECT_TIMEOUT_MS = 3_000;

/**
 * ChatGPT recommends keeping widget state small (~4k tokens); its enforcement behaviour is
 * undocumented, so the budget is set well below the SEP-1865 one.
 */
export const OPENAI_STATE_BUDGET_BYTES = 12_000;

/**
 * Tells the model what the JSON is and that it describes the CURRENT view. Tableau Public
 * workbooks are static extracts, so unlike the Cloud/Server variant of this app there is no
 * datasource the model could re-query for the full result set.
 */
export const PUSH_PREAMBLE =
  "Tableau viz state snapshot — what the user currently sees in the embedded Tableau Public viz. " +
  "The `data` rows are a bounded sample of one worksheet's summary data, not the full result set. " +
  "The workbook is a static extract published to Tableau Public; there is no live datasource to re-query. " +
  "JSON follows.";

const PREAMBLE_BYTES = utf8ByteLength(`${PUSH_PREAMBLE}\n`);

export type HostChannel = {
  kind: "ext-apps" | "openai" | "none";
  /** Sends a complete snapshot to the host, replacing the previous one. Never throws. */
  pushState: (payload: VizStatePayload) => Promise<void>;
  /** Asks the host to switch display mode (e.g. 'fullscreen'). Resolves with the host's answer. */
  requestDisplayMode?: (mode: string) => Promise<unknown>;
};

/** What a tool result carries for the widget, in either dialect. */
export type ToolData = { vizUrl?: string; heightPx?: number };

export type ConnectHostOptions = {
  appName: string;
  appVersion: string;
  /** Called whenever the host delivers a tool result with widget data. May fire more than once. */
  onToolData: (data: ToolData) => void;
  connectTimeoutMs?: number;
};

/** The subset of the ChatGPT Apps SDK global this file touches. */
type OpenAiGlobal = {
  toolOutput?: unknown;
  setWidgetState?: (state: unknown) => Promise<void> | void;
  requestDisplayMode?: (args: { mode: string }) => Promise<unknown>;
};

/** Reads `structuredContent` (SEP-1865 tool result) or `toolOutput` (ChatGPT). */
function readToolData(container: unknown): ToolData | undefined {
  if (typeof container !== "object" || container === null) {
    return undefined;
  }

  const { vizUrl, heightPx } = container as { vizUrl?: unknown; heightPx?: unknown };
  const data: ToolData = {};

  if (typeof vizUrl === "string" && vizUrl.length > 0) {
    data.vizUrl = vizUrl;
  }
  if (typeof heightPx === "number" && Number.isFinite(heightPx) && heightPx > 0) {
    data.heightPx = heightPx;
  }

  return data.vizUrl !== undefined || data.heightPx !== undefined ? data : undefined;
}

/**
 * Connects to whichever host dialect is present. Resolves to a `none` channel when neither
 * responds, so the caller can wire the bridge unconditionally.
 */
export async function connectHost(options: ConnectHostOptions): Promise<HostChannel> {
  const openai = (window as { openai?: OpenAiGlobal }).openai;

  if (openai && typeof openai.setWidgetState === "function") {
    return connectOpenAi(openai, options);
  }

  return connectExtApps(options);
}

function connectOpenAi(openai: OpenAiGlobal, options: ConnectHostOptions): HostChannel {
  const initialData = readToolData(openai.toolOutput);
  if (initialData !== undefined) {
    options.onToolData(initialData);
  }

  // ChatGPT re-injects globals (including a late toolOutput) through this window event.
  window.addEventListener("openai:set_globals", () => {
    const data = readToolData(openai.toolOutput);
    if (data !== undefined) {
      options.onToolData(data);
    }
  });

  return {
    kind: "openai",
    pushState: async (payload) => {
      try {
        const { text } = fitPayloadToBudget(payload, OPENAI_STATE_BUDGET_BYTES - PREAMBLE_BYTES);
        await openai.setWidgetState?.({
          note: PUSH_PREAMBLE,
          vizState: JSON.parse(text) as unknown,
        });
      } catch (error) {
        console.error("[tableau-public-mcp-app] setWidgetState failed", error);
      }
    },
    requestDisplayMode: async (mode) => openai.requestDisplayMode?.({ mode }),
  };
}

async function connectExtApps(options: ConnectHostOptions): Promise<HostChannel> {
  const app = new App({ name: options.appName, version: options.appVersion });

  app.ontoolresult = (result) => {
    const data = readToolData((result as { structuredContent?: unknown }).structuredContent);
    if (data !== undefined) {
      options.onToolData(data);
    }
  };

  const timeoutMs = options.connectTimeoutMs ?? EXT_APPS_CONNECT_TIMEOUT_MS;

  const connected = await Promise.race([
    app.connect().then(
      () => true,
      (error: unknown) => {
        console.error("[tableau-public-mcp-app] ext-apps connect failed", error);
        return false;
      },
    ),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);

  if (!connected) {
    return { kind: "none", pushState: async () => {} };
  }

  return {
    kind: "ext-apps",
    pushState: async (payload) => {
      try {
        // No capability, no push. The host simply does not accept context updates.
        if (!app.getHostCapabilities()?.updateModelContext) {
          return;
        }

        const { text: json } = fitPayloadToBudget(payload, PUSH_BUDGET_BYTES - PREAMBLE_BYTES);
        await app.updateModelContext({
          content: [{ type: "text", text: `${PUSH_PREAMBLE}\n${json}` }],
        });
      } catch (error) {
        console.error("[tableau-public-mcp-app] updateModelContext failed", error);
      }
    },
    requestDisplayMode: async (mode) =>
      app.requestDisplayMode({ mode: mode as "fullscreen" | "inline" | "pip" }),
  };
}

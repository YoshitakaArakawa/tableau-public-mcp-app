#!/usr/bin/env node
/**
 * tableau-public-mcp-app — an MCP Apps server that embeds a Tableau Public viz
 * and streams its interaction state back to the model.
 *
 * One tool (`show_viz`, optional `path`), one resource: a full-viewport
 * `<tableau-viz>` (Embedding API v3, loaded from public.tableau.com — no auth,
 * Public vizzes are anonymous). The widget bundle (src/view/) captures
 * filters / parameters / selected marks / summary data after each interaction
 * and pushes the snapshot to the host: `updateModelContext` on SEP-1865 hosts,
 * `setWidgetState` on ChatGPT. Metadata is declared in both dialects.
 *
 * HTTP-only: this server exists to be reachable from web hosts.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import express from "express";
import { z } from "zod";

import { VIEW_BUNDLE_JS } from "./generated/viewBundle.js";

const APP_NAME = "tableau-public-mcp-app";
const APP_VERSION = "0.3.0";

const VIZ_ORIGIN = "https://public.tableau.com";
const EMBED_API_SCRIPT_URL = `${VIZ_ORIGIN}/javascripts/api/tableau.embedding.3.latest.min.js`;
const DEFAULT_VIZ_URL = `${VIZ_ORIGIN}/views/DeveloperSuperstore/Overview`;
const RESOURCE_URI = "ui://tableau-public/viz.html";
const MIME_TYPE = "text/html;profile=mcp-app";

/** `WorkbookName/ViewName` as it appears in a Tableau Public /views/ URL. */
const VIZ_PATH_PATTERN = /^[\w\-.]+\/[\w\-.]+$/;

/**
 * Resolves the tool's `path` input to a Tableau Public viz URL, or throws with
 * a message suitable for an isError tool result. Accepts `Workbook/View` or a
 * full public.tableau.com /views/ URL; everything else is rejected so the
 * widget never frames an arbitrary origin.
 */
function resolveVizUrl(path: string | undefined): string {
  if (path === undefined || path.trim() === "") {
    return DEFAULT_VIZ_URL;
  }

  const trimmed = path.trim();

  if (VIZ_PATH_PATTERN.test(trimmed)) {
    return `${VIZ_ORIGIN}/views/${trimmed}`;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(
      `invalid path: ${trimmed} — use "WorkbookName/ViewName" or a full ${VIZ_ORIGIN}/views/ URL`,
    );
  }

  if (url.origin !== VIZ_ORIGIN || !url.pathname.startsWith("/views/")) {
    throw new Error(`only ${VIZ_ORIGIN}/views/ URLs can be embedded (got ${trimmed})`);
  }

  // Query/hash dropped: the Embedding API adds its own parameters.
  return `${VIZ_ORIGIN}${url.pathname}`;
}

/** `</script` inside inline JS would close the surrounding tag mid-string. */
function escapeInlineScript(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script");
}

const APP_CONFIG_JSON = JSON.stringify({
  name: APP_NAME,
  version: APP_VERSION,
});

const HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tableau Public viz</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #f6f5f0; }
  .wrap { display: flex; flex-direction: column; height: 100vh; min-height: 480px; }
  tableau-viz { flex: 1 1 auto; width: 100%; border: 0; }
</style>
<script type="module" src="${EMBED_API_SCRIPT_URL}"></script>
</head>
<body>
<div class="wrap" id="wrap">
  <!-- No initial src: the viz URL arrives from the tool result (structuredContent.vizUrl);
       preloading a default viz would flash an unrelated dashboard and cost a double load. -->
  <tableau-viz id="viz" toolbar="bottom"></tableau-viz>
</div>
<script>window.__APP_CONFIG = ${APP_CONFIG_JSON};</script>
<script type="module">${escapeInlineScript(VIEW_BUNDLE_JS)}</script>
</body>
</html>
`;

/** Both dialects, declared side by side. Hosts read whichever they understand. */
const RESOURCE_META = {
  ui: {
    csp: {
      frameDomains: [VIZ_ORIGIN],
      resourceDomains: [VIZ_ORIGIN],
      connectDomains: [VIZ_ORIGIN],
    },
    prefersBorder: false,
  },
  "openai/widgetDescription":
    "Tableau Public の viz をインラインで表示し、操作状態のスナップショットをモデルへ共有します。",
  "openai/widgetPrefersBorder": false,
  "openai/widgetCSP": {
    connect_domains: [VIZ_ORIGIN],
    resource_domains: [VIZ_ORIGIN],
    frame_domains: [VIZ_ORIGIN],
  },
};

function createVizServer(): McpServer {
  const server = new McpServer(
    { name: APP_NAME, version: APP_VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.registerResource(
    "Tableau Public viz",
    RESOURCE_URI,
    {
      description:
        "Tableau Public の viz を全面表示し、フィルター・パラメーター・選択マーク・サマリーデータの" +
        "スナップショットをホストへ push するウィジェット",
      mimeType: MIME_TYPE,
      _meta: RESOURCE_META,
    },
    async () => ({
      contents: [
        { uri: RESOURCE_URI, mimeType: MIME_TYPE, text: HTML, _meta: RESOURCE_META },
      ],
    }),
  );

  server.registerTool(
    "show_viz",
    {
      title: "Show Tableau Public viz",
      description:
        "Tableau Public の viz をインラインのウィジェットとして表示する。" +
        "ユーザーが viz を操作すると、現在のフィルター・パラメーター・選択マーク・表示データの" +
        "スナップショットがモデルコンテキストに共有される。" +
        `path 省略時は Developer Superstore（${DEFAULT_VIZ_URL}）を表示する。`,
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe(
            'Tableau Public の viz。"WorkbookName/ViewName" 形式、' +
              `または ${VIZ_ORIGIN}/views/... の完全 URL。省略可。`,
          ),
        height: z
          .number()
          .int()
          .min(240)
          .max(3000)
          .optional()
          .describe(
            "ウィジェットの高さ(px)の明示指定。通常は省略する — 省略時はダッシュボードの" +
              "公開サイズから自動で高さが決まる。ユーザーが高さを明示的に希望した場合のみ指定する。",
          ),
      },
      outputSchema: { vizUrl: z.string(), heightPx: z.number().optional() },
      _meta: {
        ui: { resourceUri: RESOURCE_URI, visibility: ["model", "app"] },
        "openai/outputTemplate": RESOURCE_URI,
        "openai/toolInvocation/invoking": "viz を読み込んでいます",
        "openai/toolInvocation/invoked": "viz を表示しました",
      },
    },
    async ({ path, height }) => {
      let vizUrl: string;
      try {
        vizUrl = resolveVizUrl(path);
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text:
              `Tableau Public の viz を表示します: ${vizUrl}\n` +
              "ユーザーが viz を操作すると状態スナップショットが共有されます。",
          },
        ],
        structuredContent: { vizUrl, ...(height !== undefined && { heightPx: height }) },
      };
    },
  );

  return server;
}

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: true,
    // Mcp-Session-Id stays allowed (not exposed — we never issue one) so a client that
    // sends it anyway is not rejected at the CORS preflight.
    allowedHeaders: ["Content-Type", "Accept", "Mcp-Session-Id", "MCP-Protocol-Version"],
  }),
);

app.get("/health", (_req, res) => {
  res.json({ name: APP_NAME, version: APP_VERSION });
});

/** The widget HTML, served directly for standalone verification in a plain browser tab. */
app.get("/widget", (_req, res) => {
  res.type("text/html").send(HTML);
});

/**
 * Stateless: a fresh server + transport pair per request, discarded when the response closes.
 * No session id is issued, so any instance behind a load balancer can serve any request. The
 * server has no server-to-client traffic to lose — tool calls and resource reads are pure
 * request/response, and the viz state snapshots travel inside the host (widget→host bridge),
 * never through this transport.
 */
app.post("/mcp", async (req, res) => {
  const server = createVizServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(`[${APP_NAME}] request failed:`, error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

/**
 * With no sessions there is no SSE notification stream to offer (GET) and no session to
 * terminate (DELETE). 405 is the response the Streamable HTTP spec prescribes for both.
 * Blocking GET here matters: the SDK's stateless transport would otherwise open a standalone
 * SSE stream that nothing ever writes to or closes.
 */
app.all("/mcp", (_req, res) => {
  res
    .status(405)
    .set("Allow", "POST")
    .json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
});

app.listen(port, host, () => {
  console.error(`[${APP_NAME}] listening on http://${host}:${port}/mcp`);
});

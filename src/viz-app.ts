#!/usr/bin/env node
/**
 * tableau-public-mcp-app — the minimal companion server to the probe.
 *
 * One tool (`show_viz`), one resource: a full-viewport iframe embedding the
 * default Tableau Public sample viz. No diagnostics, no parameters. Metadata is
 * declared in both dialects so the widget renders on SEP-1865 hosts (Claude,
 * MCPJam) and on ChatGPT (Apps SDK), which treats `_meta.ui.*` as preferred and
 * `openai/*` keys as legacy aliases.
 *
 * HTTP-only: this server exists to be reachable from web hosts.
 */
import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";
import express from "express";

const APP_NAME = "tableau-public-mcp-app";
const APP_VERSION = "0.1.0";

const VIZ_ORIGIN = "https://public.tableau.com";
const VIZ_URL = `${VIZ_ORIGIN}/views/DeveloperSuperstore/Overview`;
const EMBED_URL = `${VIZ_URL}?:embed=true&:showVizHome=no`;
const RESOURCE_URI = "ui://tableau-public/viz.html";
const MIME_TYPE = "text/html;profile=mcp-app";

const HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tableau Public viz</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #f6f5f0; }
  .wrap { display: flex; flex-direction: column; height: 100vh; min-height: 480px; }
  iframe { flex: 1 1 auto; width: 100%; border: 0; }
  .fallback { font: 12px/1.6 sans-serif; color: #555; padding: 4px 8px; }
</style>
</head>
<body>
<div class="wrap">
  <iframe src="${EMBED_URL}" title="Tableau Public viz"></iframe>
  <p class="fallback">viz が表示されない場合、このホストは外部 iframe (frame-src) を許可していません。</p>
</div>
</body>
</html>
`;

/** Both dialects, declared side by side. Hosts read whichever they understand. */
const RESOURCE_META = {
  ui: {
    csp: {
      frameDomains: [VIZ_ORIGIN],
      resourceDomains: [VIZ_ORIGIN],
    },
    prefersBorder: false,
  },
  "openai/widgetDescription": "Tableau Public の viz をインラインで表示します。",
  "openai/widgetPrefersBorder": false,
  "openai/widgetCSP": {
    connect_domains: [],
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
      description: "Tableau Public のサンプル viz を全面表示するウィジェット",
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
        "Tableau Public のサンプル viz（Developer Superstore）をインラインのウィジェットとして表示する。",
      _meta: {
        ui: { resourceUri: RESOURCE_URI, visibility: ["model", "app"] },
        "openai/outputTemplate": RESOURCE_URI,
        "openai/toolInvocation/invoking": "viz を読み込んでいます",
        "openai/toolInvocation/invoked": "viz を表示しました",
      },
    },
    async () => ({
      content: [
        {
          type: "text",
          text:
            `Tableau Public の viz を表示します: ${VIZ_URL}\n` +
            "ウィジェットが描画されない場合、このホストは MCP Apps の UI か外部 iframe を許可していません。",
        },
      ],
    }),
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
    exposedHeaders: ["Mcp-Session-Id"],
    allowedHeaders: ["Content-Type", "Accept", "Mcp-Session-Id", "MCP-Protocol-Version"],
  }),
);

const sessions = new Map<string, StreamableHTTPServerTransport>();

app.get("/health", (_req, res) => {
  res.json({ name: APP_NAME, version: APP_VERSION, sessions: sessions.size });
});

app.all("/mcp", async (req, res) => {
  try {
    const sessionId = req.header("mcp-session-id");
    let transport = sessionId ? sessions.get(sessionId) : undefined;

    if (!transport) {
      if (req.method !== "POST" || !isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "No valid session. Send an initialize request first." },
          id: null,
        });
        return;
      }

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, transport!);
        },
        onsessionclosed: (id) => {
          sessions.delete(id);
        },
      });
      transport.onclose = () => {
        if (transport?.sessionId) sessions.delete(transport.sessionId);
      };

      await createVizServer().connect(transport);
    }

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

app.listen(port, host, () => {
  console.error(`[${APP_NAME}] listening on http://${host}:${port}/mcp`);
});

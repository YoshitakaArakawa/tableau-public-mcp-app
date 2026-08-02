import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  RESOURCE_MIME_TYPE,
  getUiCapability,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import {
  DEFAULT_VIZ_URL,
  PROBES,
  embedUrlFor,
  normalizeVizUrl,
  type ProbeDef,
} from "./probes.js";
import { renderProbeHtml } from "./view/html.js";

export const SERVER_NAME = "mcp-apps-iframe-probe";
export const SERVER_VERSION = "0.1.0";

/** Text fallback, so a host without MCP Apps support still shows something useful. */
function textReport(probe: ProbeDef, vizUrl: string): string {
  return [
    `probe ${probe.id} — ${probe.title}`,
    `resource: ${probe.resourceUri}`,
    `declared csp: ${probe.csp ? JSON.stringify(probe.csp) : "(none)"}`,
    `embed mode: ${probe.embedMode}`,
    `viz url: ${vizUrl}`,
    `embed url: ${embedUrlFor(probe.embedMode, vizUrl)}`,
    `expectation: ${probe.expectation}`,
    `what it tells us: ${probe.question}`,
    "",
    "この本文だけが表示され診断パネルが出ない場合、ホストは MCP Apps の UI リソースを描画していない。",
  ].join("\n");
}

function registerProbe(server: McpServer, probe: ProbeDef): void {
  const html = renderProbeHtml(probe, DEFAULT_VIZ_URL, SERVER_VERSION);

  // `_meta.ui` is placed on both the listing (here) and the content item below.
  // The spec makes the content item win; the listing copy exists so hosts can
  // review the declaration at connection time.
  const ui = {
    ...(probe.csp ? { csp: probe.csp } : {}),
    prefersBorder: false,
  };

  registerAppResource(
    server,
    probe.resourceName,
    probe.resourceUri,
    {
      description: `${probe.expectation} / ${probe.question}`,
      mimeType: RESOURCE_MIME_TYPE,
      _meta: { ui },
    },
    async () => ({
      contents: [
        {
          uri: probe.resourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: { ui },
        },
      ],
    }),
  );

  registerAppTool(
    server,
    probe.toolName,
    {
      title: `Probe ${probe.id}`,
      description:
        `MCP Apps の iframe 埋め込み対応状況を調べる診断ビューを表示する（プローブ ${probe.id}: ${probe.title}）。` +
        probe.question,
      inputSchema: {
        vizUrl: z
          .string()
          .optional()
          .describe("public.tableau.com の viz URL（省略時は既定 viz）"),
      },
      _meta: { ui: { resourceUri: probe.resourceUri, visibility: ["model", "app"] } },
    },
    async ({ vizUrl }) => {
      let resolved: string;
      try {
        resolved = normalizeVizUrl(vizUrl);
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: String((error as Error).message ?? error) }],
        };
      }
      return { content: [{ type: "text", text: textReport(probe, resolved) }] };
    },
  );
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  for (const probe of PROBES) registerProbe(server, probe);

  // Measures whether `visibility: ["app"]` really removes a tool from the model's
  // tools/list. Costs almost nothing to add, and it reuses probe B's resource.
  registerAppTool(
    server,
    "probe_app_only",
    {
      title: "Probe: app-only visibility",
      description:
        "visibility: [\"app\"] のツール。このツールがモデルから見えていたら、" +
        "ホストは _meta.ui.visibility に未対応（仕様の MUST 違反）。",
      _meta: { ui: { resourceUri: "ui://tp/iframe", visibility: ["app"] } },
    },
    async () => ({
      content: [
        {
          type: "text",
          text:
            "app-only ツールが呼ばれた。モデル経由で呼ばれたのであれば、" +
            "ホストは visibility を尊重していない。",
        },
      ],
    }),
  );

  // The spec's recommendation is to fall back to text-only tools when the client
  // cannot render `text/html;profile=mcp-app`. This server deliberately does not:
  // detecting non-support *is* the measurement, so the UI tools stay registered
  // and we only log what the client advertised.
  server.server.oninitialized = () => {
    const capabilities = server.server.getClientCapabilities();
    const ui = getUiCapability(capabilities);
    const supported = ui?.mimeTypes?.includes(RESOURCE_MIME_TYPE) ?? false;
    console.error(
      `[${SERVER_NAME}] client ui capability: ` +
        (ui ? JSON.stringify(ui) : "(not advertised)") +
        ` / mcp-app mimeType supported: ${supported}`,
    );
  };

  return server;
}

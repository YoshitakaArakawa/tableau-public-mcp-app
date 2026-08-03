#!/usr/bin/env node
import { randomUUID } from "node:crypto";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";
import express from "express";

import { SERVER_NAME, SERVER_VERSION, createServer } from "./server.js";

interface Options {
  transport: "stdio" | "http";
  port: number;
  host: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    transport: "stdio",
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? "0.0.0.0",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--transport") {
      const value = argv[++i];
      if (value !== "stdio" && value !== "http") {
        throw new Error(`--transport must be "stdio" or "http" (got ${value})`);
      }
      options.transport = value;
    } else if (arg === "--port") {
      options.port = Number(argv[++i]);
    } else if (arg === "--host") {
      options.host = String(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          `${SERVER_NAME} ${SERVER_VERSION}`,
          "",
          "  --transport stdio        run over stdio (default)",
          "  --transport http         run Streamable HTTP on /mcp",
          "  --port <n>               HTTP port (default: $PORT or 3000)",
          "  --host <addr>            HTTP bind address (default: $HOST or 0.0.0.0)",
        ].join("\n"),
      );
      process.exit(0);
    }
  }

  if (!Number.isFinite(options.port)) throw new Error("--port must be a number");
  return options;
}

async function runStdio(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error(`[${SERVER_NAME}] listening on stdio`);
}

async function runHttp(options: Options): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use(
    cors({
      origin: true,
      exposedHeaders: ["Mcp-Session-Id"],
      allowedHeaders: ["Content-Type", "Accept", "Mcp-Session-Id", "MCP-Protocol-Version"],
    }),
  );

  // One server instance per session. Session state matters here: capability
  // negotiation happens once at initialize, and a stateless transport would drop it.
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  app.get("/health", (_req, res) => {
    res.json({ name: SERVER_NAME, version: SERVER_VERSION, sessions: sessions.size });
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
            console.error(`[${SERVER_NAME}] session opened: ${id}`);
          },
          onsessionclosed: (id) => {
            sessions.delete(id);
            console.error(`[${SERVER_NAME}] session closed: ${id}`);
          },
        });
        transport.onclose = () => {
          if (transport?.sessionId) sessions.delete(transport.sessionId);
        };

        await createServer().connect(transport);
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(`[${SERVER_NAME}] request failed:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  await new Promise<void>((resolve) => {
    app.listen(options.port, options.host, () => {
      console.error(
        `[${SERVER_NAME}] listening on http://${options.host}:${options.port}/mcp`,
      );
      resolve();
    });
  });
}

const options = parseArgs(process.argv.slice(2));
if (options.transport === "stdio") {
  await runStdio();
} else {
  await runHttp(options);
}

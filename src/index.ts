#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const BASE_URL = process.env.MADEONSOL_API_URL || "https://madeonsol.com";
const PRIVATE_KEY = process.env.SVM_PRIVATE_KEY;
const PORT = parseInt(process.env.PORT || "3100", 10);
const MODE = process.env.MCP_TRANSPORT || "stdio"; // "stdio" or "http"

let paidFetch: typeof fetch = fetch;

async function initPayment() {
  if (!PRIVATE_KEY) {
    console.error("[madeonsol-mcp] No SVM_PRIVATE_KEY — tools will return 402 payment info");
    return;
  }
  try {
    const { wrapFetchWithPayment } = await import("@x402/fetch");
    const { x402Client } = await import("@x402/core/client");
    const { ExactSvmScheme } = await import("@x402/svm/exact/client");
    const { createKeyPairSignerFromBytes } = await import("@solana/kit");
    const { base58 } = await import("@scure/base");

    const signer = await createKeyPairSignerFromBytes(base58.decode(PRIVATE_KEY));
    const client = new x402Client();
    client.register("solana:*", new ExactSvmScheme(signer));
    paidFetch = wrapFetchWithPayment(fetch, client);
    console.error(`[madeonsol-mcp] x402 payments enabled, wallet: ${signer.address}`);
  } catch (err) {
    console.error("[madeonsol-mcp] x402 setup failed:", err);
  }
}

async function query(path: string, params?: Record<string, string | number>) {
  const url = new URL(path, BASE_URL);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const res = await paidFetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return `Error ${res.status}: ${body}`;
  }
  return JSON.stringify(await res.json(), null, 2);
}

function registerTools(server: McpServer) {
  server.tool(
    "madeonsol_kol_feed",
    "Get real-time Solana KOL trades from 946 tracked wallets. Costs $0.005 USDC per request via x402.",
    {
      limit: z.number().min(1).max(100).default(10).describe("Number of trades to return"),
      action: z.enum(["buy", "sell"]).optional().describe("Filter by trade type"),
      kol: z.string().optional().describe("Filter by KOL wallet address"),
    },
    async ({ limit, action, kol }) => {
      const params: Record<string, string | number> = { limit };
      if (action) params.action = action;
      if (kol) params.kol = kol;
      return { content: [{ type: "text" as const, text: await query("/api/x402/kol/feed", params) }] };
    }
  );

  server.tool(
    "madeonsol_kol_coordination",
    "Get KOL convergence signals — tokens being accumulated by multiple KOLs simultaneously. Costs $0.02 USDC per request via x402.",
    {
      period: z.enum(["1h", "6h", "24h", "7d"]).default("24h").describe("Time period"),
      min_kols: z.number().min(2).max(50).default(3).describe("Minimum KOLs converging"),
      limit: z.number().min(1).max(50).default(20).describe("Number of results"),
    },
    async ({ period, min_kols, limit }) => ({
      content: [{ type: "text" as const, text: await query("/api/x402/kol/coordination", { period, min_kols, limit }) }],
    })
  );

  server.tool(
    "madeonsol_kol_leaderboard",
    "Get KOL performance rankings by PnL and win rate. Costs $0.005 USDC per request via x402.",
    {
      period: z.enum(["today", "7d", "30d"]).default("7d").describe("Time period"),
      limit: z.number().min(1).max(50).default(20).describe("Number of KOLs"),
    },
    async ({ period, limit }) => ({
      content: [{ type: "text" as const, text: await query("/api/x402/kol/leaderboard", { period, limit }) }],
    })
  );

  server.tool(
    "madeonsol_deployer_alerts",
    "Get real-time alerts from elite Pump.fun deployers with KOL buy enrichment. Costs $0.01 USDC per request via x402.",
    {
      limit: z.number().min(1).max(100).default(10).describe("Number of alerts"),
      offset: z.number().min(0).default(0).describe("Pagination offset"),
    },
    async ({ limit, offset }) => ({
      content: [{ type: "text" as const, text: await query("/api/x402/deployer-hunter/alerts", { limit, offset }) }],
    })
  );

  server.tool(
    "madeonsol_discovery",
    "List all available MadeOnSol x402 API endpoints with prices and parameter docs. Free, no payment required.",
    {},
    async () => {
      const res = await fetch(new URL("/api/x402", BASE_URL).toString());
      const data = await res.json();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}

async function main() {
  await initPayment();

  if (MODE === "http") {
    // HTTP transport for hosted environments (Smithery, etc.)
    const httpServer = createServer();
    const transports = new Map<string, StreamableHTTPServerTransport>();

    httpServer.on("request", async (req, res) => {
      // Health check
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", server: "madeonsol-mcp" }));
        return;
      }

      // MCP endpoint
      if (req.url === "/mcp" || req.url === "/") {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        if (req.method === "POST") {
          let transport = sessionId ? transports.get(sessionId) : undefined;

          if (!transport) {
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
            });
            const server = new McpServer({ name: "madeonsol", version: "0.1.0" });
            registerTools(server);
            await server.connect(transport);
            const newSessionId = transport.sessionId;
            if (newSessionId) transports.set(newSessionId, transport);
          }

          await transport.handleRequest(req, res);
          return;
        }

        if (req.method === "GET" && sessionId) {
          const transport = transports.get(sessionId);
          if (transport) {
            await transport.handleRequest(req, res);
            return;
          }
        }

        if (req.method === "DELETE" && sessionId) {
          const transport = transports.get(sessionId);
          if (transport) {
            await transport.handleRequest(req, res);
            transports.delete(sessionId);
            return;
          }
        }
      }

      res.writeHead(404);
      res.end("Not found");
    });

    httpServer.listen(PORT, () => {
      console.error(`[madeonsol-mcp] HTTP server listening on port ${PORT}`);
    });
  } else {
    // Stdio transport for local use (Claude Desktop, Cursor, Claude Code)
    const server = new McpServer({ name: "madeonsol", version: "0.1.0" });
    registerTools(server);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch(console.error);

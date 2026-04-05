#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const BASE_URL = process.env.MADEONSOL_API_URL || "https://madeonsol.com";
const MADEONSOL_API_KEY = process.env.MADEONSOL_API_KEY; // Native key from madeonsol.com/developer
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY; // RapidAPI subscription key
const PRIVATE_KEY = process.env.SVM_PRIVATE_KEY; // x402 micropayments (for AI agents)
const PORT = parseInt(process.env.PORT || "3100", 10);
const MODE = process.env.MCP_TRANSPORT || "stdio"; // "stdio" or "http"

// Auth mode: MADEONSOL_API_KEY > RAPIDAPI_KEY > SVM_PRIVATE_KEY (x402)
type AuthMode = "madeonsol" | "rapidapi" | "x402" | "none";
let authMode: AuthMode = "none";
let paidFetch: typeof fetch = fetch;

function apiKeyHeaders(): Record<string, string> {
  if (authMode === "madeonsol") {
    return { Authorization: `Bearer ${MADEONSOL_API_KEY}` };
  }
  if (authMode === "rapidapi") {
    return {
      "x-rapidapi-key": RAPIDAPI_KEY!,
      "x-rapidapi-host": "madeonsol-solana-kol-tracker-tools-api.p.rapidapi.com",
    };
  }
  return {};
}

async function initAuth() {
  if (MADEONSOL_API_KEY) {
    authMode = "madeonsol";
    console.error("[madeonsol-mcp] Using MadeOnSol API key (Bearer auth)");
    return;
  }
  if (RAPIDAPI_KEY) {
    authMode = "rapidapi";
    console.error("[madeonsol-mcp] Using RapidAPI key");
    return;
  }
  if (PRIVATE_KEY) {
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
      authMode = "x402";
      console.error(`[madeonsol-mcp] x402 payments enabled, wallet: ${signer.address}`);
      return;
    } catch (err) {
      console.error("[madeonsol-mcp] x402 setup failed:", err);
    }
  }
  console.error("[madeonsol-mcp] No auth configured. Set MADEONSOL_API_KEY (get one free at madeonsol.com/developer), RAPIDAPI_KEY, or SVM_PRIVATE_KEY.");
}

async function query(path: string, params?: Record<string, string | number>) {
  // API key and RapidAPI auth use /api/v1/ endpoints; x402 uses /api/x402/
  const apiPath = authMode === "x402" || authMode === "none"
    ? path
    : path.replace("/api/x402/", "/api/v1/");
  const url = new URL(apiPath, BASE_URL);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const headers = apiKeyHeaders();
  const res = authMode === "x402"
    ? await paidFetch(url.toString())
    : await fetch(url.toString(), { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return `Error ${res.status}: ${body}`;
  }
  return JSON.stringify(await res.json(), null, 2);
}

function registerTools(server: McpServer) {
  const readOnlyAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

  server.tool(
    "madeonsol_kol_feed",
    "Get real-time Solana KOL trades from 946 tracked wallets.",
    {
      limit: z.number().min(1).max(100).default(10).describe("Number of trades to return (1-100)"),
      action: z.enum(["buy", "sell"]).optional().describe("Filter by trade type: buy or sell"),
      kol: z.string().optional().describe("Filter by specific KOL wallet address (base58)"),
    },
    readOnlyAnnotations,
    async ({ limit, action, kol }) => {
      const params: Record<string, string | number> = { limit };
      if (action) params.action = action;
      if (kol) params.kol = kol;
      return { content: [{ type: "text" as const, text: await query("/api/x402/kol/feed", params) }] };
    }
  );

  server.tool(
    "madeonsol_kol_coordination",
    "Get KOL convergence signals — tokens being accumulated by multiple KOLs simultaneously.",
    {
      period: z.enum(["1h", "6h", "24h", "7d"]).default("24h").describe("Time period for coordination analysis"),
      min_kols: z.number().min(2).max(50).default(3).describe("Minimum number of KOLs converging on the same token"),
      limit: z.number().min(1).max(50).default(20).describe("Number of coordination signals to return"),
    },
    readOnlyAnnotations,
    async ({ period, min_kols, limit }) => ({
      content: [{ type: "text" as const, text: await query("/api/x402/kol/coordination", { period, min_kols, limit }) }],
    })
  );

  server.tool(
    "madeonsol_kol_leaderboard",
    "Get KOL performance rankings by PnL and win rate.",
    {
      period: z.enum(["today", "7d", "30d"]).default("7d").describe("Time period for leaderboard: today, 7d, or 30d"),
      limit: z.number().min(1).max(50).default(20).describe("Number of KOLs to return in ranking"),
    },
    readOnlyAnnotations,
    async ({ period, limit }) => ({
      content: [{ type: "text" as const, text: await query("/api/x402/kol/leaderboard", { period, limit }) }],
    })
  );

  server.tool(
    "madeonsol_deployer_alerts",
    "Get real-time alerts from elite Pump.fun deployers with KOL buy enrichment.",
    {
      limit: z.number().min(1).max(100).default(10).describe("Number of deployer alerts to return (1-100)"),
      offset: z.number().min(0).default(0).describe("Pagination offset for deployer alerts"),
    },
    readOnlyAnnotations,
    async ({ limit, offset }) => ({
      content: [{ type: "text" as const, text: await query("/api/x402/deployer-hunter/alerts", { limit, offset }) }],
    })
  );

  server.tool(
    "madeonsol_discovery",
    "List all available MadeOnSol API endpoints with prices and parameter docs. Free, no auth required.",
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async () => {
      const res = await fetch(new URL("/api/x402", BASE_URL).toString());
      const data = await res.json();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Webhook & Streaming tools (require API key or RapidAPI key — Pro/Ultra tier) ──

  const hasRestAuth = authMode === "madeonsol" || authMode === "rapidapi";
  if (hasRestAuth) {
    async function restQuery(method: string, path: string, body?: unknown): Promise<string> {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...apiKeyHeaders(),
      };
      const res = await fetch(`${BASE_URL}/api/v1${path}`, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return `Error ${res.status}: ${text}`;
      }
      return JSON.stringify(await res.json(), null, 2);
    }

    const webhookAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

    server.tool(
      "madeonsol_create_webhook",
      "Register a webhook URL to receive real-time push notifications for KOL trades and deployer alerts. Requires Pro/Ultra subscription.",
      {
        url: z.string().url().describe("HTTPS webhook URL to receive events"),
        events: z.array(z.enum(["kol:trade", "kol:coordination", "deployer:alert", "deployer:bond"])).min(1).describe("Event types to subscribe to"),
        min_sol: z.number().optional().describe("Optional: minimum SOL amount filter (for kol:trade)"),
        action: z.enum(["buy", "sell"]).optional().describe("Optional: filter by buy or sell only"),
        deployer_tier: z.array(z.string()).optional().describe("Optional: filter by deployer tiers, e.g. ['elite', 'good']"),
      },
      webhookAnnotations,
      async ({ url, events, min_sol, action, deployer_tier }) => {
        const filters: Record<string, unknown> = {};
        if (min_sol) filters.min_sol = min_sol;
        if (action) filters.action = action;
        if (deployer_tier) filters.deployer_tier = deployer_tier;
        return { content: [{ type: "text" as const, text: await restQuery("POST", "/webhooks", { url, events, filters }) }] };
      }
    );

    server.tool(
      "madeonsol_list_webhooks",
      "List all your registered webhooks with delivery status and failure counts.",
      {},
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      async () => ({
        content: [{ type: "text" as const, text: await restQuery("GET", "/webhooks") }],
      })
    );

    server.tool(
      "madeonsol_delete_webhook",
      "Delete a webhook by ID. Permanently removes the webhook and its delivery history.",
      {
        id: z.number().describe("Webhook ID to delete"),
      },
      { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      async ({ id }) => ({
        content: [{ type: "text" as const, text: await restQuery("DELETE", `/webhooks/${id}`) }],
      })
    );

    server.tool(
      "madeonsol_test_webhook",
      "Send a sample event payload to a webhook URL to verify it works. Returns status code and response time.",
      {
        webhook_id: z.number().describe("ID of the webhook to test"),
      },
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      async ({ webhook_id }) => ({
        content: [{ type: "text" as const, text: await restQuery("POST", "/webhooks/test", { webhook_id }) }],
      })
    );

    server.tool(
      "madeonsol_stream_token",
      "Generate a 24h WebSocket streaming token. Includes ws_url for KOL/deployer streaming (Pro/Ultra) and dex_ws_url for all-DEX trade streaming (Ultra only).",
      {},
      { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      async () => ({
        content: [{ type: "text" as const, text: await restQuery("POST", "/stream/token") }],
      })
    );

    console.error("[madeonsol-mcp] Webhook & streaming tools enabled");
  } else {
    console.error("[madeonsol-mcp] Webhook/streaming tools disabled (requires MADEONSOL_API_KEY or RAPIDAPI_KEY)");
  }

  // Prompts — pre-built analysis templates
  server.prompt(
    "solana_kol_analysis",
    "Analyze current Solana KOL trading activity — what are smart money wallets buying and selling?",
    { period: z.string().default("24h").describe("Time period: 1h, 6h, 24h, or 7d") },
    ({ period }) => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: `Analyze Solana KOL activity for the last ${period}. First get the KOL feed for recent trades, then check the coordination signals to see what tokens multiple KOLs are converging on, and finally show the leaderboard to see who's performing best. Summarize the key trends.` },
      }],
    })
  );

  server.prompt(
    "deployer_scout",
    "Scout for new high-potential token launches from elite Pump.fun deployers",
    {},
    () => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: "Check the latest deployer alerts for new token launches from elite Pump.fun deployers. For each alert, note the deployer tier, bonding rate, and whether any KOLs have already bought in. Highlight the most promising launches." },
      }],
    })
  );

  // Resources — static info about the API
  server.resource(
    "api-overview",
    "madeonsol://api-overview",
    { description: "MadeOnSol x402 API overview — endpoints, pricing, and how it works", mimeType: "application/json" },
    async () => {
      const res = await fetch(new URL("/api/x402", BASE_URL).toString());
      const data = await res.json();
      return { contents: [{ uri: "madeonsol://api-overview", text: JSON.stringify(data, null, 2), mimeType: "application/json" }] };
    }
  );
}

async function main() {
  await initAuth();

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

      // Smithery server card for discovery
      if (req.method === "GET" && req.url === "/.well-known/mcp/server-card.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          name: "madeonsol",
          description: "Solana KOL trading intelligence and deployer analytics. Real-time data from 946 KOL wallets and 4000+ Pump.fun deployers. Supports API key, RapidAPI, or x402 micropayments.",
          version: "0.1.0",
          tools: [
            { name: "madeonsol_kol_feed", description: "Get real-time Solana KOL trades from 946 tracked wallets." },
            { name: "madeonsol_kol_coordination", description: "Get KOL convergence signals — tokens multiple KOLs are accumulating." },
            { name: "madeonsol_kol_leaderboard", description: "Get KOL performance rankings by PnL and win rate." },
            { name: "madeonsol_deployer_alerts", description: "Get elite Pump.fun deployer alerts with KOL enrichment." },
            { name: "madeonsol_discovery", description: "List all available endpoints with prices. Free." },
            { name: "madeonsol_create_webhook", description: "Register a webhook for real-time push notifications. Pro/Ultra." },
            { name: "madeonsol_list_webhooks", description: "List your registered webhooks. Pro/Ultra." },
            { name: "madeonsol_delete_webhook", description: "Delete a webhook by ID. Pro/Ultra." },
            { name: "madeonsol_test_webhook", description: "Send a test payload to verify a webhook. Pro/Ultra." },
            { name: "madeonsol_stream_token", description: "Get a 24h WebSocket streaming token. Pro/Ultra." },
          ],
          homepage: "https://madeonsol.com/solana-api",
          repository: "https://github.com/LamboPoewert/mcp-server-madeonsol",
        }));
        return;
      }

      // MCP endpoint
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      {
        if (req.method === "POST") {
          let transport = sessionId ? transports.get(sessionId) : undefined;

          if (!transport) {
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: undefined,
            });
            const server = new McpServer({ name: "madeonsol", version: "0.1.0" });
            registerTools(server);
            await server.connect(transport);
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

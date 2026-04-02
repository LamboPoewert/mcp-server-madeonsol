#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer } from "node:http";
const BASE_URL = process.env.MADEONSOL_API_URL || "https://madeonsol.com";
const PRIVATE_KEY = process.env.SVM_PRIVATE_KEY;
const PORT = parseInt(process.env.PORT || "3100", 10);
const MODE = process.env.MCP_TRANSPORT || "stdio"; // "stdio" or "http"
let paidFetch = fetch;
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
    }
    catch (err) {
        console.error("[madeonsol-mcp] x402 setup failed:", err);
    }
}
async function query(path, params) {
    const url = new URL(path, BASE_URL);
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined)
                url.searchParams.set(k, String(v));
        }
    }
    const res = await paidFetch(url.toString());
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        return `Error ${res.status}: ${body}`;
    }
    return JSON.stringify(await res.json(), null, 2);
}
function registerTools(server) {
    const readOnlyAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
    server.tool("madeonsol_kol_feed", "Get real-time Solana KOL trades from 946 tracked wallets. Costs $0.005 USDC per request via x402.", {
        limit: z.number().min(1).max(100).default(10).describe("Number of trades to return (1-100)"),
        action: z.enum(["buy", "sell"]).optional().describe("Filter by trade type: buy or sell"),
        kol: z.string().optional().describe("Filter by specific KOL wallet address (base58)"),
    }, readOnlyAnnotations, async ({ limit, action, kol }) => {
        const params = { limit };
        if (action)
            params.action = action;
        if (kol)
            params.kol = kol;
        return { content: [{ type: "text", text: await query("/api/x402/kol/feed", params) }] };
    });
    server.tool("madeonsol_kol_coordination", "Get KOL convergence signals — tokens being accumulated by multiple KOLs simultaneously. Costs $0.02 USDC per request via x402.", {
        period: z.enum(["1h", "6h", "24h", "7d"]).default("24h").describe("Time period for coordination analysis"),
        min_kols: z.number().min(2).max(50).default(3).describe("Minimum number of KOLs converging on the same token"),
        limit: z.number().min(1).max(50).default(20).describe("Number of coordination signals to return"),
    }, readOnlyAnnotations, async ({ period, min_kols, limit }) => ({
        content: [{ type: "text", text: await query("/api/x402/kol/coordination", { period, min_kols, limit }) }],
    }));
    server.tool("madeonsol_kol_leaderboard", "Get KOL performance rankings by PnL and win rate. Costs $0.005 USDC per request via x402.", {
        period: z.enum(["today", "7d", "30d"]).default("7d").describe("Time period for leaderboard: today, 7d, or 30d"),
        limit: z.number().min(1).max(50).default(20).describe("Number of KOLs to return in ranking"),
    }, readOnlyAnnotations, async ({ period, limit }) => ({
        content: [{ type: "text", text: await query("/api/x402/kol/leaderboard", { period, limit }) }],
    }));
    server.tool("madeonsol_deployer_alerts", "Get real-time alerts from elite Pump.fun deployers with KOL buy enrichment. Costs $0.01 USDC per request via x402.", {
        limit: z.number().min(1).max(100).default(10).describe("Number of deployer alerts to return (1-100)"),
        offset: z.number().min(0).default(0).describe("Pagination offset for deployer alerts"),
    }, readOnlyAnnotations, async ({ limit, offset }) => ({
        content: [{ type: "text", text: await query("/api/x402/deployer-hunter/alerts", { limit, offset }) }],
    }));
    server.tool("madeonsol_discovery", "List all available MadeOnSol x402 API endpoints with prices and parameter docs. Free, no payment required.", {}, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, async () => {
        const res = await fetch(new URL("/api/x402", BASE_URL).toString());
        const data = await res.json();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    });
    // Prompts — pre-built analysis templates
    server.prompt("solana_kol_analysis", "Analyze current Solana KOL trading activity — what are smart money wallets buying and selling?", { period: z.string().default("24h").describe("Time period: 1h, 6h, 24h, or 7d") }, ({ period }) => ({
        messages: [{
                role: "user",
                content: { type: "text", text: `Analyze Solana KOL activity for the last ${period}. First get the KOL feed for recent trades, then check the coordination signals to see what tokens multiple KOLs are converging on, and finally show the leaderboard to see who's performing best. Summarize the key trends.` },
            }],
    }));
    server.prompt("deployer_scout", "Scout for new high-potential token launches from elite Pump.fun deployers", {}, () => ({
        messages: [{
                role: "user",
                content: { type: "text", text: "Check the latest deployer alerts for new token launches from elite Pump.fun deployers. For each alert, note the deployer tier, bonding rate, and whether any KOLs have already bought in. Highlight the most promising launches." },
            }],
    }));
    // Resources — static info about the API
    server.resource("api-overview", "madeonsol://api-overview", { description: "MadeOnSol x402 API overview — endpoints, pricing, and how it works", mimeType: "application/json" }, async () => {
        const res = await fetch(new URL("/api/x402", BASE_URL).toString());
        const data = await res.json();
        return { contents: [{ uri: "madeonsol://api-overview", text: JSON.stringify(data, null, 2), mimeType: "application/json" }] };
    });
}
async function main() {
    await initPayment();
    if (MODE === "http") {
        // HTTP transport for hosted environments (Smithery, etc.)
        const httpServer = createServer();
        const transports = new Map();
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
                    description: "Solana KOL trading intelligence and deployer analytics via x402 micropayments. Real-time data from 946 KOL wallets and 4000+ Pump.fun deployers.",
                    version: "0.1.0",
                    tools: [
                        { name: "madeonsol_kol_feed", description: "Get real-time Solana KOL trades from 946 tracked wallets. $0.005 USDC/req." },
                        { name: "madeonsol_kol_coordination", description: "Get KOL convergence signals — tokens multiple KOLs are accumulating. $0.02 USDC/req." },
                        { name: "madeonsol_kol_leaderboard", description: "Get KOL performance rankings by PnL and win rate. $0.005 USDC/req." },
                        { name: "madeonsol_deployer_alerts", description: "Get elite Pump.fun deployer alerts with KOL enrichment. $0.01 USDC/req." },
                        { name: "madeonsol_discovery", description: "List all available endpoints with prices. Free." },
                    ],
                    homepage: "https://madeonsol.com/solana-api",
                    repository: "https://github.com/LamboPoewert/mcp-server-madeonsol",
                }));
                return;
            }
            // MCP endpoint
            const sessionId = req.headers["mcp-session-id"];
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
    }
    else {
        // Stdio transport for local use (Claude Desktop, Cursor, Claude Code)
        const server = new McpServer({ name: "madeonsol", version: "0.1.0" });
        registerTools(server);
        const transport = new StdioServerTransport();
        await server.connect(transport);
    }
}
main().catch(console.error);

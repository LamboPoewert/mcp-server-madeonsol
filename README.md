# mcp-server-madeonsol

MCP server for [MadeOnSol](https://madeonsol.com) Solana KOL intelligence API. Use from Claude Desktop, Cursor, or any MCP-compatible client.

## Authentication

Three options (in priority order):

| Method | Env var | Best for |
|---|---|---|
| **MadeOnSol API key** (recommended) | `MADEONSOL_API_KEY` | Developers — [get a free key](https://madeonsol.com/developer) |
| RapidAPI key | `RAPIDAPI_KEY` | RapidAPI subscribers |
| x402 micropayments | `SVM_PRIVATE_KEY` | AI agents with Solana wallets |

## Install

```bash
npm install -g mcp-server-madeonsol
```

> x402 peer deps (`@x402/fetch @x402/svm @x402/core @solana/kit @scure/base`) are only needed when using `SVM_PRIVATE_KEY`.

## Configure

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "madeonsol": {
      "command": "mcp-server-madeonsol",
      "env": {
        "MADEONSOL_API_KEY": "msk_your_api_key_here"
      }
    }
  }
}
```

### Cursor

Add to MCP settings with the same command and env vars.

## Tools

| Tool | Description |
|---|---|
| `madeonsol_kol_feed` | Real-time KOL trade feed (946 wallets) |
| `madeonsol_kol_coordination` | Multi-KOL convergence signals |
| `madeonsol_kol_leaderboard` | KOL PnL and win rate rankings |
| `madeonsol_deployer_alerts` | Elite Pump.fun deployer launches |
| `madeonsol_discovery` | List all endpoints and prices (free) |

**With Pro/Ultra subscription:**

| Tool | Description |
|---|---|
| `madeonsol_stream_token` | Get 24h WebSocket token for KOL/deployer streaming and DEX trade stream |
| Webhook CRUD tools | Create, list, update, delete, test webhooks |

## Also Available

| Platform | Package |
|---|---|
| TypeScript SDK | [`madeonsol-x402`](https://www.npmjs.com/package/madeonsol-x402) |
| Python (LangChain, CrewAI) | [`madeonsol-x402`](https://github.com/LamboPoewert/madeonsol-python) on PyPI |
| ElizaOS | [`@madeonsol/plugin-madeonsol`](https://www.npmjs.com/package/@madeonsol/plugin-madeonsol) |
| Solana Agent Kit | [`solana-agent-kit-plugin-madeonsol`](https://www.npmjs.com/package/solana-agent-kit-plugin-madeonsol) |

## License

MIT

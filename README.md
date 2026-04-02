# mcp-server-madeonsol

MCP server for [MadeOnSol](https://madeonsol.com) Solana KOL intelligence API. Use from Claude Desktop, Cursor, or any MCP-compatible client.

## Install

```bash
npm install -g mcp-server-madeonsol @x402/fetch @x402/svm @x402/core @solana/kit @scure/base
```

## Configure

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "madeonsol": {
      "command": "mcp-server-madeonsol",
      "env": {
        "SVM_PRIVATE_KEY": "your_solana_private_key_base58"
      }
    }
  }
}
```

### Cursor

Add to MCP settings with the same command and env vars.

## Tools

| Tool | Price | Description |
|---|---|---|
| `madeonsol_kol_feed` | $0.005 | Real-time KOL trade feed (946 wallets) |
| `madeonsol_kol_coordination` | $0.02 | Multi-KOL convergence signals |
| `madeonsol_kol_leaderboard` | $0.005 | KOL PnL and win rate rankings |
| `madeonsol_deployer_alerts` | $0.01 | Elite Pump.fun deployer launches |
| `madeonsol_discovery` | Free | List all endpoints and prices |

## How It Works

The server uses the x402 payment protocol. Each tool call triggers a USDC micropayment on Solana. Your wallet needs SOL (for fees) and USDC.

Without `SVM_PRIVATE_KEY`, tools return payment requirement info instead of data.

## License

MIT

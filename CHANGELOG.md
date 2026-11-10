# Changelog

## 0.1.0 (2026-10-28)

- First release: a forwarding client for the hosted HasData Google Flights deals MCP server, serving the one captured tool locally for tools/list and forwarding every tools/call upstream over a streamable-HTTP JSON-RPC session (initialize, notifications/initialized, tools/call, honouring the Mcp-Session-Id header when issued).
- Tool: `hasdata_google_travel_flights_deals_getGoogleFlightsDeals`.
- Upstream results pass through verbatim; upstream failures surface as `dealdata error:` text results.
- One bin serves the CLI (one subcommand per tool, plus `--version`) and the stdio MCP server (`mcp` subcommand). Upstream endpoint overridable via `HASDATA_GOOGLE_FLIGHTS_DEALS_MCP_URL`; when `HASDATA_API_KEY` is set it is sent as an `x-api-key` header.

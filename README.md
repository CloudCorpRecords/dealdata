# dealdata

dealdata is a small local bridge to the hosted HasData
Google Flights deals MCP server. Give it a plain-language
trip idea — a beach escape, cherry blossom in Japan, a
fireworks festival in Hong Kong — plus one origin airport,
and Google chooses the destinations and travel dates,
returning deals with outbound and return dates, price,
flight duration, trip length, stops, operating airline,
departure and arrival airports, and a direct Google
Flights link. When Google shaped the search itself, a
deal may also carry the typical price with its discount
and a destination description with a photo, along with
the date range Google derived from the query.

The bridge stores no fares of its own. It serves the
upstream server's tool list locally, exactly as captured
from the live endpoint, and forwards each tool call
upstream, returning the result untouched. The captured
surface is a single read-only deals search: published
fare data only, with no booking, reservation, ticketing
or payment tool in it.

## Tools

- `hasdata_google_travel_flights_deals_getGoogleFlightsDeals`
  — turn a trip description into Google Flights deals.
  Required: `q` (the plain-language trip description)
  and `departureId` (one origin airport as a 3-letter
  uppercase IATA code). Optional: `arrivalId` (pin one
  destination by IATA code or location kgmid; every
  fare filter requires it), `type` (round trip or one
  way), `travelClass` (economy, premium economy,
  business, first), `outboundDate` and `returnDate`
  (exact dates or windows), `travelDuration` (week,
  weekend, two weeks), `tripLength` (days, exact or
  range), `stops`, `maxDuration` (minutes per leg),
  `maxPrice`, `includeAirlines` / `excludeAirlines`,
  `adults`, `children`, `infantsInSeat`, `infantsOnLap`
  (the whole party must not exceed 9), and `gl`, `hl`,
  `currency` for localisation.

## Configuration

- `HASDATA_GOOGLE_FLIGHTS_DEALS_MCP_URL` (optional) —
  override the upstream endpoint. Defaults to
  `https://mcp.hasdata.com/mcp?apis=google_travel_flights_deals`.
  (The override hook is this rebuild's own labelled
  reconstruction.)
- `HASDATA_API_KEY` (optional) — when set, every
  upstream request carries an `x-api-key: <key>`
  header, for the caller's own HasData API key. When
  it is not set, no key header is sent. (The header
  name and the env name are pinned by the original's
  registry record; forwarding the key from this env
  var is a labelled reconstruction — the original
  surface was captured keyless.)

### Forwarding mechanics

On the first tool call the client opens a streamable
HTTP session with the upstream: a JSON-RPC
`initialize` request (protocolVersion `2025-03-26`,
clientInfo name `dealdata`), then a
`notifications/initialized` notification, then the
`tools/call` request carrying the caller's arguments
unchanged. When the upstream answers `initialize`
with an `Mcp-Session-Id` header, that value rides on
every later request of the session, which is reused
for the life of the process. Replies may arrive as
plain JSON or as server-sent events; both are read.

Successful upstream results pass through verbatim,
including any `isError` flag the upstream sets.
Failures — a JSON-RPC error, a non-2xx status, an
unreadable response, or a request that cannot be
completed — come back as an `isError` result whose
text starts with `dealdata error:` (this rendering
is this rebuild's own labelled reconstruction).

## CLI

The tool is also a subcommand taking one JSON
argument string:

```bash
npx @reneturcios/dealdata hasdata_google_travel_flights_deals_getGoogleFlightsDeals '{"q":"beach escape","departureId":"LAX"}'
npx @reneturcios/dealdata --version
```

Exit codes: `0` on success, `1` on an `isError`
result, `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/dealdata mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "dealdata": {
      "command": "npx",
      "args": ["-y", "@reneturcios/dealdata", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/dealdata
docker run --rm ghcr.io/cloudcorprecords/dealdata --version
```

The container's default command is `mcp`, so the first
form is a stdio MCP server; any other arguments reach
the CLI normally.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

The test suite runs entirely against a stubbed
JSON-RPC upstream — no live network calls.

## License

MIT — see `LICENSE`.

/**
 * dealdata core: a forwarding client for the hosted
 * HasData Google Flights deals MCP server.
 *
 * No deal search is run locally. tools/list is answered from
 * the literal tool definition below, taken verbatim from
 * a live capture of the upstream server (name, title,
 * description and inputSchema exactly as captured,
 * including the title key the tool carries). A tools/call
 * is forwarded over a streamable-HTTP JSON-RPC session:
 * an initialize POST, a notifications/initialized POST,
 * then the tools/call POST, honouring the Mcp-Session-Id
 * response header when the upstream issues one. The
 * session is established lazily on the first forwarded
 * call and reused for the lifetime of the client.
 *
 * The upstream endpoint is pinned to
 * https://mcp.hasdata.com/mcp?apis=google_travel_flights_deals
 * — the query string is part of the pinned URL — and can be
 * overridden with the HASDATA_GOOGLE_FLIGHTS_DEALS_MCP_URL
 * environment variable (that override is a labelled
 * reconstruction). When HASDATA_API_KEY is set in the
 * environment, every upstream request carries an
 * `x-api-key: <key>` header (the header name is pinned by
 * the registry record's remote declaration; forwarding the
 * key from this env var is a labelled reconstruction — the
 * capture itself was taken keyless). When the variable is
 * unset, no key header is sent, and no Authorization header
 * is sent in either case.
 *
 * Upstream results pass through verbatim, including any
 * isError flag and any extra result fields. Failures — a
 * JSON-RPC error from the upstream, a non-2xx status, an
 * unparseable response, or a fetch that throws or times
 * out — surface as an isError result whose text starts
 * with `dealdata error:` (that rendering is a labelled
 * reconstruction). Responses may be plain JSON or SSE
 * (data: lines); the JSON-RPC message with the matching
 * id wins.
 */
import type {
  FetchFn,
  FetchResponseLike,
  ForwardDeps,
  ToolArgs,
  ToolDef,
  ToolResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_ENDPOINT_URL = "https://mcp.hasdata.com/mcp?apis=google_travel_flights_deals";

export const DEFAULT_TIMEOUT_MS = 30000;

export const PROTOCOL_VERSION = "2025-03-26";

/* ------------------------------------------------------------------ */
/* Tool definitions (tools/list literals, verbatim from the live       */
/* capture in harness/fixtures/hasdata-google-flights-deals-tools-original.json) */
/* ------------------------------------------------------------------ */

export const TOOL_DEFS: ToolDef[] = [
  {
    "name": "hasdata_google_travel_flights_deals_getGoogleFlightsDeals",
    "title": "google_travel_flights_deals: GET /",
    "description": "Get Google Flights Deals Results\n\nTurns a plain-language trip description (\"I would like to see cherry blossom in Japan\", \"beach escape\", \"fireworks festival in Hong Kong\") into flight deals from one origin airport, with Google's AI choosing the destinations and travel dates. Each deal carries outbound and return dates, price, flight duration, trip length in days, number of stops, operating airline, departure and arrival airports, and a direct Google Flights booking link; typical price with the discount against it, and a destination description with a photo, come back only for searches Google shaped itself. Also returns the date range Google derived from the query. Filters cover trip type, cabin class, stops, dates, trip length, price and duration ceilings, airlines and party size. Use for inspiration-driven travel search, seasonal and event-based fare discovery, deal alerting, and travel-content generation.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "q": {
          "type": "string",
          "description": "Free-text trip description, from a bare place name to a full sentence:\n\n  - **Destination**: `Tokyo`\n  - **Type of trip**: `beach escape`, `weekend getaway in Europe`\n  - **Season or event**: `I would like to see cherry blossom in Japan`\n\nWhen the query implies a time of year, Google dates it itself and reports the range in `searchInformation.dateRange`.\n"
        },
        "departureId": {
          "type": "string",
          "description": "Departure airport as a 3-letter uppercase IATA code, e.g. `LAX` or `LHR`. Search on [IATA](https://www.iata.org/en/publications/directories/code-search).\n\nOne airport per search; city names are not accepted.\n"
        },
        "arrivalId": {
          "type": "string",
          "description": "Pins the search to one destination instead of letting Google pick from the query.\n\n  - **IATA code**: 3 uppercase letters, e.g. `NRT` for Tokyo Narita.\n  - **Location kgmid**: starts with `/m/`, found in Wikidata under \"Freebase ID\", e.g. `/m/07dfk` for Tokyo.\n\nRequired by every filter: `type`, `travelClass`, `stops`, `outboundDate`, `returnDate`, `travelDuration`, `tripLength`, `maxPrice`, `maxDuration`, `includeAirlines` and `excludeAirlines`. Without it Google drops them silently.\n"
        },
        "type": {
          "type": "string",
          "enum": [
            "1",
            "roundTrip",
            "2",
            "oneWay"
          ],
          "description": "Flight type. Requires `arrivalId`.\n\n  - `1` / `roundTrip` — round trip (default)\n  - `2` / `oneWay` — one way\n\nA one-way deal carries no `returnDate` and no `tripLengthDays`.\n"
        },
        "travelClass": {
          "type": "string",
          "enum": [
            "1",
            "economy",
            "2",
            "premiumEconomy",
            "3",
            "business",
            "4",
            "first"
          ],
          "description": "Travel class. Requires `arrivalId`.\n\n  - `1` / `economy` — economy (default)\n  - `2` / `premiumEconomy` — premium economy\n  - `3` / `business` — business\n  - `4` / `first` — first\n\nFares climb steeply: on LAX-NRT the same search ran $730 in economy against $2882 in business.\n"
        },
        "outboundDate": {
          "type": "string",
          "description": "When to depart. Requires `arrivalId`.\n\n  - **Exact date**: `2026-12-10`\n  - **Window**: `2026-12-01,2026-12-10` — any day within it\n\nOmitted, Google picks the dates from the query, or from whatever is cheapest.\n"
        },
        "returnDate": {
          "type": "string",
          "description": "When to return, in the same exact-or-window spelling as `outboundDate`, which is required alongside it.\n\nCannot be combined with `travelDuration` or `tripLength` — all three set the trip length. Ignored when `type` is `oneWay`.\n"
        },
        "travelDuration": {
          "type": "string",
          "enum": [
            "1",
            "week",
            "2",
            "weekend",
            "3",
            "twoWeeks"
          ],
          "description": "Preset trip length. Requires `arrivalId`. Cannot be combined with `returnDate` or `tripLength`.\n\n  - `1` / `week` — about a week (6-8 days)\n  - `2` / `weekend` — a weekend (2-3 days)\n  - `3` / `twoWeeks` — about two weeks (13-15 days)\n\nPairs with `outboundDate` to limit the departure period. Ignored when `type` is `oneWay`.\n"
        },
        "tripLength": {
          "type": "string",
          "description": "Trip length in days. Requires `arrivalId`. Cannot be combined with `returnDate` or `travelDuration`.\n\n  - **Exact**: `7`\n  - **Range**: `5,10` — min first\n\nPairs with `outboundDate` to limit the departure period. Ignored when `type` is `oneWay`.\n"
        },
        "stops": {
          "type": "string",
          "enum": [
            "1",
            "nonStop",
            "2",
            "oneStopOrFewer",
            "3",
            "twoStopsOrFewer"
          ],
          "description": "Maximum number of stops. Requires `arrivalId`. Omitted, any number is allowed.\n\n  - `1` / `nonStop` — direct flights only\n  - `2` / `oneStopOrFewer` — at most one connection\n  - `3` / `twoStopsOrFewer` — at most two connections\n\nA route with nothing at that depth returns an empty `flightDeals` array, not an error — `nonStop` on a route without a direct flight is a valid, empty answer.\n"
        },
        "maxDuration": {
          "type": "number",
          "description": "Maximum flight duration in minutes — `1500` for 25 hours. Requires `arrivalId`. Omitted, it is unbounded. Applies to each leg, not to the round trip.\n\nGoogle measures against a longer figure than the `durationMinutes` it returns, so set the ceiling above the flight you want: on a route whose shortest deal is 635 minutes, `635` comes back empty and `680` returns it. On an empty result, raise `maxDuration` by up to 200 before concluding the route has nothing.\n"
        },
        "maxPrice": {
          "type": "number",
          "description": "Maximum ticket price, inclusive. Requires `arrivalId`. Omitted, it is unbounded.\n\nRead in the currency of the request: `650` means 650 EUR when `currency` is `EUR`, and 650 USD by default.\n"
        },
        "includeAirlines": {
          "type": "string",
          "description": "Keeps only these airlines. Requires `arrivalId`. Cannot be combined with `excludeAirlines`.\n\nComma-separated 2-character IATA codes (`AF`, `UA`, `B6`) and Google's alliances `STAR_ALLIANCE`, `SKYTEAM`, `ONEWORLD`. The two can be mixed.\n\nAn airline that does not serve the route returns an empty `flightDeals` array, not an error.\n"
        },
        "excludeAirlines": {
          "type": "string",
          "description": "Drops these airlines from the deals. Requires `arrivalId`. Cannot be combined with `includeAirlines`.\n\nTakes the same values as `includeAirlines`.\n"
        },
        "adults": {
          "type": "number",
          "description": "Number of adults. Prices cover the whole party, so raising this raises every deal price.\n\nPassenger counts reprice rather than narrow the search, so they need no `arrivalId`. The whole party must not exceed 9.\n"
        },
        "children": {
          "type": "number",
          "description": "Number of children, priced at their own fare. Counts towards the limit of 9 passengers.\n"
        },
        "infantsInSeat": {
          "type": "number",
          "description": "Number of infants in their own seat. Counts towards the limit of 9 passengers.\n"
        },
        "infantsOnLap": {
          "type": "number",
          "description": "Number of infants on an adult's lap. Counts towards the limit of 9 passengers.\n\nGoogle prices a lap infant above one in its own seat — the opposite of how airlines usually charge.\n"
        },
        "gl": {
          "type": "string",
          "description": "The two-letter country code for the country you want to limit the search to. Provide one exact documented value (245 allowed), e.g. `ac`, `af`."
        },
        "hl": {
          "type": "string",
          "description": "The two-letter language code for the language you want to use for the search. Provide one exact documented value (159 allowed), e.g. `af`, `ak`."
        },
        "currency": {
          "type": "string",
          "description": "Parameter defines the currency of the returned prices Provide one exact documented value (71 allowed), e.g. `ALL`, `DZD`."
        }
      },
      "required": [
        "q",
        "departureId"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  }
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/** Whether `name` is one of the captured tools. */
export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}

/* ------------------------------------------------------------------ */
/* Forwarding client                                                   */
/* ------------------------------------------------------------------ */

function errorResult(detail: string): ToolResult {
  return {
    content: [{ type: "text", text: `dealdata error: ${detail}` }],
    isError: true,
  };
}

function rpcErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Parse a JSON-RPC response body, tolerating SSE framing.
 * Returns the message whose id matches `expectedId` when
 * one is present, else the last parseable message, else
 * null when nothing parses.
 */
export function parseRpcBody(
  text: string,
  expectedId?: number,
): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const candidates: Record<string, unknown>[] = [];
  const tryPush = (payload: string): void => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        candidates.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not JSON; ignore this candidate.
    }
  };
  if (trimmed.includes("data:")) {
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice("data:".length).trim();
      if (payload !== "" && payload !== "[DONE]") tryPush(payload);
    }
  } else {
    tryPush(trimmed);
  }
  if (candidates.length === 0) return null;
  if (expectedId !== undefined) {
    const match = candidates.find((c) => c.id === expectedId);
    if (match !== undefined) return match;
  }
  return candidates[candidates.length - 1];
}

async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

/**
 * A forwarding client holding one upstream session. The
 * session is established lazily on the first forwarded
 * call and reused for the lifetime of the client (the
 * process lifetime when the client is the MCP server's
 * or a one-shot client for the CLI).
 */
export class DealdataClient {
  private readonly deps: ForwardDeps;
  private sessionId: string | null = null;
  private ready = false;
  private sessionPromise: Promise<void> | null = null;
  private idCounter = 0;

  constructor(deps: ForwardDeps = {}) {
    this.deps = deps;
  }

  private fetchFn(): FetchFn {
    return this.deps.fetchFn ?? defaultFetch;
  }

  private endpointUrl(): string {
    if (this.deps.url && this.deps.url.trim() !== "") return this.deps.url.trim();
    const raw = (this.deps.env ?? process.env).HASDATA_GOOGLE_FLIGHTS_DEALS_MCP_URL;
    if (raw && raw.trim() !== "") return raw.trim();
    return DEFAULT_ENDPOINT_URL;
  }

  private apiKey(): string | null {
    const raw = (this.deps.env ?? process.env).HASDATA_API_KEY;
    if (raw && raw.trim() !== "") return raw.trim();
    return null;
  }

  private timeoutMs(): number {
    if (typeof this.deps.timeoutMs === "number" && this.deps.timeoutMs > 0) {
      return this.deps.timeoutMs;
    }
    return DEFAULT_TIMEOUT_MS;
  }

  private nextId(): number {
    this.idCounter += 1;
    return this.idCounter;
  }

  private async post(
    body: unknown,
    withSession: boolean,
  ): Promise<FetchResponseLike> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const key = this.apiKey();
    if (key !== null) headers["x-api-key"] = key;
    if (withSession && this.sessionId !== null) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await this.fetchFn()(this.endpointUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.ready) return;
    if (this.sessionPromise === null) {
      this.sessionPromise = (async () => {
        const initId = this.nextId();
        const initRes = await this.post(
          {
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "dealdata", version: VERSION },
            },
          },
          false,
        );
        const sessionId = initRes.headers.get("mcp-session-id");
        if (sessionId) this.sessionId = sessionId;
        const initText = await initRes.text();
        const initParsed = parseRpcBody(initText, initId);
        if (initParsed !== null && initParsed.error) {
          throw new Error(rpcErrorMessage(initParsed.error));
        }
        if (initRes.status < 200 || initRes.status >= 300) {
          throw new Error(`HTTP ${initRes.status}`);
        }
        if (initParsed === null && initText.trim() !== "") {
          throw new Error("malformed response");
        }
        const initializedRes = await this.post(
          { jsonrpc: "2.0", method: "notifications/initialized" },
          true,
        );
        try {
          await initializedRes.text();
        } catch {
          // The notification response body carries nothing we need.
        }
        this.ready = true;
      })();
    }
    try {
      await this.sessionPromise;
    } catch (err) {
      this.sessionPromise = null;
      this.sessionId = null;
      throw err;
    }
  }

  /** Forward one tool call; upstream failures come back as isError results. */
  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    try {
      await this.ensureSession();
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    const callId = this.nextId();
    let callRes: FetchResponseLike;
    try {
      callRes = await this.post(
        {
          jsonrpc: "2.0",
          id: callId,
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        },
        true,
      );
    } catch (err) {
      return errorResult(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = parseRpcBody(await callRes.text(), callId);
    if (parsed !== null && parsed.error) {
      return errorResult(rpcErrorMessage(parsed.error));
    }
    if (callRes.status < 200 || callRes.status >= 300) {
      return errorResult(`HTTP ${callRes.status}`);
    }
    if (parsed === null) return errorResult("malformed response");
    const result = parsed.result as ToolResult | undefined;
    if (result === undefined || result === null || typeof result !== "object") {
      return errorResult("malformed response");
    }
    // Pass the upstream result through verbatim.
    return result;
  }
}

/** Create a forwarding client; tests inject a fake fetch and env through deps. */
export function createClient(deps: ForwardDeps = {}): DealdataClient {
  return new DealdataClient(deps);
}

/** One-shot helper: a fresh client per call (the CLI path). */
export async function callTool(
  name: string,
  args: ToolArgs,
  deps: ForwardDeps = {},
): Promise<ToolResult> {
  return new DealdataClient(deps).callTool(name, args);
}

import { Hono } from 'hono';

/**
 * The undocumented REST tool-execution API (`POST /api/mcp/tools/:name/execute`)
 * had no callers and has been removed; MCP clients use the Streamable HTTP
 * endpoint in mcp-sse.ts, and `GET /api/mcp/tools` now lives there behind
 * OAuth. This empty router only remains until index.ts stops mounting it.
 */
const mcp = new Hono();

export { mcp as mcpRoutes };

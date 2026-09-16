import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export type Source = {
  title: string; citation: string; excerpt: string;
  date?: string; gaceta?: string; official_source_name?: string; official_source_url?: string;
};
export type ToolStatus = {
  name: 'search_panama_law'; state: 'running' | 'success' | 'failure';
  latencyMs?: number; sources: Source[];
};

export function parseQuery(argumentsJson: string): { query: string } {
  const value: unknown = JSON.parse(argumentsJson);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 1 || !('query' in value)
    || typeof value.query !== 'string' || !value.query.trim() || value.query.length > 2000) {
    throw new Error('Invalid query');
  }
  return { query: value.query.trim() };
}

export function parseSources(value: unknown): Source[] {
  if (!value || typeof value !== 'object' || !('results' in value) || !Array.isArray(value.results)) {
    throw new Error('Invalid results');
  }
  return value.results.slice(0, 3).map((source: unknown) => {
    if (!source || typeof source !== 'object') throw new Error('Invalid source');
    const raw = source as Record<string, unknown>;
    for (const [field, limit] of [['title', 1000], ['citation', 1000], ['excerpt', 750]] as const) {
      if (typeof raw[field] !== 'string' || raw[field].length > limit) throw new Error('Invalid source');
    }
    const result: Source = { title: raw.title as string, citation: raw.citation as string, excerpt: raw.excerpt as string };
    for (const field of ['date', 'gaceta', 'official_source_name', 'official_source_url'] as const) {
      if (raw[field] == null) continue;
      if (typeof raw[field] !== 'string' || raw[field].length > 2000) throw new Error('Invalid metadata');
      if (field === 'official_source_url') {
        const url = new URL(raw[field]);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid source URL');
      }
      result[field] = raw[field];
    }
    return result;
  });
}

export async function connectResearch(token: string) {
  const endpoint = new URL(process.env.LEXLATAM_MCP_URL || 'https://app.lexlatam.ai/mcp/');
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('Invalid MCP URL');
  const client = new Client({ name: 'lexlatam-voice', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  try {
    await client.connect(transport, { timeout: 15_000 });
    const { tools } = await client.listTools({}, { timeout: 15_000 });
    const tool = tools.find((item) => item.name === 'search_panama_law');
    const query = tool?.inputSchema.properties?.query as { type?: string } | undefined;
    if (!tool || query?.type !== 'string' || !tool.inputSchema.required?.includes('query')
      || tool.inputSchema.required.some((key) => key !== 'query') || !tool.outputSchema) {
      throw new Error('Unsupported research contract');
    }
    return {
      async search(args: { query: string }, signal: AbortSignal) {
        const result = await client.callTool({ name: 'search_panama_law', arguments: args }, undefined, { timeout: 30_000, signal });
        if (result.isError) throw new Error('Research failed');
        return parseSources(result.structuredContent);
      },
      close: () => client.close(),
    };
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

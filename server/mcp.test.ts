import { describe, expect, it } from 'vitest';
import { parseQuery, parseSources } from './mcp';

describe('research boundary', () => {
  it('accepts one bounded query and rejects extra arguments', () => {
    expect(parseQuery('{"query":" Ley 81 "}')).toEqual({ query: 'Ley 81' });
    for (const value of ['null', '[]', '{"query":" "}', '{"query":3}', '{"query":"ley","url":"https://example.com"}', JSON.stringify({ query: 'x'.repeat(2001) })]) {
      expect(() => parseQuery(value)).toThrow();
    }
  });
  it('returns at most three sources and only supported fields', () => {
    const source = { title: 'Ley de ejemplo', citation: 'Artículo 1', excerpt: 'Texto de prueba', secret: 'omit', date: null };
    const result = parseSources({ results: Array(5).fill(source) });
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ title: source.title, citation: source.citation, excerpt: source.excerpt });
    expect(parseSources({ results: [] })).toEqual([]);
  });
  it('rejects unsupported evidence and unsafe source links', () => {
    const source = { title: 'Ley', citation: 'Artículo 1', excerpt: 'Texto' };
    for (const value of [null, { results: [{}] }, { results: [{ ...source, excerpt: 'x'.repeat(751) }] }, { results: [{ ...source, official_source_url: 'javascript:alert(1)' }] }]) {
      expect(() => parseSources(value)).toThrow();
    }
  });
});

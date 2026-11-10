import { DurableObject } from 'cloudflare:workers';

type Env = { CONVERSATIONS: DurableObjectNamespace<ConversationActor> };
type Source = { title: string; citation: string; excerpt: string };
type Command =
  | { type: 'start_turn'; commandId: string }
  | { type: 'interrupt'; commandId: string }
  | { type: 'start_search'; commandId: string; callId: string; generation: number; query: string }
  | { type: 'complete_search'; commandId: string; callId: string; results: Source[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}

function parseCommand(value: unknown): Command {
  if (!isRecord(value) || !isId(value.commandId)) throw new Error('Invalid command ID');
  const commandId = value.commandId;
  switch (value.type) {
    case 'start_turn':
    case 'interrupt':
      return { type: value.type, commandId };
    case 'start_search':
      if (!isId(value.callId) || !Number.isSafeInteger(value.generation)
        || typeof value.query !== 'string' || !value.query.trim() || value.query.length > 2000) {
        throw new Error('Invalid search');
      }
      return { type: 'start_search', commandId, callId: value.callId,
        generation: Number(value.generation), query: value.query.trim() };
    case 'complete_search':
      if (!isId(value.callId) || !Array.isArray(value.results) || value.results.length > 3
        || !value.results.every((source) => isRecord(source)
          && typeof source.title === 'string' && source.title.length <= 1000
          && typeof source.citation === 'string' && source.citation.length <= 1000
          && typeof source.excerpt === 'string' && source.excerpt.length <= 750)) {
        throw new Error('Invalid results');
      }
      return { type: 'complete_search', commandId, callId: value.callId,
        results: value.results.map((source) => ({
          title: source.title, citation: source.citation, excerpt: source.excerpt,
        })) };
    default:
      throw new Error('Unknown command');
  }
}

export class ConversationActor extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS conversation (id INTEGER PRIMARY KEY CHECK (id = 1), generation INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS commands (command_id TEXT PRIMARY KEY, response TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS searches (
        call_id TEXT PRIMARY KEY, generation INTEGER NOT NULL, query TEXT NOT NULL,
        status TEXT NOT NULL, results TEXT
      );
      INSERT OR IGNORE INTO conversation (id, generation) VALUES (1, 0);
    `);
  }

  private generation(): number {
    return this.ctx.storage.sql.exec<{ generation: number }>(
      'SELECT generation FROM conversation WHERE id = 1',
    ).one().generation;
  }

  private snapshot() {
    const searches = this.ctx.storage.sql.exec<{
      call_id: string; generation: number; query: string; status: string; results: string | null;
    }>('SELECT call_id, generation, query, status, results FROM searches ORDER BY rowid').toArray();
    return { generation: this.generation(), searches: searches.map((search) => ({
      callId: search.call_id, generation: search.generation, query: search.query,
      status: search.status, results: search.results === null ? null : JSON.parse(search.results),
    })) };
  }

  private apply(command: Command): object {
    const sql = this.ctx.storage.sql;
    const generation = this.generation();
    switch (command.type) {
      case 'start_turn':
      case 'interrupt': {
        const next = generation + 1;
        sql.exec('UPDATE conversation SET generation = ? WHERE id = 1', next);
        return { outcome: command.type === 'interrupt' ? 'interrupted' : 'turn_started', generation: next };
      }
      case 'start_search': {
        if (command.generation !== generation) return { outcome: 'stale_command', generation };
        const existing = sql.exec<{ status: string }>(
          'SELECT status FROM searches WHERE call_id = ?', command.callId,
        ).toArray()[0];
        if (existing) return { outcome: 'duplicate_call', status: existing.status, generation };
        sql.exec('INSERT INTO searches (call_id, generation, query, status) VALUES (?, ?, ?, ?)',
          command.callId, generation, command.query, 'pending');
        return { outcome: 'search_pending', callId: command.callId, generation };
      }
      case 'complete_search': {
        const search = sql.exec<{ generation: number; status: string }>(
          'SELECT generation, status FROM searches WHERE call_id = ?', command.callId,
        ).toArray()[0];
        if (!search) return { outcome: 'unknown_call', generation };
        if (search.status !== 'pending') return { outcome: 'duplicate_result', status: search.status, generation };
        const status = search.generation === generation ? 'accepted' : 'stale';
        sql.exec('UPDATE searches SET status = ?, results = ? WHERE call_id = ?',
          status, status === 'accepted' ? JSON.stringify(command.results) : null, command.callId);
        return { outcome: status === 'accepted' ? 'result_accepted' : 'stale_result', generation };
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'GET') return Response.json(this.snapshot());
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    let command: Command;
    try {
      command = parseCommand(await request.json());
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Invalid JSON' }, { status: 400 });
    }
    const result = this.ctx.storage.transactionSync(() => {
      const prior = this.ctx.storage.sql.exec<{ response: string }>(
        'SELECT response FROM commands WHERE command_id = ?', command.commandId,
      ).toArray()[0];
      if (prior) return { duplicateCommand: true, ...JSON.parse(prior.response) };
      const response = this.apply(command);
      this.ctx.storage.sql.exec('INSERT INTO commands (command_id, response) VALUES (?, ?)',
        command.commandId, JSON.stringify(response));
      return { duplicateCommand: false, ...response };
    });
    return Response.json(result);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = /^\/conversations\/([a-zA-Z0-9_-]{1,64})$/.exec(url.pathname);
    if (!match) return new Response('Not found', { status: 404 });
    const id = env.CONVERSATIONS.idFromName(match[1]);
    return env.CONVERSATIONS.get(id).fetch(request);
  },
} satisfies ExportedHandler<Env>;

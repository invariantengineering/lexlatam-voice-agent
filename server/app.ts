import express from 'express';
import type { ErrorRequestHandler } from 'express';
import OpenAI from 'openai';
import { sessionConfig } from './session';
import { randomUUID } from 'node:crypto';
import { createCall } from './call';

export function createApp(apiKey: string | undefined, port: number, client?: OpenAI, token = process.env.LEXLATAM_MCP_TOKEN) {
  const app = express();
  app.disable('x-powered-by');
  const openai = client ?? (apiKey ? new OpenAI({ apiKey, maxRetries: 0, timeout: 20_000 }) : undefined);
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  const calls = new Map<string, Awaited<ReturnType<typeof createCall>>>();

  app.use((req, res, next) => {
    if (!hosts.has(req.headers.host ?? '')) {
      res.status(403).json({ error: 'Usa la dirección local de esta aplicación.' });
      return;
    }
    const origin = req.headers.origin;
    if (origin && ![...hosts].some((host) => origin === `http://${host}`)) {
      res.status(403).json({ error: 'Origen no permitido.' });
      return;
    }
    next();
  });

  app.get('/api/status', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({
      ready: Boolean(openai && token), model: sessionConfig.model, mode: 'research',
    });
  });

  app.post('/api/session', express.text({ type: 'application/sdp', limit: '32kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.is('application/sdp') || typeof req.body !== 'string' || !req.body.startsWith('v=0')) {
      res.status(400).json({ error: 'La oferta de audio no es válida.' });
      return;
    }
    if (!openai || !token) {
      res.status(503).json({ error: 'Configura OPENAI_API_KEY y LEXLATAM_MCP_TOKEN en .env y reinicia el servidor.' });
      return;
    }
    for (const [id, call] of calls) if (call.status().closed) calls.delete(id);
    if (calls.size >= 4) { res.status(429).json({ error: 'Termina las sesiones abiertas antes de iniciar otra.' }); return; }
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', abort);
    try {
      const call = await createCall(openai, token, req.body, controller.signal);
      if (controller.signal.aborted) { await call.close(); return; }
      const id = randomUUID();
      calls.set(id, call);
      res.json({ id, sdp: call.sdp });
    } catch (error) {
      if (controller.signal.aborted) return;
      const timeout = error instanceof OpenAI.APIConnectionTimeoutError;
      res.status(timeout ? 504 : 502).json({
        error: timeout
          ? 'La conexión tardó demasiado. Vuelve a intentarlo.'
          : 'No se pudo conectar la voz y la búsqueda. Revisa las credenciales y la conexión.',
      });
    } finally {
      res.off('close', abort);
    }
  });

  app.get('/api/session/:id', (req, res) => {
    const call = calls.get(req.params.id);
    res.set('Cache-Control', 'no-store');
    if (!call) { res.status(404).json({ error: 'La sesión terminó.' }); return; }
    res.json(call.status());
  });
  app.delete('/api/session/:id', async (req, res) => {
    const call = calls.get(req.params.id);
    calls.delete(req.params.id);
    await call?.close();
    res.sendStatus(204);
  });

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error?.type === 'entity.too.large' ? 413 : 400)
      .json({ error: 'No se pudo procesar la solicitud.' });
  };
  app.use('/api', handleError);
  return app;
}

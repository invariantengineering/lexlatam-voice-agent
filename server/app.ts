import express from 'express';
import type { ErrorRequestHandler } from 'express';
import OpenAI from 'openai';
import { sessionConfig } from './session';

export function createApp(apiKey: string | undefined, port: number, client?: OpenAI) {
  const app = express();
  app.disable('x-powered-by');
  const openai = client ?? (apiKey ? new OpenAI({ apiKey, maxRetries: 0, timeout: 20_000 }) : undefined);
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);

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
      ready: Boolean(openai), model: sessionConfig.model, mode: 'voice-only',
    });
  });

  app.post('/api/session', express.text({ type: 'application/sdp', limit: '32kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.is('application/sdp') || typeof req.body !== 'string' || !req.body.startsWith('v=0')) {
      res.status(400).json({ error: 'La oferta de audio no es válida.' });
      return;
    }
    if (!openai) {
      res.status(503).json({ error: 'Configura OPENAI_API_KEY en .env y reinicia el servidor.' });
      return;
    }
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', abort);
    try {
      const response = await openai.realtime.calls.create(
        { sdp: req.body, session: sessionConfig },
        { signal: controller.signal },
      );
      const answer = await response.text();
      if (!answer.startsWith('v=0')) throw new Error('Invalid SDP answer');
      if (!controller.signal.aborted) res.type('application/sdp').send(answer);
    } catch (error) {
      if (controller.signal.aborted) return;
      const timeout = error instanceof OpenAI.APIConnectionTimeoutError;
      res.status(timeout ? 504 : 502).json({
        error: timeout
          ? 'La conexión tardó demasiado. Vuelve a intentarlo.'
          : 'No se pudo iniciar la sesión de voz. Revisa la clave, el acceso al modelo y la conexión.',
      });
    } finally {
      res.off('close', abort);
    }
  });

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error?.type === 'entity.too.large' ? 413 : 400)
      .json({ error: 'No se pudo procesar la solicitud.' });
  };
  app.use('/api', handleError);
  return app;
}

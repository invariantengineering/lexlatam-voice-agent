import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import express from 'express';
import { createApp } from './app';

if (existsSync('.env')) loadEnvFile('.env');
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const app = createApp(process.env.OPENAI_API_KEY, port);
const server = createServer(app);

if (process.argv.includes('--production')) {
  if (!existsSync('dist/index.html')) throw new Error('Run npm run build first');
  app.use(express.static(resolve('dist')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

server.listen(port, '127.0.0.1', () => {
  console.log(`Voice demo: http://localhost:${port}`);
  if (!process.env.OPENAI_API_KEY) console.log('Set OPENAI_API_KEY in .env and restart to enable voice.');
});

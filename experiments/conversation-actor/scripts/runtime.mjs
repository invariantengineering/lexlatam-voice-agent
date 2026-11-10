import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local port');
  const port = address.port;
  server.close();
  await once(server, 'close');
  return port;
}

export async function startRuntime(persistTo) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [
    'node_modules/wrangler/bin/wrangler.js', 'dev', '--local',
    '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persistTo,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Wrangler exited: ${output}`);
    try {
      const response = await fetch(`${base}/conversations/readiness`);
      if (response.ok) return { base, child };
    } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGTERM');
  throw new Error(`Wrangler did not start: ${output}`);
}

export async function stopRuntime(runtime) {
  if (runtime.child.exitCode !== null) return;
  runtime.child.kill('SIGTERM');
  let timer;
  try {
    await Promise.race([
      once(runtime.child, 'exit'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Wrangler did not stop')), 10_000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function command(base, conversation, body) {
  const response = await fetch(`${base}/conversations/${conversation}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Command failed: ${response.status} ${await response.text()}`);
  return response.json();
}

export async function state(base, conversation) {
  const response = await fetch(`${base}/conversations/${conversation}`);
  if (!response.ok) throw new Error(`State failed: ${response.status}`);
  return response.json();
}

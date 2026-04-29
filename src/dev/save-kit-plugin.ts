import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rej);
  });
}

function sendJson(resp: ServerResponse, status: number, body: unknown): void {
  resp.statusCode = status;
  resp.setHeader('Content-Type', 'application/json');
  resp.end(JSON.stringify(body));
}

export function saveKitPlugin(): Plugin {
  return {
    name: 'austerbitz-save-kit-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        const method = req.method ?? '';

        if (method !== 'POST' || !url.startsWith('/api/save-kit/')) {
          next();
          return;
        }

        const id = decodeURIComponent(url.slice('/api/save-kit/'.length));

        if (id.includes('/') || id.includes('\\') || id.includes('..')) {
          sendJson(res, 400, { error: 'invalid id' });
          return;
        }

        let raw: string;
        try {
          raw = await readRawBody(req);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(res, 500, { error: message });
          return;
        }

        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          sendJson(res, 400, { error: 'invalid json' });
          return;
        }

        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          sendJson(res, 400, { error: 'expected JSON object body' });
          return;
        }

        const bodyObj = body as Record<string, unknown>;
        if (bodyObj.id !== id) {
          sendJson(res, 400, { error: 'id mismatch' });
          return;
        }

        try {
          const target = resolve(server.config.root, `public/components/kits/${id}.json`);
          await writeFile(target, JSON.stringify(body, null, 2) + '\n', 'utf8');
          sendJson(res, 200, { ok: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(res, 500, { error: message });
        }
      });
    },
  };
}

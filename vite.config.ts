import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';

const PROJECT_ROOT = __dirname;

function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolvePromise(raw.length === 0 ? {} : JSON.parse(raw));
      } catch (err) {
        rejectPromise(err);
      }
    });
    req.on('error', rejectPromise);
  });
}

function sendJson(
  res: import('node:http').ServerResponse,
  status: number,
  body: unknown
): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function offsetsApiPlugin(): Plugin {
  return {
    name: 'austerbitz-poses-offsets-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        const method = req.method ?? '';

        if (method === 'POST' && url === '/api/offsets') {
          try {
            const body = await readJsonBody(req);
            const target = resolve(PROJECT_ROOT, 'public/components/offsets.json');
            await writeFile(target, JSON.stringify(body, null, 2) + '\n', 'utf8');
            sendJson(res, 200, { ok: true });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 400, { ok: false, error: message });
          }
          return;
        }

        if (method === 'POST' && url === '/api/build') {
          try {
            const result = await new Promise<{ stdout: string; stderr: string }>(
              (resolvePromise, rejectPromise) => {
                execFile(
                  process.execPath,
                  [
                    'scripts/build-soldier-components.mjs',
                    '--kit',
                    'british-line-infantry',
                    '--scale',
                    '16',
                  ],
                  { cwd: PROJECT_ROOT, maxBuffer: 16 * 1024 * 1024 },
                  (error, stdout, stderr) => {
                    if (error) {
                      rejectPromise(
                        Object.assign(error, { stdout: String(stdout), stderr: String(stderr) })
                      );
                      return;
                    }
                    resolvePromise({ stdout: String(stdout), stderr: String(stderr) });
                  }
                );
              }
            );
            sendJson(res, 200, { ok: true, stdout: result.stdout, stderr: result.stderr });
          } catch (err) {
            const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
            const message = e.stderr || e.message || String(err);
            sendJson(res, 500, { ok: false, error: message, stdout: e.stdout ?? '' });
          }
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [offsetsApiPlugin()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        lab: resolve(__dirname, 'lab.html'),
        components: resolve(__dirname, 'components.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
});

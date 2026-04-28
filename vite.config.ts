import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { writeFile, readFile, readdir } from 'node:fs/promises';
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

        if (method === 'GET' && url === '/api/kits') {
          try {
            const kitsDir = resolve(PROJECT_ROOT, 'public/components/kits');
            const entries = await readdir(kitsDir);
            const jsonFiles = entries.filter(
              (name) => name.toLowerCase().endsWith('.json') && name !== 'index.json'
            );
            jsonFiles.sort();
            const result: Array<{ id: string; label: string; poses: string[] }> = [];
            for (const file of jsonFiles) {
              const fullPath = resolve(kitsDir, file);
              const raw = await readFile(fullPath, 'utf8');
              let parsed: any;
              try {
                parsed = JSON.parse(raw);
              } catch {
                continue;
              }
              const id = file.replace(/\.json$/i, '');
              const label = (parsed && typeof parsed.label === 'string' && parsed.label) || id;
              const poses = ['idle'];
              if (parsed && typeof parsed.poses === 'object' && parsed.poses) {
                for (const poseId of Object.keys(parsed.poses)) {
                  if (poseId !== 'idle') poses.push(poseId);
                }
              }
              result.push({ id, label, poses });
            }
            sendJson(res, 200, result);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { ok: false, error: message });
          }
          return;
        }

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

        if (method === 'POST' && url === '/api/pixel-edits') {
          try {
            const body = await readJsonBody(req);
            const target = resolve(PROJECT_ROOT, 'public/components/pixel-edits.json');
            await writeFile(target, JSON.stringify(body, null, 2) + '\n', 'utf8');
            sendJson(res, 200, { ok: true });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 400, { ok: false, error: message });
          }
          return;
        }

        if (method === 'POST' && url === '/api/pose-frame-edits') {
          try {
            const body = await readJsonBody(req);
            const target = resolve(PROJECT_ROOT, 'public/sprites/poses/edits.json');
            await writeFile(target, JSON.stringify(body, null, 2) + '\n', 'utf8');
            sendJson(res, 200, { ok: true });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 400, { ok: false, error: message });
          }
          return;
        }

        if (method === 'POST' && url.startsWith('/api/kit/')) {
          try {
            const kitId = decodeURIComponent(url.slice('/api/kit/'.length));
            if (!/^[a-zA-Z0-9_-]+$/.test(kitId)) {
              throw new Error('Invalid kitId');
            }
            const body = await readJsonBody(req);
            const target = resolve(PROJECT_ROOT, 'public/components/kits/' + kitId + '.json');
            await writeFile(target, JSON.stringify(body, null, 2) + '\n', 'utf8');
            sendJson(res, 200, { ok: true });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 400, { ok: false, error: message });
          }
          return;
        }

        if (method === 'POST' && url === '/api/regiments') {
          try {
            const body = await readJsonBody(req);
            const target = resolve(PROJECT_ROOT, 'public/regiments.json');
            await writeFile(target, JSON.stringify(body, null, 2) + '\n', 'utf8');
            sendJson(res, 200, { ok: true });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 400, { ok: false, error: message });
          }
          return;
        }

        if (method === 'POST' && url === '/api/build') {
          function runStep(args: string[]): Promise<{ stdout: string; stderr: string }> {
            return new Promise((resolveStep, rejectStep) => {
              execFile(
                process.execPath,
                args,
                { cwd: PROJECT_ROOT, maxBuffer: 16 * 1024 * 1024 },
                (error, stdout, stderr) => {
                  if (error) {
                    rejectStep(
                      Object.assign(error, { stdout: String(stdout), stderr: String(stderr) })
                    );
                    return;
                  }
                  resolveStep({ stdout: String(stdout), stderr: String(stderr) });
                }
              );
            });
          }

          try {
            const out: Array<{ stdout: string; stderr: string }> = [];
            out.push(
              await runStep([
                'scripts/build-soldier-components.mjs',
                '--kit',
                'line-infantry',
                '--scale',
                '16',
              ])
            );
            out.push(await runStep(['scripts/slice-component-atlas.mjs']));
            out.push(await runStep(['scripts/draw-cuirassier-poses.mjs']));
            out.push(await runStep(['scripts/build-pose-manifest.mjs']));
            const stdout = out.map((o) => o.stdout).join('\n');
            const stderr = out.map((o) => o.stderr).join('\n');
            sendJson(res, 200, { ok: true, stdout, stderr });
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

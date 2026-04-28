import { defineConfig, type Plugin } from 'vite';
import { resolve, join } from 'node:path';
import { writeFile, readFile, readdir, stat } from 'node:fs/promises';
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

async function maxMtimeUnder(dir: string): Promise<number> {
  let max = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as unknown as import('node:fs').Dirent[];
  } catch {
    return 0;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      const sub = await maxMtimeUnder(full);
      if (sub > max) max = sub;
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.png')) {
      try {
        const s = await stat(full);
        if (s.mtimeMs > max) max = s.mtimeMs;
      } catch {
        // ignore unreadable files
      }
    }
  }
  return max;
}

function offsetsApiPlugin(): Plugin {
  return {
    name: 'austerbitz-poses-offsets-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        const method = req.method ?? '';

        // GET /api/atlas-mtime — most-recent mtime of any sprite PNG under
        // public/sprites/. Used by the live-reload poller in dev mode to skip
        // a full atlas refetch when nothing has changed.
        if (method === 'GET' && url === '/api/atlas-mtime') {
          try {
            const spritesDir = resolve(PROJECT_ROOT, 'public/sprites');
            const m = await maxMtimeUnder(spritesDir);
            sendJson(res, 200, { mtime: m > 0 ? new Date(m).toISOString() : null });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { ok: false, error: message });
          }
          return;
        }

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

        // POST /api/kits/:unit — deep-merge weapon block, idle facing layers,
        // and per-pose weapon transforms into the kit JSON. Replaces leaf
        // values; never deletes existing keys. 404 if the kit file is missing,
        // 400 on malformed JSON.
        if (method === 'POST' && url.startsWith('/api/kits/')) {
          try {
            const unit = decodeURIComponent(url.slice('/api/kits/'.length));
            // Defend against path traversal: only allow simple kit ids.
            if (!/^[a-zA-Z0-9_-]+$/.test(unit)) {
              sendJson(res, 400, { ok: false, error: 'invalid unit id' });
              return;
            }
            const target = resolve(PROJECT_ROOT, `public/components/kits/${unit}.json`);
            let raw: string;
            try {
              raw = await readFile(target, 'utf8');
            } catch {
              sendJson(res, 404, { ok: false, error: `kit not found: ${unit}` });
              return;
            }
            let parsed: any;
            try {
              parsed = JSON.parse(raw);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              sendJson(res, 500, { ok: false, error: 'kit file is malformed: ' + message });
              return;
            }
            const body = (await readJsonBody(req)) as any;
            if (!body || typeof body !== 'object') {
              sendJson(res, 400, { ok: false, error: 'expected JSON object body' });
              return;
            }
            // Shallow merge of top-level `weapon` block (full replace if present).
            if (body.weapon && typeof body.weapon === 'object') {
              parsed.weapon = body.weapon;
            }
            // Deep merge of facings[F].layers (idle facings only). Replaces the
            // layers array per facing without touching cell coords or other keys.
            if (body.facings && typeof body.facings === 'object') {
              if (!parsed.facings || typeof parsed.facings !== 'object') {
                parsed.facings = {};
              }
              for (const [facing, facingEntry] of Object.entries(
                body.facings as Record<string, unknown>
              )) {
                if (!facingEntry || typeof facingEntry !== 'object') continue;
                const fe = facingEntry as { layers?: unknown };
                if (!Array.isArray(fe.layers)) continue;
                const layers = fe.layers.filter((s) => typeof s === 'string') as string[];
                let existing = parsed.facings[facing];
                if (!existing || typeof existing !== 'object') existing = {};
                existing.layers = layers;
                parsed.facings[facing] = existing;
              }
            }
            // Deep merge of poses[pose][facing].weapon = { x, y, rot }, never
            // touching any non-weapon keys (layers, etc.) of pose entries.
            // Skips poses or facings that don't already exist on disk — the
            // editor occasionally retains stale in-memory state for deleted
            // poses, and we don't want autosave resurrecting them.
            if (body.poses && typeof body.poses === 'object' && parsed.poses && typeof parsed.poses === 'object') {
              for (const [poseId, poseFacings] of Object.entries(body.poses)) {
                if (!poseFacings || typeof poseFacings !== 'object') continue;
                if (!parsed.poses[poseId] || typeof parsed.poses[poseId] !== 'object') continue;
                for (const [facing, facingEntry] of Object.entries(
                  poseFacings as Record<string, unknown>
                )) {
                  if (!facingEntry || typeof facingEntry !== 'object') continue;
                  const fe = facingEntry as { weapon?: unknown; weaponVariants?: unknown };
                  const hasWeapon = fe.weapon && typeof fe.weapon === 'object';
                  const hasVariants = Array.isArray(fe.weaponVariants);
                  if (!hasWeapon && !hasVariants) continue;
                  // Skip facings the kit hasn't authored — autosave shouldn't
                  // create new (pose, facing) entries on its own.
                  let existing = parsed.poses[poseId][facing];
                  if (!existing) continue;
                  if (Array.isArray(existing)) {
                    existing = { layers: existing };
                  } else if (typeof existing !== 'object') {
                    continue;
                  }
                  const validSrc = new Set(['self', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
                  const validXf = new Set(['none', 'flipX', 'flipY', 'rot180']);
                  const sanitizeWeapon = (w: Record<string, unknown>) => {
                    const cleaned: {
                      x: number;
                      y: number;
                      rot: number;
                      flipX?: true;
                      src?: 'self' | 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
                      transform?: 'none' | 'flipX' | 'flipY' | 'rot180';
                    } = {
                      x: typeof w.x === 'number' ? (w.x | 0) : 0,
                      y: typeof w.y === 'number' ? (w.y | 0) : 0,
                      rot: typeof w.rot === 'number' ? +w.rot : 0,
                    };
                    if (w.flipX === true) cleaned.flipX = true;
                    if (typeof w.src === 'string' && validSrc.has(w.src)) {
                      cleaned.src = w.src as typeof cleaned.src;
                      if (w.src !== 'self') {
                        cleaned.transform = (typeof w.transform === 'string' && validXf.has(w.transform))
                          ? (w.transform as typeof cleaned.transform)
                          : 'none';
                      }
                    }
                    return cleaned;
                  };
                  if (hasWeapon) {
                    existing.weapon = sanitizeWeapon(fe.weapon as Record<string, unknown>);
                  }
                  if (hasVariants) {
                    const variants = (fe.weaponVariants as unknown[])
                      .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
                      .map(sanitizeWeapon);
                    if (variants.length > 0) existing.weaponVariants = variants;
                    else delete existing.weaponVariants;
                  }
                  parsed.poses[poseId][facing] = existing;
                }
              }
            }
            await writeFile(target, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
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

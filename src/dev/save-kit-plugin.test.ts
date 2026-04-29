import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { saveKitPlugin } from './save-kit-plugin.js';
import type { Plugin, ViteDevServer } from 'vite';

// ---------------------------------------------------------------------------
// Minimal mock harness
// ---------------------------------------------------------------------------

type MiddlewareFn = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void
) => void;

function buildServer(projectRoot: string): { server: ViteDevServer; getMiddleware: () => MiddlewareFn } {
  let middleware: MiddlewareFn | null = null;
  const server = {
    config: { root: projectRoot },
    middlewares: {
      use(fn: MiddlewareFn) {
        middleware = fn;
      },
    },
  } as unknown as ViteDevServer;
  return {
    server,
    getMiddleware: () => {
      if (!middleware) throw new Error('middleware not registered');
      return middleware;
    },
  };
}

function makeReq(method: string, url: string, body: string): IncomingMessage {
  const readable = Readable.from([Buffer.from(body, 'utf8')]);
  const req = Object.assign(readable, { method, url }) as unknown as IncomingMessage;
  return req;
}

interface CapturedResponse {
  status: number;
  body: unknown;
}

function makeRes(): { res: ServerResponse; captured: Promise<CapturedResponse> } {
  let resolveCapture!: (v: CapturedResponse) => void;
  const captured = new Promise<CapturedResponse>((r) => { resolveCapture = r; });

  let status = 200;
  const res = {
    statusCode: 200,
    setHeader: () => {},
    end: (data: string) => {
      resolveCapture({ status: res.statusCode, body: JSON.parse(data) });
    },
  } as unknown as ServerResponse;

  Object.defineProperty(res, 'statusCode', {
    get: () => status,
    set: (v: number) => { status = v; },
  });

  return { res, captured };
}

async function invoke(
  middleware: MiddlewareFn,
  method: string,
  url: string,
  body: string
): Promise<CapturedResponse> {
  const req = makeReq(method, url, body);
  const { res, captured } = makeRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  if (nextCalled) {
    return { status: 404, body: { next: true } };
  }
  return captured;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let tmpRoot: string;
let kitsDir: string;
let middleware: MiddlewareFn;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'save-kit-test-'));
  kitsDir = resolve(tmpRoot, 'public/components/kits');
  mkdirSync(kitsDir, { recursive: true });

  const plugin = saveKitPlugin() as Plugin & { configureServer: (s: ViteDevServer) => void };
  const { server, getMiddleware } = buildServer(tmpRoot);
  plugin.configureServer(server);
  middleware = getMiddleware();
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('saveKitPlugin — POST /api/save-kit/:id', () => {
  it('happy path: writes file with correct contents and returns 200', async () => {
    const kit = { id: 'test-kit', label: 'Test Kit', weapons: [] };
    const result = await invoke(middleware, 'POST', '/api/save-kit/test-kit', JSON.stringify(kit));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });

    const written = await readFile(join(kitsDir, 'test-kit.json'), 'utf8');
    expect(written).toBe(JSON.stringify(kit, null, 2) + '\n');
  });

  it('id mismatch returns 400 and no file is written', async () => {
    const kit = { id: 'other-kit', label: 'Other Kit', weapons: [] };
    const result = await invoke(middleware, 'POST', '/api/save-kit/test-kit', JSON.stringify(kit));

    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toMatch(/mismatch/);

    const files = await import('node:fs/promises').then(m => m.readdir(kitsDir));
    expect(files).toHaveLength(0);
  });

  it.each([
    {
      label: 'dot-dot + slash  (..%2Fevil)',
      urlId: '..%2Fevil',
      bodyId: '../evil',
    },
    {
      label: 'backslash  (foo%5Cbar)',
      urlId: 'foo%5Cbar',
      bodyId: 'foo\\bar',
    },
    {
      label: 'bare dot-dot  (foo..bar)',
      urlId: 'foo..bar',
      bodyId: 'foo..bar',
    },
  ])('path traversal — $label — returns 400 and no file is written', async ({ urlId, bodyId }) => {
    const kit = { id: bodyId, label: 'Evil', weapons: [] };
    const result = await invoke(middleware, 'POST', `/api/save-kit/${urlId}`, JSON.stringify(kit));

    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toMatch(/invalid/i);

    const files = await import('node:fs/promises').then(m => m.readdir(kitsDir));
    expect(files).toHaveLength(0);
  });

  it('invalid JSON body returns 400', async () => {
    const result = await invoke(middleware, 'POST', '/api/save-kit/some-kit', 'not json {{{');

    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toMatch(/invalid json/i);
  });
});

#!/usr/bin/env python3
"""youtube2mp3 — single-file web wrapper around yt-dlp.

Downloads YouTube audio as mp3s into themed subfolders of a base music
directory. Stdlib only. Default port 8765.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

DEFAULT_BASE = "/Users/andrewcote/Documents/software/austerbitz/public/music"
NAME_RE = re.compile(r"^[a-zA-Z0-9_-]+$")
YT_DLP = "yt-dlp"  # assumed on PATH

INDEX_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>youtube2mp3</title>
<style>
  :root {
    --bg: #15171a;
    --panel: #1d2024;
    --fg: #e6e6e6;
    --muted: #8a8f96;
    --accent: #6cc4ff;
    --err: #ff6b6b;
    --border: #2a2e34;
  }
  * { box-sizing: border-box; }
  html, body { background: var(--bg); color: var(--fg); margin: 0; }
  body {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    padding: 24px;
    max-width: 760px;
    margin: 0 auto;
  }
  h1 { font-size: 16px; margin: 0 0 18px 0; color: var(--accent); }
  section { margin-bottom: 18px; }
  label { display: block; color: var(--muted); margin-bottom: 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  input[type=text], select, textarea {
    width: 100%;
    background: var(--panel);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: 8px 10px;
    font-family: inherit;
    font-size: 13px;
    border-radius: 3px;
  }
  textarea { resize: vertical; min-height: 90px; }
  button {
    background: var(--panel);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: 8px 14px;
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
    border-radius: 3px;
  }
  button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  .row { display: flex; gap: 8px; align-items: stretch; }
  .row select { flex: 1; }
  .hint { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .err { color: var(--err); }
  #status { margin-top: 8px; font-size: 12px; color: var(--muted); white-space: pre-wrap; }
  #files { list-style: none; padding: 0; margin: 6px 0 0 0; max-height: 240px; overflow: auto; border: 1px solid var(--border); border-radius: 3px; }
  #files li { padding: 4px 10px; border-bottom: 1px solid var(--border); }
  #files li:last-child { border-bottom: none; }
  #files li.empty { color: var(--muted); font-style: italic; }
  .files-head { display: flex; justify-content: space-between; align-items: baseline; }
  .files-head .count { color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<h1>youtube2mp3</h1>

<section>
  <label for="base">Base music directory</label>
  <input id="base" type="text" autocomplete="off">
  <div id="baseHint" class="hint"></div>
</section>

<section>
  <label for="category">Category</label>
  <div class="row">
    <select id="category"></select>
    <button id="newCat" type="button">+ New category</button>
  </div>
  <div id="catHint" class="hint"></div>
</section>

<section>
  <label for="urls">URLs</label>
  <textarea id="urls" placeholder="One YouTube URL per line"></textarea>
</section>

<section>
  <button id="download" type="button" disabled>Download</button>
  <div id="status"></div>
</section>

<section>
  <div class="files-head">
    <label id="filesLabel" for="files">Files</label>
    <span class="count" id="filesCount"></span>
  </div>
  <ul id="files"></ul>
</section>

<script>
(function () {
  var BASE_KEY = 'yt2mp3.base';
  var CAT_KEY = 'yt2mp3.category';
  var DEFAULT_BASE = %DEFAULT_BASE%;
  var NAME_RE = /^[a-zA-Z0-9_-]+$/;

  var $base = document.getElementById('base');
  var $cat = document.getElementById('category');
  var $newCat = document.getElementById('newCat');
  var $urls = document.getElementById('urls');
  var $download = document.getElementById('download');
  var $status = document.getElementById('status');
  var $files = document.getElementById('files');
  var $filesCount = document.getElementById('filesCount');
  var $filesLabel = document.getElementById('filesLabel');
  var $baseHint = document.getElementById('baseHint');
  var $catHint = document.getElementById('catHint');

  var inFlight = false;
  var baseExists = true;
  var lastCategories = [];

  function setStatus(msg, isErr) {
    $status.textContent = msg || '';
    $status.className = isErr ? 'err' : '';
  }

  function getBase() { return ($base.value || '').trim(); }
  function getCategory() { return $cat.value || ''; }
  function joinedDir() {
    var b = getBase(); var c = getCategory();
    if (!b || !c) return '';
    return b.replace(/\/+$/, '') + '/' + c;
  }

  function updateDownloadEnabled() {
    var hasUrls = $urls.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean).length > 0;
    $download.disabled = inFlight || !getCategory() || !hasUrls || !baseExists;
  }

  function updateHints() {
    if (!baseExists) {
      $baseHint.textContent = 'Base directory not found';
      $catHint.textContent = '';
    } else if (lastCategories.length === 0) {
      $baseHint.textContent = '';
      $catHint.textContent = 'No categories — create one';
    } else {
      $baseHint.textContent = '';
      $catHint.textContent = '';
    }
  }

  function fetchCategories() {
    var base = getBase();
    if (!base) {
      lastCategories = [];
      $cat.innerHTML = '';
      $cat.disabled = true;
      baseExists = false;
      updateHints();
      updateDownloadEnabled();
      refreshFiles();
      return Promise.resolve();
    }
    return fetch('/categories?base=' + encodeURIComponent(base))
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, json: j, status: r.status }; }); })
      .then(function (res) {
        var cats = (res.json && res.json.categories) || [];
        lastCategories = cats;
        // baseExists: if server returned [] we can't tell — treat as exists unless explicitly flagged.
        // Use a HEAD-ish approach: send a probe via /files with the base itself? Simpler: assume exists; the
        // empty-list case shows the "no categories" hint. The "not found" hint is best-effort.
        baseExists = true;
        $cat.innerHTML = '';
        cats.forEach(function (c) {
          var opt = document.createElement('option');
          opt.value = c; opt.textContent = c;
          $cat.appendChild(opt);
        });
        $cat.disabled = cats.length === 0;
        var saved = localStorage.getItem(CAT_KEY) || '';
        if (saved && cats.indexOf(saved) >= 0) {
          $cat.value = saved;
        } else if (cats.length > 0) {
          $cat.value = cats[0];
          localStorage.setItem(CAT_KEY, $cat.value);
        } else {
          localStorage.removeItem(CAT_KEY);
        }
        updateHints();
        updateDownloadEnabled();
        refreshFiles();
      })
      .catch(function (e) {
        lastCategories = [];
        baseExists = false;
        $cat.innerHTML = '';
        $cat.disabled = true;
        updateHints();
        updateDownloadEnabled();
        refreshFiles();
      });
  }

  function refreshFiles() {
    var dir = joinedDir();
    var cat = getCategory();
    $filesLabel.textContent = cat ? ('Files in ' + cat) : 'Files';
    if (!dir) {
      $files.innerHTML = '';
      $filesCount.textContent = '';
      return;
    }
    fetch('/files?dir=' + encodeURIComponent(dir))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var files = (j && j.files) || [];
        $files.innerHTML = '';
        if (files.length === 0) {
          var li = document.createElement('li');
          li.className = 'empty';
          li.textContent = '(empty)';
          $files.appendChild(li);
        } else {
          files.forEach(function (f) {
            var li = document.createElement('li');
            li.textContent = f;
            $files.appendChild(li);
          });
        }
        $filesCount.textContent = files.length + ' file' + (files.length === 1 ? '' : 's');
      })
      .catch(function () {
        $files.innerHTML = '';
        $filesCount.textContent = '';
      });
  }

  function newCategory() {
    var base = getBase();
    if (!base) { alert('Set a base directory first'); return; }
    var name = window.prompt('Category name:');
    if (name === null) return;
    name = (name || '').trim();
    if (!NAME_RE.test(name)) {
      alert('Invalid name. Use letters, digits, _ or - only.');
      return;
    }
    fetch('/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base: base, name: name }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, json: j }; }); })
      .then(function (res) {
        if (!res.ok) {
          alert((res.json && res.json.error) || 'Failed to create category');
          return;
        }
        return fetchCategories().then(function () {
          if (lastCategories.indexOf(name) >= 0) {
            $cat.value = name;
            localStorage.setItem(CAT_KEY, name);
            refreshFiles();
            updateDownloadEnabled();
          }
        });
      })
      .catch(function (e) { alert('Network error creating category'); });
  }

  function download() {
    if (inFlight) return;
    var dir = joinedDir();
    if (!dir) return;
    var urls = $urls.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    if (urls.length === 0) return;
    inFlight = true;
    updateDownloadEnabled();
    setStatus('Downloading...', false);
    fetch('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: urls, dir: dir }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, json: j }; }); })
      .then(function (res) {
        if (!res.ok) {
          setStatus('Error: ' + ((res.json && res.json.error) || 'download failed'), true);
        } else {
          var n = (res.json && res.json.downloaded) || 0;
          setStatus('Downloaded ' + n + ' track' + (n === 1 ? '' : 's'), false);
        }
      })
      .catch(function (e) { setStatus('Network error: ' + e, true); })
      .then(function () {
        inFlight = false;
        updateDownloadEnabled();
        refreshFiles();
      });
  }

  // Wire up.
  $base.value = localStorage.getItem(BASE_KEY) || DEFAULT_BASE;
  $base.addEventListener('change', function () {
    localStorage.setItem(BASE_KEY, getBase());
    fetchCategories();
  });
  $cat.addEventListener('change', function () {
    localStorage.setItem(CAT_KEY, getCategory());
    refreshFiles();
    updateDownloadEnabled();
  });
  $newCat.addEventListener('click', newCategory);
  $urls.addEventListener('input', updateDownloadEnabled);
  $download.addEventListener('click', download);

  fetchCategories();
})();
</script>
</body>
</html>
"""


def _json_response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _read_json_body(handler):
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


def _list_categories(base_str):
    if not base_str:
        return []
    base = Path(base_str)
    try:
        if not base.is_dir() or base.is_symlink():
            # is_symlink check on the base itself isn't quite what we want;
            # we just want to skip symlinked entries below. The base may be a
            # real directory.
            if not base.is_dir():
                return []
    except OSError:
        return []
    out = []
    try:
        for entry in os.scandir(base):
            try:
                if entry.name.startswith("."):
                    continue
                if entry.is_symlink():
                    continue
                if entry.is_dir(follow_symlinks=False):
                    out.append(entry.name)
            except OSError:
                continue
    except OSError:
        return []
    out.sort()
    return out


def _list_mp3s(dir_str):
    if not dir_str:
        return []
    p = Path(dir_str)
    if not p.is_dir():
        return []
    out = []
    try:
        for entry in os.scandir(p):
            try:
                if entry.is_file(follow_symlinks=False) and entry.name.lower().endswith(".mp3"):
                    out.append(entry.name)
            except OSError:
                continue
    except OSError:
        return []
    out.sort()
    return out


def _create_category(base_str, name):
    """Returns (status, payload)."""
    if not base_str:
        return 400, {"error": "Base directory does not exist"}
    base = Path(base_str)
    if not base.is_dir():
        return 400, {"error": "Base directory does not exist"}
    if not isinstance(name, str):
        return 400, {"error": "Invalid name"}
    name = name.strip()
    if not name or not NAME_RE.match(name):
        return 400, {"error": "Invalid name"}
    target = base / name
    # Defense in depth: ensure resolved target stays under resolved base.
    try:
        resolved_base = base.resolve()
        resolved_target = target.resolve()
    except OSError:
        return 400, {"error": "Invalid name"}
    try:
        resolved_target.relative_to(resolved_base)
    except ValueError:
        return 400, {"error": "Invalid name"}
    if target.exists():
        return 409, {"error": "Category already exists"}
    try:
        target.mkdir(parents=False, exist_ok=False)
    except FileExistsError:
        return 409, {"error": "Category already exists"}
    except OSError as e:
        return 400, {"error": "Failed to create directory: " + str(e)}
    return 200, {"ok": True}


def _run_download(urls, dir_str):
    """Returns (status, payload)."""
    if not isinstance(urls, list) or not urls:
        return 400, {"error": "No URLs provided"}
    if not dir_str or not isinstance(dir_str, str):
        return 400, {"error": "Missing dir"}
    p = Path(dir_str)
    if not p.is_dir():
        return 400, {"error": "Target directory does not exist"}
    cmd = [
        YT_DLP,
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "--no-playlist",
        "-o", str(p) + "/%(title)s.%(ext)s",
    ] + [str(u) for u in urls]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
    except FileNotFoundError:
        return 500, {"error": "yt-dlp not found on PATH", "stdout": "", "stderr": ""}
    if result.returncode != 0:
        return 500, {
            "error": "yt-dlp exited with code " + str(result.returncode),
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    return 200, {
        "ok": True,
        "downloaded": len(urls),
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "youtube2mp3/1.0"

    def log_message(self, format, *args):  # noqa: A002 - stdlib signature
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), format % args))

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/" or parsed.path == "":
            html = INDEX_HTML.replace("%DEFAULT_BASE%", json.dumps(DEFAULT_BASE))
            body = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/categories":
            qs = parse_qs(parsed.query)
            base = (qs.get("base") or [""])[0]
            cats = _list_categories(base)
            _json_response(self, 200, {"categories": cats})
            return
        if parsed.path == "/files":
            qs = parse_qs(parsed.query)
            d = (qs.get("dir") or [""])[0]
            files = _list_mp3s(d)
            _json_response(self, 200, {"files": files})
            return
        _json_response(self, 404, {"error": "Not found"})

    def do_POST(self):  # noqa: N802
        parsed = urlparse(self.path)
        body = _read_json_body(self)
        if body is None:
            _json_response(self, 400, {"error": "Invalid JSON body"})
            return
        if parsed.path == "/categories":
            base = body.get("base") if isinstance(body, dict) else None
            name = body.get("name") if isinstance(body, dict) else None
            status, payload = _create_category(base or "", name or "")
            _json_response(self, status, payload)
            return
        if parsed.path == "/download":
            urls = body.get("urls") if isinstance(body, dict) else None
            d = body.get("dir") if isinstance(body, dict) else None
            # Accept urls as a newline-separated string too.
            if isinstance(urls, str):
                urls = [u.strip() for u in urls.split("\n") if u.strip()]
            status, payload = _run_download(urls, d)
            _json_response(self, status, payload)
            return
        _json_response(self, 404, {"error": "Not found"})


def main(argv=None):
    parser = argparse.ArgumentParser(description="youtube2mp3 web UI")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args(argv)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print("Serving at http://localhost:%d/" % args.port)
    print("Default base: %s" % DEFAULT_BASE)
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

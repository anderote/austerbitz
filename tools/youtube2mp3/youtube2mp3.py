#!/usr/bin/env python3
"""youtube2mp3 — single-file web wrapper around yt-dlp.

Downloads YouTube audio as mp3s into themed subfolders of a base music
directory. Stdlib only. Default port 8765.
"""

import argparse
import json
import os
import queue
import re
import signal
import subprocess
import sys
import threading
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
    --ok: #7fd17f;
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
  #queue { list-style: none; padding: 0; margin: 8px 0 0 0; }
  #queue li { padding: 6px 0; border-bottom: 1px solid var(--border); }
  #queue li:last-child { border-bottom: none; }
  .track-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .track-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .track-meta { color: var(--muted); font-size: 11px; white-space: nowrap; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; border: 1px solid var(--border); font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-right: 6px; }
  .badge.downloading { color: var(--accent); border-color: var(--accent); }
  .badge.done { color: var(--ok); border-color: var(--ok); }
  .badge.error { color: var(--err); border-color: var(--err); }
  .pbar { margin-top: 4px; height: 7px; background: var(--panel); border: 1px solid var(--border); border-radius: 3px; overflow: hidden; }
  .pbar > div { height: 100%; background: var(--accent); width: 0%; transition: width 120ms linear; }
  .pbar.done > div { background: var(--ok); }
  .pbar.error > div { background: var(--err); }
  .actions { display: flex; gap: 8px; }
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
  <div class="actions">
    <button id="download" type="button" disabled>Download</button>
    <button id="stop" type="button" style="display:none;">Stop</button>
  </div>
  <div id="status"></div>
  <ul id="queue"></ul>
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
  var $stop = document.getElementById('stop');
  var $status = document.getElementById('status');
  var $queue = document.getElementById('queue');
  var $files = document.getElementById('files');
  var $filesCount = document.getElementById('filesCount');
  var $filesLabel = document.getElementById('filesLabel');
  var $baseHint = document.getElementById('baseHint');
  var $catHint = document.getElementById('catHint');

  var jobActive = false;
  var es = null;
  var trackEls = {};
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

  function setRunning(running) {
    jobActive = running;
    $download.style.display = running ? 'none' : '';
    $stop.style.display = running ? '' : 'none';
    updateDownloadEnabled();
  }

  function updateDownloadEnabled() {
    var hasUrls = $urls.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean).length > 0;
    $download.disabled = jobActive || !getCategory() || !hasUrls || !baseExists;
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

  function clearQueue() {
    $queue.innerHTML = '';
    trackEls = {};
  }

  function renderTrack(track) {
    var existing = trackEls[track.id];
    if (existing) {
      updateTrack(track);
      return;
    }
    var li = document.createElement('li');
    var head = document.createElement('div');
    head.className = 'track-head';
    var title = document.createElement('div');
    title.className = 'track-title';
    var badge = document.createElement('span');
    badge.className = 'badge ' + track.state;
    badge.textContent = track.state;
    title.appendChild(badge);
    title.appendChild(document.createTextNode(track.title || track.id));
    var meta = document.createElement('div');
    meta.className = 'track-meta';
    head.appendChild(title);
    head.appendChild(meta);
    var pbar = document.createElement('div');
    pbar.className = 'pbar';
    if (track.state === 'done') pbar.className += ' done';
    if (track.state === 'error') pbar.className += ' error';
    var fill = document.createElement('div');
    fill.style.width = (track.state === 'done' ? 100 : (track.percent || 0)) + '%';
    pbar.appendChild(fill);
    li.appendChild(head);
    li.appendChild(pbar);
    $queue.appendChild(li);
    trackEls[track.id] = { li: li, badge: badge, title: title, meta: meta, pbar: pbar, fill: fill };
    updateTrack(track);
  }

  function updateTrack(track) {
    var el = trackEls[track.id];
    if (!el) return;
    el.badge.className = 'badge ' + track.state;
    el.badge.textContent = track.state;
    var pct = (track.state === 'done') ? 100 : (Number(track.percent) || 0);
    el.fill.style.width = pct + '%';
    el.pbar.className = 'pbar' + (track.state === 'done' ? ' done' : (track.state === 'error' ? ' error' : ''));
    var bits = [];
    if (track.state === 'downloading') {
      if (track.percent != null) bits.push(track.percent.toFixed ? track.percent.toFixed(1) + '%' : track.percent + '%');
      if (track.eta) bits.push('eta ' + track.eta);
      if (track.total) bits.push(track.total);
    } else if (track.state === 'error' && track.error) {
      bits.push(track.error);
    }
    el.meta.textContent = bits.join('  ');
  }

  function applySnapshot(state) {
    clearQueue();
    (state.tracks || []).forEach(renderTrack);
    if (state.status === 'running' || state.status === 'stopping') {
      setRunning(true);
      setStatus(state.status === 'stopping' ? 'Stopping...' : 'Downloading...', false);
    } else {
      setRunning(false);
      if (state.status === 'done') setStatus('Done', false);
      else if (state.status === 'stopped') setStatus('Stopped', false);
      else if (state.status === 'error') setStatus('Error', true);
      else setStatus('', false);
    }
  }

  function openEvents() {
    if (es) { try { es.close(); } catch (e) {} es = null; }
    es = new EventSource('/jobs/events');
    es.addEventListener('snapshot', function (e) {
      var s = JSON.parse(e.data);
      applySnapshot(s);
    });
    es.addEventListener('track_started', function (e) {
      var t = JSON.parse(e.data);
      renderTrack(t);
    });
    es.addEventListener('track_progress', function (e) {
      var t = JSON.parse(e.data);
      if (!trackEls[t.id]) renderTrack(t); else updateTrack(t);
    });
    es.addEventListener('track_done', function (e) {
      var t = JSON.parse(e.data);
      if (!trackEls[t.id]) renderTrack(t); else updateTrack(t);
    });
    es.addEventListener('track_error', function (e) {
      var t = JSON.parse(e.data);
      if (!trackEls[t.id]) renderTrack(t); else updateTrack(t);
    });
    es.addEventListener('job_done', function () {
      setStatus('Done', false);
      setRunning(false);
      if (es) { try { es.close(); } catch (e) {} es = null; }
      refreshFiles();
    });
    es.addEventListener('job_stopped', function () {
      setStatus('Stopped', false);
      setRunning(false);
      if (es) { try { es.close(); } catch (e) {} es = null; }
      refreshFiles();
    });
    es.onerror = function () {
      // Browser will auto-reconnect; if the server has finished it'll see closed state.
    };
  }

  function download() {
    if (jobActive) return;
    var dir = joinedDir();
    if (!dir) return;
    var urls = $urls.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    if (urls.length === 0) return;
    setRunning(true);
    clearQueue();
    setStatus('Starting...', false);
    fetch('/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: urls, dir: dir }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, json: j }; }); })
      .then(function (res) {
        if (!res.ok) {
          setStatus('Error: ' + ((res.json && res.json.error) || 'failed to start'), true);
          setRunning(false);
          return;
        }
        setStatus('Downloading...', false);
        openEvents();
      })
      .catch(function (e) {
        setStatus('Network error: ' + e, true);
        setRunning(false);
      });
  }

  function stop() {
    if (!jobActive) return;
    setStatus('Stopping...', false);
    fetch('/jobs/stop', { method: 'POST' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, json: j }; }); })
      .then(function (res) {
        if (!res.ok) {
          setStatus('Error: ' + ((res.json && res.json.error) || 'failed to stop'), true);
        }
      })
      .catch(function (e) { setStatus('Network error: ' + e, true); });
  }

  function resumeIfRunning() {
    fetch('/jobs/status')
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (!s) return;
        applySnapshot(s);
        if (s.status === 'running' || s.status === 'stopping') {
          openEvents();
        }
      })
      .catch(function () {});
  }

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
  $stop.addEventListener('click', stop);

  fetchCategories();
  resumeIfRunning();
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


_PROG_RE = re.compile(r"^PROG\|([^|]*)\|(.*)\|([^|]*)\|([^|]*)\|([^|]*)$")
_DEST_RE = re.compile(r"^\[download\] Destination:\s*(.+)$")
_SENTINEL = object()


class JobState:
    def __init__(self):
        self.lock = threading.Lock()
        self.status = "idle"
        self.dir = ""
        self.tracks = []
        self.track_index = {}
        self.process = None
        self.aborted = False
        self.subscribers = []

    def snapshot(self):
        with self.lock:
            return {
                "status": self.status,
                "dir": self.dir,
                "tracks": [dict(t) for t in self.tracks],
            }

    def subscribe(self):
        q = queue.Queue(maxsize=1024)
        with self.lock:
            self.subscribers.append(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            try:
                self.subscribers.remove(q)
            except ValueError:
                pass

    def emit(self, name, payload):
        with self.lock:
            subs = list(self.subscribers)
        for q in subs:
            try:
                q.put_nowait((name, payload))
            except queue.Full:
                pass

    def close_all(self):
        with self.lock:
            subs = list(self.subscribers)
            self.subscribers.clear()
        for q in subs:
            try:
                q.put_nowait((_SENTINEL, None))
            except queue.Full:
                pass


JOB = JobState()


def _percent_to_float(s):
    if not s:
        return None
    s = s.strip().rstrip("%").strip()
    if not s or s == "N/A":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _clean_field(s):
    s = (s or "").strip()
    if s == "N/A":
        return ""
    return s


def _runner(urls, dir_str):
    target = Path(dir_str)
    try:
        for url in urls:
            with JOB.lock:
                if JOB.aborted:
                    break
            cmd = [
                YT_DLP,
                "-x",
                "--audio-format", "mp3",
                "--audio-quality", "0",
                "--yes-playlist",
                "--ignore-errors",
                "--newline",
                "--progress-template",
                "PROG|%(info.id)s|%(info.title)s|%(progress._percent_str)s|%(progress._total_bytes_str)s|%(progress.eta_str)s",
                "-o", str(target) + "/%(title)s.%(ext)s",
                url,
            ]
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    start_new_session=True,
                )
            except FileNotFoundError:
                with JOB.lock:
                    JOB.status = "error"
                JOB.emit("job_done", {"error": "yt-dlp not found on PATH"})
                JOB.close_all()
                return
            with JOB.lock:
                JOB.process = proc

            current_id = None
            pending_dest_title = None

            assert proc.stdout is not None
            for raw_line in proc.stdout:
                line = raw_line.rstrip("\n").rstrip("\r")
                if not line:
                    continue
                m = _PROG_RE.match(line)
                if m:
                    tid = _clean_field(m.group(1))
                    title = _clean_field(m.group(2))
                    pct = _percent_to_float(m.group(3))
                    total = _clean_field(m.group(4))
                    eta = _clean_field(m.group(5))
                    if not tid:
                        continue
                    if current_id is not None and current_id != tid:
                        with JOB.lock:
                            idx = JOB.track_index.get(current_id)
                            prev = JOB.tracks[idx] if idx is not None else None
                            if prev is not None and prev["state"] == "downloading":
                                prev["state"] = "done"
                                prev["percent"] = 100
                                done_payload = dict(prev)
                            else:
                                done_payload = None
                        if done_payload is not None:
                            JOB.emit("track_done", done_payload)
                    with JOB.lock:
                        idx = JOB.track_index.get(tid)
                        if idx is None:
                            track = {
                                "id": tid,
                                "title": title or tid,
                                "state": "downloading",
                                "percent": pct or 0,
                                "total": total,
                                "eta": eta,
                                "error": "",
                            }
                            JOB.tracks.append(track)
                            JOB.track_index[tid] = len(JOB.tracks) - 1
                            new_track = True
                            payload = dict(track)
                        else:
                            track = JOB.tracks[idx]
                            if title:
                                track["title"] = title
                            if pct is not None:
                                track["percent"] = pct
                            track["total"] = total
                            track["eta"] = eta
                            new_track = False
                            payload = dict(track)
                    if new_track:
                        JOB.emit("track_started", payload)
                    else:
                        JOB.emit("track_progress", payload)
                    current_id = tid
                    pending_dest_title = None
                    continue

                dm = _DEST_RE.match(line)
                if dm and current_id is None:
                    # Fallback: capture filename until PROG arrives with a real id.
                    dest = dm.group(1).strip()
                    base = os.path.basename(dest)
                    title_guess = re.sub(r"\.(mp3|m4a|webm|opus|part)$", "", base, flags=re.IGNORECASE)
                    pending_dest_title = title_guess
                    placeholder_id = "_pending_" + title_guess
                    with JOB.lock:
                        if placeholder_id not in JOB.track_index:
                            track = {
                                "id": placeholder_id,
                                "title": title_guess,
                                "state": "downloading",
                                "percent": 0,
                                "total": "",
                                "eta": "",
                                "error": "",
                            }
                            JOB.tracks.append(track)
                            JOB.track_index[placeholder_id] = len(JOB.tracks) - 1
                            payload = dict(track)
                        else:
                            payload = None
                    if payload is not None:
                        JOB.emit("track_started", payload)
                    current_id = placeholder_id
                    continue

            try:
                proc.stdout.close()
            except Exception:
                pass
            returncode = proc.wait()
            with JOB.lock:
                JOB.process = None
                aborted = JOB.aborted
                final_payload = None
                final_event = None
                if current_id is not None:
                    idx = JOB.track_index.get(current_id)
                    if idx is not None:
                        track = JOB.tracks[idx]
                        if track["state"] == "downloading":
                            if returncode == 0 and not aborted:
                                track["state"] = "done"
                                track["percent"] = 100
                                final_event = "track_done"
                            else:
                                track["state"] = "error"
                                if aborted:
                                    track["error"] = "stopped"
                                else:
                                    track["error"] = "exit " + str(returncode)
                                final_event = "track_error"
                            final_payload = dict(track)
            if final_event and final_payload:
                JOB.emit(final_event, final_payload)

            if aborted:
                break

        with JOB.lock:
            aborted = JOB.aborted
            if aborted:
                JOB.status = "stopped"
            else:
                JOB.status = "done"
        if aborted:
            _sweep_partials(target)
            JOB.emit("job_stopped", {})
        else:
            JOB.emit("job_done", {})
    except Exception as e:
        with JOB.lock:
            JOB.status = "error"
        JOB.emit("job_done", {"error": str(e)})
    finally:
        with JOB.lock:
            JOB.process = None
        JOB.close_all()


def _sweep_partials(target):
    if not target.is_dir():
        return
    try:
        for entry in os.scandir(target):
            try:
                name = entry.name.lower()
                if entry.is_file(follow_symlinks=False) and (
                    name.endswith(".part") or name.endswith(".ytdl") or name.endswith(".tmp")
                ):
                    try:
                        os.remove(entry.path)
                    except OSError:
                        pass
            except OSError:
                continue
    except OSError:
        return


def _start_job(urls, dir_str):
    """Returns (status, payload)."""
    if not isinstance(urls, list) or not urls:
        return 400, {"error": "No URLs provided"}
    if not dir_str or not isinstance(dir_str, str):
        return 400, {"error": "Missing dir"}
    p = Path(dir_str)
    if not p.is_dir():
        return 400, {"error": "Target directory does not exist"}
    with JOB.lock:
        if JOB.status in ("running", "stopping"):
            return 409, {"error": "A job is already running"}
        JOB.status = "running"
        JOB.dir = dir_str
        JOB.tracks = []
        JOB.track_index = {}
        JOB.process = None
        JOB.aborted = False
        # Drain any stale subscribers from a prior job.
        for q in JOB.subscribers:
            try:
                q.put_nowait((_SENTINEL, None))
            except queue.Full:
                pass
        JOB.subscribers = []
    t = threading.Thread(target=_runner, args=([str(u) for u in urls], dir_str), daemon=True)
    t.start()
    return 200, {"ok": True}


def _stop_job():
    with JOB.lock:
        if JOB.status not in ("running", "stopping"):
            return 409, {"error": "No job running"}
        JOB.aborted = True
        JOB.status = "stopping"
        proc = JOB.process
    if proc is not None and proc.poll() is None:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError, OSError):
            pass
    return 200, {"ok": True}


class Handler(BaseHTTPRequestHandler):
    server_version = "youtube2mp3/1.0"

    def log_message(self, format, *args):  # noqa: A002 - stdlib signature
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), format % args))

    def _safe_write(self, data):
        try:
            self.wfile.write(data)
            self.wfile.flush()
            return True
        except (BrokenPipeError, ConnectionResetError, OSError):
            return False

    def _sse_send(self, name, payload):
        msg = "event: %s\ndata: %s\n\n" % (name, json.dumps(payload))
        return self._safe_write(msg.encode("utf-8"))

    def _serve_events(self):
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
        except (BrokenPipeError, ConnectionResetError, OSError):
            return
        q = JOB.subscribe()
        try:
            snap = JOB.snapshot()
            if not self._sse_send("snapshot", snap):
                return
            while True:
                try:
                    item = q.get(timeout=15.0)
                except queue.Empty:
                    if not self._safe_write(b": keepalive\n\n"):
                        return
                    continue
                name, payload = item
                if name is _SENTINEL:
                    return
                if not self._sse_send(name, payload if payload is not None else {}):
                    return
        finally:
            JOB.unsubscribe(q)

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
        if parsed.path == "/jobs/status":
            _json_response(self, 200, JOB.snapshot())
            return
        if parsed.path == "/jobs/events":
            self._serve_events()
            return
        _json_response(self, 404, {"error": "Not found"})

    def do_POST(self):  # noqa: N802
        parsed = urlparse(self.path)
        body = _read_json_body(self) if parsed.path != "/jobs/stop" else {}
        if body is None:
            _json_response(self, 400, {"error": "Invalid JSON body"})
            return
        if parsed.path == "/categories":
            base = body.get("base") if isinstance(body, dict) else None
            name = body.get("name") if isinstance(body, dict) else None
            status, payload = _create_category(base or "", name or "")
            _json_response(self, status, payload)
            return
        if parsed.path == "/jobs":
            urls = body.get("urls") if isinstance(body, dict) else None
            d = body.get("dir") if isinstance(body, dict) else None
            if isinstance(urls, str):
                urls = [u.strip() for u in urls.split("\n") if u.strip()]
            status, payload = _start_job(urls, d)
            _json_response(self, status, payload)
            return
        if parsed.path == "/jobs/stop":
            status, payload = _stop_job()
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

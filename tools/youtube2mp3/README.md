# youtube2mp3

A tiny single-file Python web app that wraps `yt-dlp` to download YouTube
audio as mp3s into themed subfolders of a base music directory. Stdlib only —
no `pip install` needed. `yt-dlp` must be on `PATH`.

## Usage

```
python3 youtube2mp3.py [--port 8765]
```

Then open `http://localhost:8765/`. Pick (or create) a category — a subfolder
of the base directory — paste one or more YouTube URLs, and click Download.
Downloads land in `<base>/<category>/<title>.mp3`.

The base directory and last-selected category are persisted in
`localStorage` (`yt2mp3.base`, `yt2mp3.category`).

## Endpoints

| Method | Path                       | Purpose                                       |
| ------ | -------------------------- | --------------------------------------------- |
| GET    | `/`                        | Serve the inlined HTML/JS UI                  |
| GET    | `/categories?base=<path>`  | List immediate subfolders of `base` (sorted)  |
| POST   | `/categories`              | Body `{base, name}` — create `<base>/<name>/` |
| GET    | `/files?dir=<path>`        | List `*.mp3` files in `dir`                   |
| POST   | `/download`                | Body `{urls, dir}` — run `yt-dlp` into `dir`  |

Category names must match `^[a-zA-Z0-9_-]+$`.

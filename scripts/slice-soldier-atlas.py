#!/usr/bin/env python3
"""
Detects sprite bounding boxes in the British line-infantry reference.

The reference is laid out as a labelled grid:
  rows  = animation states (STANDING, WALKING, FIRING, RELOADING, GETTING SHOT, DYING)
  cols  = directions (NORTH, EAST, SOUTH, WEST)
Each cell holds a variable number of frames.

We find sprites by:
  1. Marking "saturated" pixels (clearly non-gray, non-pure-black, non-pure-white) as foreground.
  2. Detecting horizontal row bands via vertical projection.
  3. Within each band, detecting individual sprites via flood-fill on the mask
     and grouping nearby boxes that belong to the same sprite (head + body + rifle).

Output: a JSON-ish dump of frames by (state, direction) suitable for hand-checking.
"""

from PIL import Image
import sys
import json
from pathlib import Path

SRC = Path(__file__).parent.parent / "public/sprites/british-line-infantry-source.png"
OUT = Path(__file__).parent.parent / "src/render/british-soldier-frames.generated.json"

img = Image.open(SRC).convert("RGBA")
W, H = img.size
print(f"image: {W}x{H}", file=sys.stderr)
px = img.load()

# Build foreground mask. Sprites have saturated colors (red coat, blue trousers,
# gold accents, skin) AND deep blacks (shako, boots). Background is light gray.
# Crop out the row-label column on the left and the column-header band on top.
LEFT_PAD = 170
TOP_PAD = 60

def is_fg(r, g, b):
    if r >= 210 and g >= 210 and b >= 210:
        return False
    sat = max(r, g, b) - min(r, g, b)
    if sat >= 30:
        return True  # colored sprite pixel
    if max(r, g, b) < 50:
        return True  # near-black (shako, boots)
    return False     # mid-gray label text

mask = [[False] * W for _ in range(H)]
for y in range(TOP_PAD, H):
    for x in range(LEFT_PAD, W):
        r, g, b, _a = px[x, y]
        mask[y][x] = is_fg(r, g, b)

# Step 1: row bands. Project mask onto Y axis.
row_count = [sum(mask[y]) for y in range(H)]
# Threshold: a row with >50 fg px is "active"
active = [c > 50 for c in row_count]

bands = []
y = 0
while y < H:
    if active[y]:
        start = y
        while y < H and active[y]:
            y += 1
        bands.append((start, y))
    else:
        y += 1

# Filter: ignore tiny bands (probably labels). Sprite bands are tall (>20 px).
bands = [b for b in bands if b[1] - b[0] >= 20]
print(f"row bands: {bands}", file=sys.stderr)

# Step 2: within each band, find connected components, then bucket their
# centroids into 4 horizontal "direction" columns.
def flood(start_x, start_y, ymin, ymax, visited):
    """Iterative 4-connected flood fill within the band rectangle. Returns bbox."""
    stack = [(start_x, start_y)]
    minx = maxx = start_x
    miny = maxy = start_y
    while stack:
        x, y = stack.pop()
        if x < 0 or x >= W or y < ymin or y >= ymax: continue
        if visited[y][x] or not mask[y][x]: continue
        visited[y][x] = True
        if x < minx: minx = x
        if x > maxx: maxx = x
        if y < miny: miny = y
        if y > maxy: maxy = y
        stack.append((x + 1, y))
        stack.append((x - 1, y))
        stack.append((x, y + 1))
        stack.append((x, y - 1))
    return (minx, miny, maxx, maxy)

# Components per band, then merge nearby components into single sprites.
def components_in_band(ymin, ymax):
    visited = [[False] * W for _ in range(H)]
    comps = []
    for y in range(ymin, ymax):
        for x in range(W):
            if mask[y][x] and not visited[y][x]:
                bbox = flood(x, y, ymin, ymax, visited)
                # filter out tiny noise (single-pixel speckle, blood splatter)
                if (bbox[2] - bbox[0] + 1) * (bbox[3] - bbox[1] + 1) >= 20:
                    comps.append(bbox)
    return comps

def merge_close(comps, max_gap):
    """Merge overlapping/near-touching boxes. Greedy O(n^2)."""
    boxes = list(comps)
    changed = True
    while changed:
        changed = False
        out = []
        used = [False] * len(boxes)
        for i in range(len(boxes)):
            if used[i]: continue
            a = list(boxes[i])
            used[i] = True
            for j in range(i + 1, len(boxes)):
                if used[j]: continue
                b = boxes[j]
                # gap = horizontal distance between boxes
                gap_x = max(0, max(a[0], b[0]) - min(a[2], b[2]))
                gap_y = max(0, max(a[1], b[1]) - min(a[3], b[3]))
                # also allow overlap (negative gap treated as 0)
                # consider for merge if very close horizontally (rifle attached
                # to soldier separated by 1-2px)
                if gap_x <= max_gap and gap_y <= max_gap:
                    a[0] = min(a[0], b[0])
                    a[1] = min(a[1], b[1])
                    a[2] = max(a[2], b[2])
                    a[3] = max(a[3], b[3])
                    used[j] = True
                    changed = True
            out.append(tuple(a))
        boxes = out
    return boxes

state_labels = ["STANDING", "WALKING", "FIRING", "RELOADING", "GETTING_SHOT", "DYING"]
direction_labels = ["NORTH", "EAST", "SOUTH", "WEST"]
# Frames per (state, direction) cell — known from the reference layout.
TARGET_FRAMES = {
    "STANDING": 1,
    "WALKING": 4,
    "FIRING": 3,
    "RELOADING": 3,
    "GETTING_SHOT": 3,
    "DYING": 2,
}

def bbox_dist(a, b):
    """Min L1 separation between two bboxes; 0 if they overlap or touch."""
    gx = max(0, max(a[0], b[0]) - min(a[2], b[2]))
    gy = max(0, max(a[1], b[1]) - min(a[3], b[3]))
    return gx + gy

def merge_pair(a, b):
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))

def detect_frames_xproj(x0, x1, ymin, ymax, max_gap):
    """Find frame bboxes by horizontal-projection runs within the rect.

    A "run" is a contiguous range of x columns with any foreground pixel,
    extended across gaps up to max_gap. Each run becomes one frame; its Y
    bounds come from the rectangle of fg pixels inside it.
    """
    col_density = [0] * (x1 - x0)
    for x in range(x0, x1):
        for y in range(ymin, ymax):
            if mask[y][x]:
                col_density[x - x0] += 1

    runs = []
    in_run = False
    run_start = 0
    gap = 0
    for i, d in enumerate(col_density):
        if d > 0:
            if not in_run:
                in_run = True
                run_start = x0 + i
            gap = 0
        else:
            if in_run:
                gap += 1
                if gap > max_gap:
                    runs.append((run_start, x0 + i - gap))
                    in_run = False
    if in_run:
        runs.append((run_start, x1 - 1))

    out = []
    for (xs, xe) in runs:
        ys = ymax
        ye = ymin - 1
        for x in range(xs, xe + 1):
            for y in range(ymin, ymax):
                if mask[y][x]:
                    if y < ys: ys = y
                    if y > ye: ye = y
        if ye >= ys:
            out.append((xs, ys, xe, ye))
    return out

def trim_to_target(frames, target):
    """Drop tiny stragglers if we have more than target."""
    if len(frames) <= target:
        return frames
    by_area = sorted(frames, key=lambda b: -((b[2] - b[0] + 1) * (b[3] - b[1] + 1)))
    kept = sorted(by_area[:target], key=lambda b: b[0])
    return kept

# Direction column boundaries: 4 evenly-spaced columns across the sprite area.
# Sprite area runs from LEFT_PAD..W. Splits at quarters.
def column_for(x):
    rel = (x - LEFT_PAD) / (W - LEFT_PAD)
    if rel < 0.25: return 0
    if rel < 0.50: return 1
    if rel < 0.75: return 2
    return 3

def cluster_into_4(boxes):
    groups = [[] for _ in range(4)]
    for b in boxes:
        cx = (b[0] + b[2]) // 2
        groups[column_for(cx)].append(b)
    return groups

# Column x-ranges (4 even quarters of the sprite area).
def col_range(d):
    span = (W - LEFT_PAD) / 4
    return (int(LEFT_PAD + d * span), int(LEFT_PAD + (d + 1) * span))

def components_in_rect(xmin, xmax, ymin, ymax):
    visited = [[False] * W for _ in range(H)]
    comps = []
    for y in range(ymin, ymax):
        for x in range(xmin, xmax):
            if mask[y][x] and not visited[y][x]:
                bbox = flood_rect(x, y, xmin, xmax, ymin, ymax, visited)
                if (bbox[2] - bbox[0] + 1) * (bbox[3] - bbox[1] + 1) >= 20:
                    comps.append(bbox)
    return comps

def flood_rect(start_x, start_y, xmin, xmax, ymin, ymax, visited):
    stack = [(start_x, start_y)]
    minx = maxx = start_x
    miny = maxy = start_y
    while stack:
        x, y = stack.pop()
        if x < xmin or x >= xmax or y < ymin or y >= ymax: continue
        if visited[y][x] or not mask[y][x]: continue
        visited[y][x] = True
        if x < minx: minx = x
        if x > maxx: maxx = x
        if y < miny: miny = y
        if y > maxy: maxy = y
        stack.append((x + 1, y))
        stack.append((x - 1, y))
        stack.append((x, y + 1))
        stack.append((x, y - 1))
    return (minx, miny, maxx, maxy)

result = {}
for bi, (ymin, ymax) in enumerate(bands):
    if bi >= len(state_labels):
        print(f"warning: extra band {bi} ({ymin},{ymax}) — skipping", file=sys.stderr)
        continue
    state = state_labels[bi]
    result[state] = {}
    print(f"  {state}:", file=sys.stderr)
    target = TARGET_FRAMES[state]
    # Larger gap for bloody states (splatter is sparser)
    gap = 10 if state in ("GETTING_SHOT", "DYING") else 6
    for di in range(4):
        x0, x1 = col_range(di)
        runs = detect_frames_xproj(x0, x1, ymin, ymax, max_gap=gap)
        trimmed = trim_to_target(runs, target)
        result[state][direction_labels[di]] = [
            {"x": b[0], "y": b[1], "w": b[2] - b[0] + 1, "h": b[3] - b[1] + 1}
            for b in trimmed
        ]
        flag = "" if len(trimmed) == target else f" !! expected {target}"
        print(f"    {direction_labels[di]}: {len(runs)} runs → {len(trimmed)} frames{flag}", file=sys.stderr)

OUT.write_text(json.dumps(result, indent=2))
print(f"wrote {OUT}")

# Debug: render bounding boxes onto the source image so we can eyeball.
DEBUG_OUT = Path(__file__).parent.parent / "public/sprites/_debug-boxes.png"
dbg = img.copy()
from PIL import ImageDraw, ImageFont
draw = ImageDraw.Draw(dbg)
for state, dirs in result.items():
    for d, frames in dirs.items():
        for i, f in enumerate(frames):
            x, y, w, h = f["x"], f["y"], f["w"], f["h"]
            draw.rectangle([x, y, x + w - 1, y + h - 1], outline=(0, 255, 0), width=1)
            draw.text((x, y - 8), f"{state[:3]}.{d[0]}{i}", fill=(0, 180, 0))
dbg.save(DEBUG_OUT)
print(f"wrote {DEBUG_OUT}")

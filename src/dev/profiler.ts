// Lightweight per-frame profiler. Wrap hot paths with `profiler.time(label, fn)`
// or `begin/end` around statements. Call `beginFrame()` at frame start and
// `endFrame()` at frame end; `snapshot()` returns EMA-smoothed timings.
//
// Cost per wrapped section is two `performance.now()` calls (~sub-µs).

interface Sample {
  sumMs: number;
  calls: number;
}

interface Smoothed {
  avgMs: number;
  lastMs: number;
  calls: number;
}

export interface ProfilerEntry {
  label: string;
  avgMs: number;
  lastMs: number;
  calls: number;
}

export interface ProfilerSnapshot {
  totalMs: number;     // EMA-smoothed full frame ms
  lastTotalMs: number; // raw ms of the most recent frame
  entries: ProfilerEntry[]; // sorted desc by avgMs
}

const EMA = 0.1; // weight on the latest sample

class Profiler {
  enabled = true;

  private frame = new Map<string, Sample>();
  private smoothed = new Map<string, Smoothed>();
  private open = new Map<string, number>();
  private frameStart = 0;
  private smoothedTotal = 0;
  private lastTotal = 0;

  beginFrame(): void {
    if (!this.enabled) return;
    this.frame.clear();
    this.open.clear();
    this.frameStart = performance.now();
  }

  begin(label: string): void {
    if (!this.enabled) return;
    this.open.set(label, performance.now());
  }

  end(label: string): void {
    if (!this.enabled) return;
    const t = this.open.get(label);
    if (t === undefined) return;
    this.open.delete(label);
    this.accumulate(label, performance.now() - t);
  }

  time<T>(label: string, fn: () => T): T {
    if (!this.enabled) return fn();
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      this.accumulate(label, performance.now() - t0);
    }
  }

  endFrame(): void {
    if (!this.enabled) return;
    const total = performance.now() - this.frameStart;
    this.lastTotal = total;
    this.smoothedTotal = this.smoothedTotal === 0 ? total : this.smoothedTotal * (1 - EMA) + total * EMA;

    for (const [label, sample] of this.frame) {
      const prev = this.smoothed.get(label);
      const avg = prev === undefined ? sample.sumMs : prev.avgMs * (1 - EMA) + sample.sumMs * EMA;
      this.smoothed.set(label, { avgMs: avg, lastMs: sample.sumMs, calls: sample.calls });
    }
    // Decay labels that didn't fire this frame so they fade off the panel.
    for (const [label, prev] of this.smoothed) {
      if (this.frame.has(label)) continue;
      const avg = prev.avgMs * (1 - EMA);
      if (avg < 0.005) this.smoothed.delete(label);
      else this.smoothed.set(label, { avgMs: avg, lastMs: 0, calls: 0 });
    }
  }

  snapshot(): ProfilerSnapshot {
    const entries: ProfilerEntry[] = [];
    for (const [label, s] of this.smoothed) {
      entries.push({ label, avgMs: s.avgMs, lastMs: s.lastMs, calls: s.calls });
    }
    entries.sort((a, b) => b.avgMs - a.avgMs);
    return { totalMs: this.smoothedTotal, lastTotalMs: this.lastTotal, entries };
  }

  reset(): void {
    this.frame.clear();
    this.smoothed.clear();
    this.open.clear();
    this.smoothedTotal = 0;
    this.lastTotal = 0;
  }

  private accumulate(label: string, ms: number): void {
    const cur = this.frame.get(label);
    if (cur === undefined) this.frame.set(label, { sumMs: ms, calls: 1 });
    else { cur.sumMs += ms; cur.calls += 1; }
  }
}

export const profiler = new Profiler();

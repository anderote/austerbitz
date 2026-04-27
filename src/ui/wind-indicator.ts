export interface WindIndicator {
  /** `wind` is the current global wind value (m/s, signed). Positive = E. */
  update(wind: number): void;
}

export function createWindIndicator(root: HTMLElement): WindIndicator {
  const el = document.createElement('div');
  el.className = 'wind-indicator';
  el.innerHTML = `
    <div class="compass">
      <span class="dir n">N</span>
      <span class="dir s">S</span>
      <span class="dir e">E</span>
      <span class="dir w">W</span>
      <div class="arrow-wrap">
        <svg viewBox="-10 -10 20 20" width="34" height="34">
          <path d="M -7 0 L 5 0 M 1 -4 L 5 0 L 1 4"
                stroke="#e23a3a" stroke-width="2.2"
                fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>
    <div class="speed">0.0 m/s</div>
  `;
  root.appendChild(el);

  const arrowWrap = el.querySelector('.arrow-wrap') as HTMLDivElement;
  const speedLabel = el.querySelector('.speed') as HTMLDivElement;

  return {
    update(wind: number) {
      // Wind is currently x-axis only (E+/W−). Rotate 0° → arrow points east.
      const deg = wind >= 0 ? 0 : 180;
      arrowWrap.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
      speedLabel.textContent = `${Math.abs(wind).toFixed(1)} m/s`;
    },
  };
}

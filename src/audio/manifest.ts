export interface SfxConfig {
  url: string;
  gain: number;
  falloffM: number;
}

export const MANIFEST: Record<string, SfxConfig> = {
  'shell-detonate': { url: '/audio/shell-detonate.wav', gain: 1.0, falloffM: 80 },
  'cannon-fire':    { url: '/audio/cannon-fire.wav',    gain: 1.0, falloffM: 100 },
  'canister-fire':  { url: '/audio/canister-fire.wav',  gain: 1.0, falloffM: 80 },
  'solid-skip':     { url: '/audio/solid-skip.wav',     gain: 0.7, falloffM: 50 },
};

/**
 * Tiny synthesized cues (no audio assets): a soft two-note chime for "needs
 * you", a rising arpeggio for "done", a low blip for "failed". Off by default.
 */
export type Cue = 'attention' | 'done' | 'failed' | 'welcome';

let ctx: AudioContext | null = null;

/** Must be called from a user gesture once (e.g. enabling sounds) to unlock audio. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
  } catch {
    ctx = null;
  }
}

const NOTES: Record<Cue, [number, number][]> = {
  attention: [
    [880, 0],
    [660, 0.16],
  ],
  done: [
    [523, 0],
    [659, 0.09],
    [784, 0.18],
  ],
  failed: [
    [220, 0],
    [185, 0.14],
  ],
  welcome: [
    [587, 0],
    [740, 0.08],
    [880, 0.16],
    [1175, 0.26],
  ],
};

export function playCue(cue: Cue) {
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime + 0.01;
  for (const [freq, offset] of NOTES[cue]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = cue === 'failed' ? 'triangle' : 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0 + offset);
    gain.gain.linearRampToValueAtTime(0.05, t0 + offset + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + offset);
    osc.stop(t0 + offset + 0.16);
  }
}

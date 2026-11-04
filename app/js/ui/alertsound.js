// Alert sounds for the lockscreen: four short (1–2 s) sounds, one per kind of news.
//   question  → two rising bell notes ("hm?")
//   done      → quick bright arpeggio up to the octave
//   update    → one soft marimba bloom (progress, images, info)
//   important → three firm pulses, then a high answer
// Claude plays bell tones; Codex/GPT plays the same rhythm a fourth lower with a
// rounder, woodier tone, so they're related but tell apart by ear.
// Synthesized with WebAudio, so there are no audio files. The radio dips under the
// sound (the music's own volume, not the TV's, so no volume overlay appears).
import { duck } from './radio.js';

let ctx = null;

function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// One struck note: a few partials with a fast attack and an exponential tail, sent
// through a short feedback delay for a little air.
function strike(c, out, t, freq, { length = 1.1, level = 0.2, partials = [1, 2.01, 3.0], gains = [1, 0.35, 0.12], type = 'sine' } = {}) {
  partials.forEach((p, i) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = freq * p;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level * gains[i], t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length / (1 + i * 0.6));
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + length + 0.05);
  });
}

const N = { A4: 440, C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5 };

// [time offset s, note, options]
const PATTERNS = {
  question: [[0, N.E5, { length: 0.9 }], [0.18, N.A5, { length: 1.3 }]],
  done: [[0, N.C5, { length: 0.8, level: 0.16 }], [0.08, N.E5, { length: 0.9, level: 0.16 }], [0.16, N.G5, { length: 1.0, level: 0.16 }], [0.26, N.C6, { length: 1.5, level: 0.2 }]],
  update: [[0, N.G5, { length: 0.9, level: 0.22, partials: [1, 4.0], gains: [1, 0.25] }], [0.02, N.G5 / 2, { length: 0.6, level: 0.1, partials: [1], gains: [1] }]],
  important: [[0, N.A5, { length: 0.25, level: 0.24 }], [0.16, N.A5, { length: 0.25, level: 0.24 }], [0.32, N.A5, { length: 0.25, level: 0.24 }], [0.55, N.E6, { length: 1.2, level: 0.22 }]],
};

// Codex/GPT: a perfect fourth lower (×0.75), rounder triangle partials.
const CODEX = { transpose: 0.75, type: 'triangle', partials: [1, 2.0], gains: [1, 0.2] };

export function soundFor(ev) {
  if (ev.important) return 'important';
  if (ev.kind === 'question') return 'question';
  if (ev.kind === 'done' || ev.kind === 'wrapup') return 'done';
  return 'update';
}

export function playAlertSound(name, source) {
  let c;
  try { c = audioCtx(); } catch (e) { return; }
  const codex = source === 'gpt';
  const out = c.createGain();
  out.gain.value = 0.9;
  const delay = c.createDelay(1);
  const fb = c.createGain();
  delay.delayTime.value = 0.17;
  fb.gain.value = 0.22;
  out.connect(c.destination);
  out.connect(delay);
  delay.connect(fb);
  fb.connect(delay);
  fb.connect(c.destination);
  const t0 = c.currentTime + 0.05;
  duck(true);
  for (const [at, freq, opts] of PATTERNS[name] || PATTERNS.update) {
    strike(c, out, t0 + at, codex ? freq * CODEX.transpose : freq, codex ? { ...opts, type: CODEX.type, partials: CODEX.partials, gains: CODEX.gains } : opts);
  }
  setTimeout(() => duck(false), 2200);
}

// For trying them out from the dev console: __sounds() plays all eight.
window.__sounds = async () => {
  for (const source of ['claude', 'gpt']) for (const n of Object.keys(PATTERNS)) { playAlertSound(n, source); await new Promise(r => setTimeout(r, 2600)); }
};

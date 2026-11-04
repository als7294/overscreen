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
import { pref } from '../util/prefs.js';

let ctx = null;

function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// One struck note: a few partials with a fast attack and an exponential tail, sent
// through a short feedback delay for a little air.
function strike(c, out, t, freq, { length = 1.6, level = 0.12, partials = [1, 2.0, 3.0], gains = [1, 0.22, 0.07], type = 'sine', bend = 1, attack = 0.006 } = {}) {
  partials.forEach((p, i) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * p, t);
    // bend > 1 glides the note up after it starts, like a voice rising on a question
    if (bend !== 1) osc.frequency.exponentialRampToValueAtTime(freq * p * bend, t + 0.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level * gains[i], t + attack); // crisp strike for chimes, slow for pads
    g.gain.exponentialRampToValueAtTime(0.0001, t + length / (1 + i * 0.6));
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + length + 0.05);
  });
}

const N = { G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760, C7: 2093 };

// Chimes, all in major keys so they read as happy. [time offset s, note, options]
const PATTERNS = {
  // curious: a light rising run that ends up high and open
  question: [[0, N.G5, { length: 0.8 }], [0.09, N.B5, { length: 0.9 }], [0.18, N.E6, { length: 1.8, level: 0.13 }]],
  // done: a bright major chord rolled upward, then a soft sparkle on top
  // done: a different instrument on purpose. Two wooden kalimba plucks ("ta-da", low then
  // an octave up) over a soft warm swell, so it reads as finished, not curious.
  done: [
    [0, 523.25, { length: 0.45, level: 0.16, partials: [1, 4.0], gains: [1, 0.25] }],
    [0.14, 1046.5, { length: 0.9, level: 0.15, partials: [1, 4.0], gains: [1, 0.25] }],
    [0.1, 261.63, { length: 1.6, level: 0.05, partials: [1], gains: [1], attack: 0.3 }],
    [0.1, 329.63, { length: 1.6, level: 0.045, partials: [1], gains: [1], attack: 0.3 }],
    [0.1, 392, { length: 1.6, level: 0.04, partials: [1], gains: [1], attack: 0.3 }],
  ],
  // update: one clear chime with its octave underneath
  update: [[0, N.E6, { length: 1.6, level: 0.11 }], [0.01, N.E6 / 2, { length: 1.2, level: 0.06, partials: [1], gains: [1] }]],
  // important: a two-note "ding-dong" up, played twice
  important: [[0, N.D6, { length: 0.9 }], [0.16, N.A6, { length: 1.1 }], [0.55, N.D6, { length: 0.9 }], [0.71, N.A6, { length: 1.8, level: 0.13 }]],
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
  if (!pref('sounds')) return; // Settings → Alert sounds
  if (typeof location !== 'undefined' && /[?&]mute\b/.test(location.search)) return; // silent previews
  let c;
  try { c = audioCtx(); } catch (e) { return; }
  const codex = source === 'gpt';
  const out = c.createGain();
  out.gain.value = 0.42; // quieter than before
  const warm = c.createBiquadFilter();
  warm.type = 'lowpass';
  warm.frequency.value = 5200; // keeps the chime bright but never harsh
  const delay = c.createDelay(1);
  const fb = c.createGain();
  delay.delayTime.value = 0.17;
  fb.gain.value = 0.16;
  out.connect(warm);
  warm.connect(c.destination);
  warm.connect(delay);
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

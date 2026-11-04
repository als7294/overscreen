// Boot chime: a soft swell while the orb grows, then a bright sparkle on the flash.
// Synthesized with WebAudio so there's no audio file to ship.
export function playBootChime() {
  let ctx;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  const out = ctx.createGain();
  out.gain.value = 0.22; // ponytail: fixed volume; add a Settings toggle if it's too loud
  out.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.05;

  function note(freq, start, attack, length, level, type) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t0 + start);
    g.gain.linearRampToValueAtTime(level, t0 + start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + length);
    osc.connect(g);
    g.connect(out);
    osc.start(t0 + start);
    osc.stop(t0 + start + length + 0.05);
  }

  // Swell (A major-ish pad) under the orb and ribbons.
  [220, 277.2, 329.6, 440].forEach((f, i) => note(f, 0.1 + i * 0.12, 1.2, 2.6, 0.18, 'triangle'));
  // Sparkle on the flash (~1.9 s).
  [880, 1108.7, 1318.5, 1760].forEach((f, i) => note(f, 1.9 + i * 0.07, 0.02, 1.6, 0.16));
  setTimeout(() => ctx.close && ctx.close(), 5000);
}

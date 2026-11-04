// Now-playing chip (lockscreen and Home top bar): cover art, track, station, little EQ.
import { h, setText } from '../util/dom.js';
import { onTrack } from './radio.js';

export function nowPlayingChip(parent, className) {
  const el = h('div', 'np-chip ' + (className || ''), parent);
  const art = h('img', 'np-art', el);
  art.onerror = () => { art.style.visibility = 'hidden'; };
  art.onload = () => { art.style.visibility = ''; };
  const words = h('div', 'np-words', el);
  const title = h('div', 'np-title', words);
  const sub = h('div', 'np-sub', words);
  const eq = h('div', 'np-eq', el);
  for (let i = 0; i < 4; i++) h('i', '', eq).style.animationDelay = -(i * 0.27).toFixed(2) + 's';
  const off = onTrack(t => {
    setText(title, t.title || 'Tuning in…');
    setText(sub, (t.artist ? t.artist + ' · ' : '') + (t.station || 'Radio'));
    if (t.art && art.getAttribute('src') !== t.art) art.src = t.art;
    if (!t.art) art.style.visibility = 'hidden';
    el.classList.toggle('paused', !!t.paused);
  });
  return { el, destroy: off };
}

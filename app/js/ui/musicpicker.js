// Music picker: the now-playing pill opens into this. The screen dims and the pill
// grows into a panel of 4:5 cards in two rows:
//   Radio here      ad-free streams that play inside SamSUCKS
//   YouTube Music   artist mixes, opened in the TV's YouTube app over DIAL (the same way a
//                   phone casts). Ad-free because the TV's YouTube is signed in to Premium.
// ← → ↑ ↓ to move, OK to play, Back to close.
import { h } from '../util/dom.js';
import { STATIONS, currentStation, setStation, stop as stopRadio, track } from './radio.js';
import { warn } from '../util/log.js';

// Mixes seeded from one song each (YouTube builds the rest of the mix from it).
export const MIXES = [
  { id: 'mac', name: 'Mac Miller', genre: 'Mix', video: 'SsKT0s5J8ko' },
  { id: 'ken', name: 'Ken Carson', genre: 'Mix', video: 'CSMiPngo4uE' },
  { id: 'tapeb', name: 'Tape B', genre: 'Mix', video: 'sEI-6g7Gsp4' },
  { id: 'fallout', name: 'Fallout Radio', genre: '40s & 50s mix', video: 'n9D6GNzpmkM' },
  { id: 'tyler', name: 'Tyler, The Creator', genre: 'Mix', video: 'TGgcC5xg9YI' },
  { id: 'lofigirl', name: 'Lofi Girl', genre: 'Live', video: 'rFZHOHl-L8A', live: true },
];

// DIAL launch: YouTube plays the video, then keeps going with its "Mix" playlist.
export function dialBody(m) {
  return m.live ? 'v=' + m.video : 'v=' + m.video + '&list=RD' + m.video;
}

let root = null;
let rows = [];
let r = 0;
const col = [0, 0];

function card(parent, art, name, genre, playing) {
  const c = h('div', 'mp-card' + (playing ? ' playing' : ''), parent);
  const img = h('img', '', c);
  img.decoding = 'async';
  img.src = art;
  h('div', 'mp-shade', c);
  const words = h('div', 'mp-words', c);
  h('div', 'mp-name', words).textContent = name;
  h('div', 'mp-genre', words).textContent = genre;
  if (playing) h('div', 'mp-playing', c).textContent = track.paused ? 'Paused' : 'Playing';
  return c;
}

function render() {
  rows.forEach((row, ri) => row.cards.forEach((c, ci) => c.classList.toggle('focus', ri === r && ci === col[ri])));
}

export function isOpen() { return !!root; }

export function openPicker() {
  if (root) return;
  root = h('div', 'mp', document.body);
  h('div', 'mp-dim', root);
  const panel = h('div', 'mp-panel', root);
  rows = [];
  const cur = currentStation().id;
  const sec1 = h('div', 'mp-sec', panel);
  h('div', 'mp-label', sec1).innerHTML = 'Radio <span>· plays here, no ads</span>';
  const row1 = h('div', 'mp-row', sec1);
  rows.push({ kind: 'radio', items: STATIONS, cards: STATIONS.map(s => card(row1, s.art, s.name, s.genre, s.id === cur)) });
  const sec2 = h('div', 'mp-sec', panel);
  h('div', 'mp-label', sec2).innerHTML = 'YouTube Music <span>· opens YouTube, Premium = no ads</span>';
  const row2 = h('div', 'mp-row', sec2);
  rows.push({ kind: 'yt', items: MIXES, cards: MIXES.map(m => card(row2, 'https://i.ytimg.com/vi/' + m.video + '/hqdefault.jpg', m.name, m.genre, false)) });
  r = 0;
  col[0] = Math.max(0, STATIONS.findIndex(s => s.id === cur));
  render();
  void root.offsetWidth;
  root.classList.add('open');
}

export function closePicker() {
  if (!root) return;
  const el = root;
  root = null;
  el.classList.remove('open');
  setTimeout(() => el.remove(), 450);
}

function choose() {
  const row = rows[r];
  const item = row.items[col[r]];
  if (row.kind === 'radio') { setStation(item.id); closePicker(); return; }
  stopRadio();
  fetch('http://127.0.0.1:8080/ws/apps/YouTube', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: dialBody(item) })
    .catch(e => warn('YouTube launch failed', e.message));
  closePicker();
}

// Returns true when the picker used the key.
export function pickerOnKey(action) {
  if (!root) return false;
  if (action === 'back') closePicker();
  else if (action === 'left' || action === 'right') col[r] = Math.max(0, Math.min(rows[r].cards.length - 1, col[r] + (action === 'left' ? -1 : 1)));
  else if (action === 'up' || action === 'down') { r = action === 'up' ? 0 : 1; col[r] = Math.min(col[r], rows[r].cards.length - 1); }
  else if (action === 'enter') { choose(); return true; }
  render();
  return true;
}

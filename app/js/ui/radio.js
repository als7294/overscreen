// Background radio: real 24/7 lofi hip-hop (Box Lofi), SomaFM Fluid as a last resort. Each station tells us what's playing; cover art comes from iTunes.
// One stream for the whole app, so the music carries on from the lockscreen into Home.
import { warn } from '../util/log.js';

// What's playing, read from the stream itself: ask for Icecast "ICY" metadata, read up to
// the first metadata block ("StreamTitle='Artist - Title';"), then hang up. ~16 KB per check.
export function parseStreamTitle(meta) {
  const m = /StreamTitle='(.*?)';/.exec(meta);
  const raw = m ? m[1].trim() : '';
  const i = raw.indexOf(' - ');
  return i > 0 ? { artist: raw.slice(0, i).trim(), title: raw.slice(i + 3).trim() } : { artist: '', title: raw };
}

async function icyTitle(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(url, { headers: { 'Icy-MetaData': '1' }, signal: ctl.signal });
    const every = Number(res.headers.get('icy-metaint'));
    if (!every) return { artist: '', title: '' };
    const reader = res.body.getReader();
    let buf = new Uint8Array(0);
    while (buf.length < every + 1 || buf.length < every + 1 + buf[every] * 16) {
      const { value, done } = await reader.read();
      if (done) break;
      const next = new Uint8Array(buf.length + value.length);
      next.set(buf);
      next.set(value, buf.length);
      buf = next;
    }
    return parseStreamTitle(new TextDecoder().decode(buf.slice(every + 1, every + 1 + buf[every] * 16)));
  } finally {
    clearTimeout(timer);
    ctl.abort();
  }
}

// In-app stations (all ad-free). Box Lofi first; the rest are listener-supported SomaFM.
const BOX = 'https://boxradio-edge-00.streamafrica.net/lofi';
const soma = (id, name, genre, ext = 'png') => ({
  id, name, genre, url: 'https://ice6.somafm.com/' + id + '-128-mp3', art: 'https://api.somafm.com/logos/512/' + id + '512.' + ext,
  meta: async () => { const x = (await (await fetch('https://somafm.com/songs/' + id + '.json')).json()).songs[0]; return { artist: x.artist, title: x.title, art: x.albumArt }; },
});
export const STATIONS = [
  { id: 'lofi', name: 'Box Lofi', genre: 'Lofi hip-hop', url: BOX, art: 'https://picsum.photos/seed/lofi-night/480/600', meta: () => icyTitle(BOX) },
  soma('fluid', 'Fluid', 'Instrumental hip-hop', 'jpg'),
  soma('groovesalad', 'Groove Salad', 'Chill'),
  soma('sonicuniverse', 'Sonic Universe', 'Jazz'),
  soma('beatblender', 'Beat Blender', 'Deep house'),
  soma('vaporwaves', 'Vaporwaves', 'Vaporwave'),
];

const audio = new Audio();
let wanted = false;
let stationIndex = Math.max(0, STATIONS.findIndex(x => x.id === (localStorage.getItem('ss.station') || 'lofi')));
let retryTimer = 0;
let pollTimer = 0;
const listeners = new Set();
export const track = { title: '', artist: '', art: '', paused: false, station: STATIONS[0].name };

function emit() { listeners.forEach(fn => fn(track)); }

export function onTrack(fn) {
  listeners.add(fn);
  fn(track);
  return () => listeners.delete(fn);
}

function start() {
  audio.src = STATIONS[stationIndex].url;
  track.station = STATIONS[stationIndex].name;
  audio.play().catch(e => warn('radio play failed', e.message));
}

export function play() {
  if (wanted && !audio.paused) return;
  wanted = true;
  track.paused = false;
  start();
  poll();
  emit();
}

export function stop() {
  wanted = false;
  clearTimeout(retryTimer);
  clearTimeout(pollTimer);
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

export function togglePause() {
  if (wanted) { stop(); track.paused = true; } else play();
  emit();
}

audio.addEventListener('error', () => {
  if (!wanted) return;
  stationIndex = stationIndex ? 0 : 1; // station down: fall back to Box Lofi, or Fluid if Box is the one down
  track.title = track.artist = track.art = '';
  emit();
  clearTimeout(retryTimer);
  retryTimer = setTimeout(start, 3000);
});

// iTunes lookups are slow, so ask for a small image and remember every answer.
const artCache = JSON.parse(localStorage.getItem('ss.art') || '{}');
async function coverArt(artist, title) {
  const key = (artist + '|' + title).toLowerCase();
  if (key in artCache) return artCache[key];
  let url = '';
  try {
    const res = await fetch('https://itunes.apple.com/search?entity=song&limit=1&term=' + encodeURIComponent(artist + ' ' + title));
    const hit = (await res.json()).results[0];
    url = hit ? hit.artworkUrl100.replace('100x100bb', '300x300bb') : '';
  } catch (e) {}
  artCache[key] = url;
  const keys = Object.keys(artCache);
  if (keys.length > 300) delete artCache[keys[0]];
  try { localStorage.setItem('ss.art', JSON.stringify(artCache)); } catch (e) {}
  return url;
}

export function currentStation() { return STATIONS[stationIndex]; }

export function setStation(id) {
  const i = STATIONS.findIndex(x => x.id === id);
  if (i < 0) return;
  stationIndex = i;
  try { localStorage.setItem('ss.station', id); } catch (e) {}
  track.title = track.artist = '';
  track.art = STATIONS[i].art;
  wanted = false;
  play();
}

async function poll() {
  clearTimeout(pollTimer);
  try {
    const song = await STATIONS[stationIndex].meta();
    if (song.title !== track.title || song.artist !== track.artist) {
      track.title = song.title;
      track.artist = song.artist;
      track.art = song.art || (song.title ? await coverArt(song.artist, song.title) : '') || STATIONS[stationIndex].art;
      emit();
    }
  } catch (e) {
    warn('now playing failed', e.message);
  }
  if (wanted) pollTimer = setTimeout(poll, 30000);
}

// Leaving SamSUCKS for another app: stop the music there, resume on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (wanted) { stop(); wanted = true; } }
  else if (wanted) { wanted = false; play(); }
});

// Dip the music under an alert sound. This is the stream's own volume, not the TV's,
// so the TV's volume overlay never appears.
let duckTimer = 0;
export function duck(on) {
  const target = on ? 0.3 : 1;
  clearInterval(duckTimer);
  duckTimer = setInterval(() => {
    const v = audio.volume + (target - audio.volume) * 0.35;
    audio.volume = Math.abs(v - target) < 0.02 ? target : v;
    if (audio.volume === target) clearInterval(duckTimer);
  }, 30);
}

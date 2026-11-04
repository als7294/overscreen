// Background radio: real 24/7 lofi hip-hop (Box Lofi), SomaFM Fluid as a last resort. Each station tells us what's playing; cover art comes from iTunes.
// One stream for the whole app, so the music carries on from the lockscreen into Home.
import { warn } from '../util/log.js';
import { NOTIFY_HOST } from '../config.js';

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

// ---------- YouTube mixes (looked up by the Mac relay, streamed straight from YouTube) ----------
let yt = null; // { seed, name, live, tracks: [{id, title, channel}], i, fails }
const relay = p => fetch('http://' + NOTIFY_HOST + p).then(r => { if (!r.ok) throw new Error('relay ' + r.status); return r.json(); });
const thumb = id => 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
function splitTitle(title, channel) {
  const t = String(title).replace(/\s*[\(\[](official|lyric|audio|video|visualizer|hd|4k)[^\)\]]*[\)\]]/gi, '').trim();
  const i = t.indexOf(' - ');
  return i > 0 ? { artist: t.slice(0, i), title: t.slice(i + 3) } : { artist: String(channel || '').replace(/VEVO$|\s*-\s*Topic$/, ''), title: t };
}
async function playYtTrack() {
  if (!yt || !wanted) return;
  const item = yt.tracks[yt.i % yt.tracks.length];
  const meta = splitTitle(item.title, item.channel);
  track.title = meta.title;
  track.artist = meta.artist;
  track.art = thumb(item.id);
  emit();
  try {
    await relay('/yt/audio?v=' + item.id); // warm the lookup so the stream starts fast
    if (!yt || !wanted) return;
    audio.src = 'http://' + NOTIFY_HOST + '/yt/stream?v=' + item.id;
    audio.play().catch(e => warn('yt play failed', e.message));
    yt.fails = 0;
  } catch (e) {
    ytFailed(e);
  }
}
function ytFailed(e) {
  warn('yt track failed', e && e.message);
  if (!yt) return;
  // Three misses in a row (Mac asleep, YouTube refusing): fall back to Box Lofi.
  if (++yt.fails >= 3) { yt = null; stationIndex = 0; track.title = track.artist = ''; start(); poll(); return; }
  yt.i++;
  setTimeout(playYtTrack, 800);
}
export function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export async function playMix(m) {
  yt = { seed: m.video, name: m.name, live: !!m.live, tracks: [{ id: m.video, title: m.name, channel: '' }], i: 0, fails: 0 };
  track.station = m.name + ' · YouTube';
  try { localStorage.setItem('ss.station', 'yt'); localStorage.setItem('ss.mix', JSON.stringify(m)); } catch (e) {}
  wanted = true;
  track.paused = false;
  clearTimeout(pollTimer);
  if (!m.live) {
    // Shuffled every time, so a mix never plays the same songs in the same order on each load.
    try { const r = await relay('/yt/mix?v=' + m.video); if (r.tracks && r.tracks.length && yt && yt.seed === m.video) yt.tracks = shuffle(r.tracks); } catch (e) { warn('mix list failed', e.message); }
  }
  playYtTrack();
}
// Picks how a mix plays: behind the lockscreen through the Mac (it looks each song up with yt-dlp
// and passes the audio along) when the Mac is around; otherwise, and for live streams, it opens
// in the TV's YouTube app (ad-free with Premium).
export function openInYouTube(m) {
  stop();
  const body = m.live ? 'v=' + m.video : 'v=' + m.video + '&list=RD' + m.video;
  fetch('http://127.0.0.1:8080/ws/apps/YouTube', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body }).catch(e => warn('YouTube launch failed', e.message));
}
export async function startMix(m) {
  if (m.live) return openInYouTube(m);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch('http://' + NOTIFY_HOST + '/yt/audio?v=' + m.video, { signal: ac.signal });
    if (!r.ok) throw new Error('relay ' + r.status);
    playMix(m);
  } catch (e) {
    warn('mix via Mac unavailable, opening YouTube', e.message);
    openInYouTube(m);
  } finally { clearTimeout(t); }
}
export function currentMix() { return yt ? yt.seed : null; }
audio.addEventListener('ended', () => { if (yt && wanted) { yt.i++; playYtTrack(); } });

// ?mute in the page URL (browser previews, screenshots): never make a sound.
const MUTED = typeof location !== 'undefined' && /[?&]mute\b/.test(location.search);
function start() {
  if (MUTED) { track.station = STATIONS[stationIndex].name; return; }
  if (yt) { if (yt.tracks.length < 2) playMix({ video: yt.seed, name: yt.name, live: yt.live }); else playYtTrack(); return; }
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
  if (yt) { ytFailed(new Error('audio error ' + (audio.error && audio.error.code))); return; }
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
  yt = null;
  stationIndex = i;
  try { localStorage.setItem('ss.station', id); } catch (e) {}
  track.title = track.artist = '';
  track.art = STATIONS[i].art;
  wanted = false;
  play();
}

async function poll() {
  clearTimeout(pollTimer);
  if (yt) return; // YouTube tracks carry their own titles
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

// After a restart, pick the YouTube mix back up if that's what was playing.
try {
  if (localStorage.getItem('ss.station') === 'yt') {
    const m = JSON.parse(localStorage.getItem('ss.mix') || 'null');
    if (m) { yt = { seed: m.video, name: m.name, live: !!m.live, tracks: [{ id: m.video, title: m.name, channel: '' }], i: 0, fails: 0 }; track.station = m.name + ' · YouTube'; }
  }
} catch (e) {}

// ---------- start-up station (Settings → Start-up music) ----------
// 'random' (default): a different in-app station from last time on every start.
// 'last': pick up whatever was playing, YouTube mix included.
export function startMode() {
  try { return localStorage.getItem('ss.musicStart') || 'random'; } catch (e) { return 'random'; }
}
export function setStartMode(mode) {
  try { localStorage.setItem('ss.musicStart', mode); } catch (e) {}
}
export function pickDifferent(lastId, ids, rnd = Math.random) {
  const options = ids.filter(id => id !== lastId);
  return options.length ? options[Math.floor(rnd() * options.length)] : ids[0];
}
if (startMode() === 'random') {
  let last = 'lofi';
  try { last = localStorage.getItem('ss.station') || 'lofi'; } catch (e) {}
  // Start-up stays chill: lofi or Groove Salad (the picker still has every station).
  const id = pickDifferent(last, ['lofi', 'groovesalad']);
  yt = null;
  stationIndex = STATIONS.findIndex(x => x.id === id);
  track.station = STATIONS[stationIndex].name;
  try { localStorage.setItem('ss.station', id); } catch (e) {}
}

// ---------- Mac menu-bar music remote ----------
// The TV tells the Mac relay what's playing (and the station list); the menu-bar app reads it
// and sends back station / play-pause commands, which arrive as {kind:'music'} pop-up events.
let reportTimer = 0;
function report() {
  if (!NOTIFY_HOST) return;
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    const body = { title: track.title, artist: track.artist, station: track.station, paused: !!track.paused,
      current: yt ? '' : STATIONS[stationIndex].id, stations: STATIONS.map(s => ({ id: s.id, name: s.name, genre: s.genre })) };
    fetch('http://' + NOTIFY_HOST + '/music/state', { method: 'POST', body: JSON.stringify(body) }).catch(() => {});
  }, 400);
}
listeners.add(report);
setInterval(report, 20000); // keep the menu-bar app's view fresh

export function musicCommand(ev) {
  if (ev.cmd === 'station') setStation(ev.id);
  else if (ev.cmd === 'toggle') { togglePause(); report(); }
  else if (ev.cmd === 'mix' && /^[\w-]{11}$/.test(ev.id)) startMix({ video: ev.id, name: String(ev.name || 'YouTube mix').slice(0, 60), live: !!ev.live });
}

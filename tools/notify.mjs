// TV alert relay on the Mac: Claude Code / Codex  →  SamSUCKS pop-ups on the TV.
//   POST /notify   a Claude Code hook payload (passive) or a tv-alert event ({alert: true, ...})
//   GET  /events   SamSUCKS long-polls this for pop-ups
//   GET  /media/*  images/audio that tv-alert copied into MEDIA_DIR
// The rules (from the owner):
//   - only when this Mac can see *our* TV (so: on the home Wi-Fi) and the TV is on
//   - agents may alert whenever they see fit, except while Netflix or Hulu is in front:
//     then only `important` alerts get through
//   - automatic hook pop-ups interrupt other apps (not Netflix/Hulu) only for questions, approvals, finished
// To show over another app, the relay brings SamSUCKS forward and afterwards reopens that app.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import * as ytmode from './ytmode.mjs';
import dgram from 'node:dgram';
import { spawn } from 'node:child_process';

const port = Number(process.env.PORT || 8795);
const TV = process.env.TV_IP || '';
const TV_DUID = process.env.TV_DUID || '';
const SELF = 'SamSucks01.samsucks';
const QUIET_APPS = { '3201907018807': 'Netflix', 'LBUAQX1exg.Hulu': 'Hulu' };
// Apps checked to find what's in front (REST ids). SamSUCKS adds the rest via POST /apps.
const knownApps = new Set(['9Ur5IzDKqV.TizenYouTube', 'org.tizen.primevideo', 'MCmYXNxgcu.DisneyPlus', 'PvWgqxV3Xa.YouTubeTV', '5b8c3eb16b.BeamCTVDev', 'rJeHak5zRg.Spotify', 'Jz7aUrV2Q4.Twitch', 'GHI3a0zMSx.XboxGamePass']);
export const MEDIA_DIR = process.env.MEDIA_DIR || path.join(os.homedir(), 'Library/Application Support/SamSUCKS/media');
const SHOW_MS = { question: 9000, done: 6000, image: 10000 };
const MAX_AGE_MS = 30000;

let queue = [];
// Tasks in progress across every Claude/Codex session on this Mac (working pills from
// hooks or tv-alert, until their done/clear). Stale ones drop off after 45 minutes.
const active = new Map();
const STALE_MS = 45 * 60000;
export function track(ev, now = Date.now()) {
  if (!ev.id) return;
  if (ev.kind === 'working') active.set(ev.id, { t: now, source: ev.source === 'gpt' ? 'gpt' : 'claude', label: String(ev.step || ev.text || ev.title || ev.project || 'Working').slice(0, 80) });
  else if (ev.kind === 'done' || ev.kind === 'clear') active.delete(ev.id);
  for (const [id, a] of active) if (now - a.t > STALE_MS) active.delete(id);
}
export const activeCount = () => active.size;
// What the TV shows next to the working icon: every active task's label, per source.
export function activeTasks() {
  return [...active.entries()].map(([id, a]) => ({ id, source: a.source, label: a.label }));
}

export function activeBySource() {
  const by = { claude: 0, gpt: 0 };
  for (const a of active.values()) by[a.source]++;
  return by;
}
let screen = { name: '', at: 0 };
let music = { at: 0 }; // what the TV is playing (for the menu-bar remote)
let waiting = null;

// Prompts arrive with internal blocks (<system-reminder>…</system-reminder>, <!-- … -->)
// that must never reach the TV. Strip tagged blocks, stray tags and extra space.
export function clean(t) {
  return String(t == null ? '' : t)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<([a-z]+-[\w-]*)[^>]*>[\s\S]*?<\/\1>/gi, ' ') // internal blocks: hyphenated names
    .replace(/<\/?[a-z][\w-]*[^>]*>/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

// A short title for what a session is working on: its first request, trimmed to ~6 words
// ("can you please install X on my TV and…" → "Install X on my TV").
const FILLER_START = /^(hey|ok(ay)?|so|also|and|now|then|please|pls|can you|could you|would you|i want you to|i want to|i'd like you to|let's|lets|i need you to|help me)\b[\s,]*/i;
export function shortTitle(text) {
  let s = clean(text).replace(/https?:\/\/\S+/g, '').trim();
  for (let i = 0; i < 4; i++) s = s.replace(FILLER_START, '');
  s = s.split(/(?<=[.!?])\s|[,;:]\s|\s(?:and then|and also|but|because|so that)\s/)[0] || s;
  const words = s.split(/\s+/).filter(Boolean).slice(0, 6);
  const t = words.join(' ').replace(/[.!?,]+$/, '');
  return t ? t[0].toUpperCase() + t.slice(1) : 'Working';
}
// The session's first request, read from the start of its transcript (cached per session).
const titles = new Map();
const lastTitle = new Map(); // session → last task title, for context
function sessionTitle(p) {
  if (titles.has(p.session_id)) return titles.get(p.session_id);
  let first = '';
  try {
    const fd = openSync(p.transcript_path, 'r');
    const buf = Buffer.alloc(400000);
    const n = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    for (const line of buf.toString('utf8', 0, n).split('\n')) {
      let j; try { j = JSON.parse(line); } catch (e) { continue; }
      const c = j.type === 'user' && j.message && j.message.content;
      const txt = typeof c === 'string' ? c : Array.isArray(c) ? (c.find(x => x.type === 'text') || {}).text : '';
      if (txt && clean(txt).length > 3) { first = txt; break; }
    }
  } catch (e) {}
  const t = shortTitle(first || p.prompt);
  if (p.session_id) titles.set(p.session_id, t);
  return t;
}

// Task title from Apple's on-device model (tools/tasktitle.swift): free, local, ~1 s.
const TASKTITLE = path.join(os.homedir(), 'Library/Application Support/SamSUCKS/bin/tasktitle');
function askTitle(message, context = '') {
  return new Promise(resolve => {
    if (!existsSync(TASKTITLE)) return resolve('');
    const child = execFile(TASKTITLE, [], { timeout: 8000 }, (err, out) => resolve(err ? '' : String(out).trim().split('\n')[0].slice(0, 60)));
    child.stdin.end((context ? context + '\n' : '') + 'New message: ' + clean(message).slice(0, 1200));
  });
}

// Model answer → { type: task | correction | question, title }. Without the model, a message
// that ends in "?" or opens like a question counts as a question.
// At most 4 words, without a dangling "the"/"without"/… at the end.
export function fourWords(t) {
  const w = String(t).split(/\s+/).filter(Boolean).slice(0, 4);
  while (w.length > 1 && /^(the|a|an|to|of|for|with|without|on|in|and|or|from|into|by)$/i.test(w[w.length - 1])) w.pop();
  return w.join(' ');
}

export function classify(answer, message) {
  const a = String(answer || '').trim();
  if (/^question\b/i.test(a)) return { type: 'question' };
  const m = /^(task|correction|addition)\s*:\s*(.+)$/i.exec(a);
  if (m) {
    const title = m[2].replace(/[.!]+$/, '');
    // Corrections share the pill with a "CORRECTION" tag, so keep their titles to ~4 words.
    return { type: m[1].toLowerCase(), title: (m[1].toLowerCase() === 'task' ? title : fourWords(title)).slice(0, 60) };
  }
  const msg = clean(message);
  if (/\?\s*$/.test(msg) || /^(how|what|why|did|does|do|is|are|was|were|where|when|who|which|can you explain|explain)\b/i.test(msg)) return { type: 'question' };
  if (/^(no|nah|nope|not|don'?t|stop|wait|actually|wrong|undo|revert)\b/i.test(msg)) return { type: 'correction', title: fourWords(shortTitle(message)) };
  return { type: 'task', title: a && !/\s{2}/.test(a) && a.split(' ').length <= 8 ? a : shortTitle(message) };
}

// ---------- hook payload → pop-up ----------
export function fromHook(p, source = 'claude') {
  const project = p.cwd ? path.basename(p.cwd) : '';
  const gpt = source === 'gpt', who = gpt ? 'Codex' : 'Claude';
  const id = p.session_id ? (gpt ? 'cx-' : 'cc-') + p.session_id : undefined;
  const ev = e => ({ source, project, ...e });
  if (p.hook_event_name === 'UserPromptSubmit') {
    if (!p.prompt) return null;
    // Quick title now; askTitle() refines it a moment later with the on-device model.
    const title = shortTitle(p.prompt);
    return ev({ kind: 'working', id, title, step: title, quote: clean(p.prompt).slice(0, 160), startedAt: Date.now() });
  }
  if (p.hook_event_name === 'PreToolUse' && p.tool_name === 'AskUserQuestion') {
    const q = p.tool_input && p.tool_input.questions && p.tool_input.questions[0];
    return ev({ kind: 'question', title: who + ' has a question', text: (q && q.question) || project });
  }
  if (p.hook_event_name === 'PermissionRequest') {
    const cmd = p.tool_input && (p.tool_input.command || p.tool_input.description);
    return ev({ kind: 'question', important: true, title: who + ' needs your OK', text: String(Array.isArray(cmd) ? cmd.join(' ') : cmd || p.tool_name || project).slice(0, 140) });
  }
  if (p.hook_event_name === 'Notification') return ev({ kind: 'question', title: who + ' needs you', text: p.message || project });
  if (p.hook_event_name === 'Stop') return ev({ kind: 'done', id, title: who + ' finished', text: project });
  return null;
}

// ---------- the rules, as a pure function so they can be tested ----------
// tv: { reachable, ours, on }  front: app id in front or null  ev: the event
export function decide(tv, front, ev, passive) {
  if (!tv.reachable || !tv.ours) return { show: false, reason: 'not on the home Wi-Fi (TV not reachable)' };
  if (!tv.on) return { show: false, reason: 'TV is off' };
  if (front === SELF) return { show: true, interrupt: false };
  if (QUIET_APPS[front] && !ev.important) return { show: false, reason: QUIET_APPS[front] + ' is on; only important alerts get through' };
  // Over other apps (YouTube etc.) automatic pop-ups interrupt only for questions, approvals and
  // "finished"; the TV can't draw over another app, so SamSUCKED comes forward and then hands back.
  if (passive && ev.kind !== 'question' && ev.kind !== 'done') return { show: false, reason: 'automatic progress pills only show while SamSUCKS is on screen' };
  if (ev.kind === 'working' && !ev.important) return { show: false, reason: 'progress updates only show while SamSUCKS is on screen' };
  return { show: true, interrupt: true, returnTo: front };
}

async function tvState(retry = 1) {
  try {
    const info = await (await fetch(`http://${TV}:8001/api/v2/`, { signal: AbortSignal.timeout(2500) })).json();
    return { reachable: true, ours: info.id === TV_DUID || info.device?.duid === TV_DUID, on: info.device?.PowerState === 'on' };
  } catch (e) {
    if (retry) return tvState(retry - 1); // the TV's Wi-Fi sometimes misses one request
    return { reachable: false, ours: false, on: false };
  }
}

async function appVisible(id) {
  try {
    const a = await (await fetch(`http://${TV}:8001/api/v2/applications/${id}`, { signal: AbortSignal.timeout(2500) })).json();
    return !!a.visible;
  } catch (e) {
    return false;
  }
}

const YOUTUBE = '9Ur5IzDKqV.TizenYouTube';
async function appRunning(id) {
  try { return !!(await (await fetch(`http://${TV}:8001/api/v2/applications/${id}`, { signal: AbortSignal.timeout(2500) })).json()).running; } catch (e) { return false; }
}

async function frontApp() {
  if (await appVisible(SELF)) return SELF;
  const ids = [...Object.keys(QUIET_APPS), ...knownApps];
  const hits = await Promise.all(ids.map(async id => (await appVisible(id)) ? id : null));
  // YouTube never reports itself visible; if nothing else is in front and it's running, it's YouTube.
  // ponytail: guesses YouTube when live TV is on with YouTube in the background; pop-up then returns to YouTube.
  return hits.find(Boolean) || ((await appRunning(YOUTUBE)) ? YOUTUBE : null);
}

const launch = id => fetch(`http://${TV}:8001/api/v2/applications/${id}`, { method: 'POST', signal: AbortSignal.timeout(4000) }).catch(() => {});
const sleep = ms => new Promise(r => setTimeout(r, ms));

function deliver() {
  // YouTube mode: SamSUCKED is showing YouTube's TV site, so pop-ups go straight into that page.
  if (ytmode.isActive() && queue.length) {
    for (const { t, ...n } of queue.splice(0)) if (Date.now() - t < MAX_AGE_MS && n.kind !== 'music') ytmode.push(n).catch(e => console.error('yt push failed', e.message));
    return;
  }
  if (!waiting || !queue.length) return;
  const fresh = queue.filter(n => Date.now() - n.t < MAX_AGE_MS).map(({ t, ...n }) => n);
  queue = [];
  if (!fresh.length) return;
  const res = waiting;
  waiting = null;
  clearTimeout(res.timer);
  res.end(JSON.stringify(fresh));
}

const BANNER_KINDS = new Set(['question', 'done', 'working', 'message']);

// ---------- native overlay: our own pills drawn OVER other apps (Hulu, the YouTube app, ...) ----------
// tools/pillshot renders the pill to a transparent PNG with the TV app's own code; the TV's native
// presenter (tvoverlay/, app SmittyOv01.overlay) shows it in a non-focusable notification window.
const PILLSHOT = path.join(os.homedir(), 'Library/Application Support/SamSUCKS/bin/pillshot');
const OVERLAY_JS = path.join(os.homedir(), 'Library/Application Support/SamSUCKS/overlay.js');
const OVERLAY_KINDS = new Set(['question', 'done', 'message', 'image']);
const OVERLAY_MS = { question: 9000, done: 6500, message: 8000, image: 10000 };
let shooter = null; const shotWait = [];
function renderPill(ev, out) {
  if (!existsSync(PILLSHOT) || !existsSync(OVERLAY_JS)) return Promise.resolve(null);
  if (!shooter) {
    shooter = spawn(PILLSHOT, [OVERLAY_JS], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    shooter.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); const w = shotWait.shift(); if (w) { try { w(JSON.parse(line)); } catch (e) { w(null); } } } });
    shooter.on('exit', () => { shooter = null; while (shotWait.length) shotWait.shift()(null); });
  }
  return new Promise(res => { const t = setTimeout(() => res(null), 8000); shotWait.push(r => { clearTimeout(t); res(r && r.ok ? r : null); }); shooter.stdin.write(JSON.stringify({ ev, out }) + '\n'); });
}
const macIP = () => Object.values(os.networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal && /^192\.168\./.test(a.address))?.address;
async function overlayShow(ev) {
  const ip = macIP();
  if (!ip || !OVERLAY_KINDS.has(ev.kind)) return false;
  const id = Math.random().toString(36).slice(2, 10);
  const file = path.join(MEDIA_DIR, 'ov-' + id + '.png');
  const r = await renderPill({ ...ev, important: false }, file);
  if (!r) return false;
  const msg = JSON.stringify({ id, url: `http://${ip}:${port}/media/ov-${id}.png`, x: r.x, y: r.y, w: r.w, h: r.h, ms: (OVERLAY_MS[ev.kind] || 7000) * (ev.important ? 1.5 : 1) });
  return new Promise(resolve => {
    const sock = dgram.createSocket('udp4');
    const end = ok => { clearTimeout(t); try { sock.close(); } catch (e) {} resolve(ok); };
    const t = setTimeout(() => end(false), 3500); // presenter not running: fall back to the banner
    sock.on('message', m => { if (String(m) === 'ack ' + id) end(true); });
    sock.on('error', () => end(false));
    sock.send(msg, 18110, TV);
  });
}
// Banner text: "Claude finished" / "Fix checkout totals · sonar".
export function banner(ev, taskName = '') {
  if (ev.kind === 'message') return { title: (ev.title || 'Message').slice(0, 60), message: String(ev.text || '').slice(0, 160), timeout: 8 };
  const who = ev.source === 'gpt' ? 'Codex' : 'Claude';
  const title = ev.kind === 'question' ? (ev.title || who + ' has a question') : ev.kind === 'done' ? (ev.title || who + ' finished') : who + ': ' + (ev.title || 'working');
  const what = ev.kind === 'done' ? (taskName || ev.text || '') : (ev.text || ev.step || '');
  const message = [what, ev.project && what !== ev.project ? ev.project : ''].filter(Boolean).join(' · ');
  return { title: title.slice(0, 60), message: message.slice(0, 160), timeout: ev.kind === 'question' ? 12 : 7 };
}

async function handle(ev, passive) {
  for (const k of ['title', 'text', 'step', 'project']) if (ev[k] != null) ev[k] = clean(ev[k]);
  const before = JSON.stringify(activeTasks());
  const taskName = ev.id && active.has(ev.id) ? active.get(ev.id).label : '';
  // "Finished" says what finished (the task's name), not just the project folder.
  if (ev.kind === 'done' && taskName && (!ev.text || ev.text === ev.project)) ev = { ...ev, text: taskName };
  track(ev);
  // The TV's working icon shows this count, whether or not the pop-up itself shows.
  // Sent AFTER the pop-up, so the TV knows the pill exists and waits for it to land.
  const sendCount = () => { if (JSON.stringify(activeTasks()) !== before) { queue.push({ kind: 'count', n: active.size, by: activeBySource(), tasks: activeTasks(), t: Date.now() }); deliver(); } };
  const tv = await tvState();
  const front = tv.on ? await frontApp() : null;
  const d = decide(tv, front, ev, passive);
  if (!d.show) { sendCount(); return { shown: false, reason: d.reason }; }
  // Another app is in front: text pop-ups go out as the TV's own banner (service/notifier.js),
  // drawn over that app with no switching. Only images and wrap-ups need SamSUCKED in front.
  if (d.interrupt && OVERLAY_KINDS.has(ev.kind) && await overlayShow(ev)) { sendCount(); return { shown: true, overlay: true, front }; }
  if (d.interrupt && BANNER_KINDS.has(ev.kind)) {
    const b = banner(ev, taskName);
    const ok = await fetch(`http://${TV}:8099/notify`, { method: 'POST', body: JSON.stringify(b), signal: AbortSignal.timeout(3000) }).then(r => r.ok).catch(() => false);
    if (ok) { sendCount(); return { shown: true, banner: true, front }; }
  }
  if (d.interrupt) {
    await launch(SELF);
    await sleep(1500); // let SamSUCKS come forward and reconnect its long-poll
  }
  queue.push({ ...ev, t: Date.now() });
  sendCount();
  deliver();
  if (d.interrupt && d.returnTo && SHOW_MS[ev.kind]) {
    setTimeout(() => launch(d.returnTo), SHOW_MS[ev.kind] + 1200);
  }
  const lockscreen = !d.interrupt && screen.name === 'idle' && Date.now() - screen.at < 60000;
  return { shown: true, interrupted: !!d.interrupt, returnsTo: d.returnTo || null, front, lockscreen };
}

// ---------- YouTube mixes as background music ----------
// YouTube blocks data-center servers, so this runs on the Mac (home internet). The Mac only
// looks things up; the TV streams the audio straight from YouTube. Audio links are tied to
// the requesting address, and the Mac and TV share one home IPv4 address, hence -4.
const YTDLP = path.join(os.homedir(), 'Library/Application Support/SamSUCKS/bin/yt-dlp');
const ytCache = new Map(); // key → { at, value }
function ytdlp(args, ttlMs, key) {
  const hit = ytCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
  return new Promise((resolve, reject) => {
    // yt-dlp's own defaults: forcing a JS runtime or IPv4 gets links YouTube refuses (403).
    execFile(YTDLP, ['--no-warnings', ...args], { timeout: 45000, maxBuffer: 8e6 }, (err, out) => {
      if (err) return reject(err);
      ytCache.set(key, { at: Date.now(), value: out });
      resolve(out);
    });
  });
}
const VIDEO_ID = /^[\w-]{11}$/;
async function ytMix(seed) {
  const out = await ytdlp(['--flat-playlist', '-J', 'https://www.youtube.com/watch?v=' + seed + '&list=RD' + seed], 3600000, 'mix:' + seed);
  return (JSON.parse(out).entries || []).filter(e => VIDEO_ID.test(e.id)).map(e => ({ id: e.id, title: e.title || '', channel: e.channel || e.uploader || '' }));
}
async function ytAudio(id) {
  const out = await ytdlp(['-f', 'bestaudio[ext=m4a]/bestaudio', '-g', 'https://www.youtube.com/watch?v=' + id], 3 * 3600000, 'audio:' + id);
  return out.trim().split('\n')[0];
}

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => resolve(body));
  });
}

function serve() {
  mkdirSync(MEDIA_DIR, { recursive: true });
  createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/events') {
      if (waiting) { clearTimeout(waiting.timer); waiting.end('[]'); }
      waiting = res;
      res.timer = setTimeout(() => { if (waiting === res) { waiting = null; res.end('[]'); } }, 25000);
      deliver();
      return;
    }
    // The TV can't open YouTube's link itself (it's tied to the Mac's connection), so the Mac
    // passes the audio through, Range requests included so the TV can buffer and seek.
    if (req.method === 'GET' && url.pathname === '/yt/stream') {
      const v = url.searchParams.get('v') || '';
      if (!VIDEO_ID.test(v)) { res.statusCode = 400; res.end(); return; }
      try {
        const src = await ytAudio(v);
        const up = await fetch(src, { headers: req.headers.range ? { Range: req.headers.range } : {} });
        if (up.status === 403) ytCache.delete('audio:' + v); // expired link: fetch a fresh one next time
        res.statusCode = up.status;
        for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const x = up.headers.get(h); if (x) res.setHeader(h, x); }
        const reader = up.body.getReader();
        req.on('close', () => reader.cancel().catch(() => {}));
        for (;;) { const { value, done } = await reader.read(); if (done) break; if (!res.write(value)) await new Promise(r => res.once('drain', r)); }
        res.end();
      } catch (e) {
        if (!res.headersSent) res.statusCode = 502;
        res.end();
      }
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/yt/mix' || url.pathname === '/yt/audio')) {
      const v = url.searchParams.get('v') || '';
      res.setHeader('Content-Type', 'application/json');
      if (!VIDEO_ID.test(v)) { res.statusCode = 400; res.end('{}'); return; }
      try {
        res.end(JSON.stringify(url.pathname === '/yt/mix' ? { tracks: await ytMix(v) } : { url: await ytAudio(v) }));
      } catch (e) {
        console.error('yt failed', v, e.message.slice(0, 200));
        res.statusCode = 502;
        res.end('{}');
      }
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
      const file = path.join(MEDIA_DIR, path.basename(url.pathname));
      if (!existsSync(file)) { res.statusCode = 404; res.end(); return; }
      // Proper type + byte ranges, so the TV can start playing audio before it has all of it.
      const TYPES = { '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
      const size = statSync(file).size;
      res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'max-age=86400');
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (m) {
        const start = m[1] ? +m[1] : Math.max(0, size - +m[2]), end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
        res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`); res.setHeader('Content-Length', end - start + 1);
        createReadStream(file, { start, end }).pipe(res);
      } else { res.setHeader('Content-Length', size); createReadStream(file).pipe(res); }
      return;
    }
    // Menu-bar music remote: the TV reports what's playing; the Mac app reads it and sends commands.
    if (req.method === 'POST' && url.pathname === '/music/state') {
      try { music = { ...JSON.parse(await readBody(req)), at: Date.now() }; } catch (e) {}
      res.end('ok');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/music/state') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ...music, live: Date.now() - music.at < 45000 }));
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/ytmode/start' || url.pathname === '/ytmode/exit')) {
      res.setHeader('Content-Type', 'application/json');
      try { res.end(JSON.stringify(url.pathname.endsWith('start') ? await ytmode.start() : (await ytmode.exit(), { ok: true }))); }
      catch (e) { console.error('ytmode failed', e.message); res.statusCode = 502; res.end(JSON.stringify({ ok: false, error: e.message })); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/music/cmd') {
      try {
        const c = JSON.parse(await readBody(req));
        const ok = c.cmd === 'toggle' || (c.cmd === 'station' && /^[\w-]{1,32}$/.test(c.id)) || (c.cmd === 'mix' && /^[\w-]{11}$/.test(c.id));
        if (ok) { queue.push({ kind: 'music', cmd: c.cmd, id: c.id, live: !!c.live, name: String(c.name || '').slice(0, 60), t: Date.now() }); deliver(); }
      } catch (e) {}
      res.end('ok');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/state') {
      try { screen = { name: String(JSON.parse(await readBody(req)).screen || '').slice(0, 30), at: Date.now() }; } catch (e) {}
      res.end('ok');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/apps') {
      try { for (const id of JSON.parse(await readBody(req))) if (/^[\w.-]{3,80}$/.test(id)) knownApps.add(id); } catch (e) {}
      res.end('ok');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/notify') {
      let out = { shown: false, reason: 'bad payload' };
      try {
        const p = JSON.parse(await readBody(req));
        if (p.alert) { const { alert, ...ev } = p; out = await handle(ev, false); }
        else {
          let ev = p.kind ? p : fromHook(p, url.searchParams.get('source') === 'gpt' ? 'gpt' : 'claude');
          // A new message only becomes a working task if it actually asks for work.
          if (ev && p.hook_event_name === 'UserPromptSubmit') {
            const prev = lastTitle.get(p.session_id) || '';
            const ctx = 'Project: ' + (ev.project || '') + '\nSession goal: ' + sessionTitle(p) + (prev ? '\nPrevious task: ' + prev : '');
            const withKind = (e, k) => ({ ...e, title: k.title, step: k.title, variant: k.type === 'correction' || k.type === 'addition' ? k.type : undefined });
            const quick = classify('', p.prompt); // instant guess from the wording
            const model = askTitle(p.prompt, ctx).then(a => classify(a, p.prompt));
            if (quick.type !== 'question') {
              // Show the working pill right away with the quick title; the on-device model's
              // title (or its "that was just a question") follows a moment later, same pill id.
              const base = ev;
              out = await handle(withKind(base, quick), true);
              model.then(async k => {
                if (k.type === 'question') return handle({ kind: 'clear', id: base.id, source: base.source }, true);
                lastTitle.set(p.session_id, k.title);
                if (k.title !== quick.title || k.type !== quick.type) await handle(withKind(base, k), true);
              }).catch(() => {});
              ev = null;
            } else {
              const k = await model;
              if (k.type === 'question') ev = null;
              else { lastTitle.set(p.session_id, k.title); ev = withKind(ev, k); }
            }
          }
          // "Finished" only for a session that had a task running (not after answering a question).
          if (ev && p.hook_event_name === 'Stop' && !active.has(ev.id)) ev = null;
          if (ev) out = await handle(ev, true);
          // Then swap in the model's task title (same id = the pill updates in place).
        }
      } catch (e) {
        console.error('notify failed', e.message);
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(out));
      return;
    }
    res.statusCode = 404;
    res.end();
  }).listen(port, '0.0.0.0', () => console.log(`tv alert relay on :${port}`));
}

if (process.argv.includes('--test')) {
  const assert = (await import('node:assert')).strict;
  const home = { reachable: true, ours: true, on: true };
  assert.equal(fromHook({ hook_event_name: 'Stop', cwd: '/x/samsucks' }).text, 'samsucks');
  assert.equal(fromHook({ hook_event_name: 'Stop', session_id: 's', cwd: '/x/p' }, 'gpt').title, 'Codex finished');
  assert.equal(fromHook({ hook_event_name: 'Stop', session_id: 's' }, 'gpt').source, 'gpt');
  assert.equal(fromHook({ hook_event_name: 'PermissionRequest', tool_input: { command: ['npm', 'test'] } }, 'gpt').text, 'npm test');
  assert.equal(fromHook({ hook_event_name: 'UserPromptSubmit' }, 'gpt'), null);
  assert.deepEqual(banner({ kind: 'done', source: 'gpt', title: 'Codex finished', text: 'sonar', project: 'sonar' }, 'Fix checkout totals'), { title: 'Codex finished', message: 'Fix checkout totals · sonar', timeout: 7 });
  assert.equal(banner({ kind: 'question', title: 'Claude needs your OK', text: 'npm test' }).timeout, 12);
  assert.equal(fromHook({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Ship it?' }] } }).text, 'Ship it?');
  assert.equal(decide({ reachable: false }, null, { kind: 'done' }, false).show, false);                 // away from home
  assert.equal(decide({ ...home, on: false }, null, { kind: 'done' }, false).reason, 'TV is off');
  assert.deepEqual(decide(home, SELF, { kind: 'done' }, true), { show: true, interrupt: false });         // hook, SamSUCKS in front
  assert.deepEqual(decide(home, '9Ur5IzDKqV.TizenYouTube', { kind: 'done' }, true), { show: true, interrupt: true, returnTo: '9Ur5IzDKqV.TizenYouTube' }); // hook: done over YouTube
  assert.equal(decide(home, '9Ur5IzDKqV.TizenYouTube', { kind: 'working' }, true).show, false);        // hook: no working pills over YouTube
  assert.equal(decide(home, '3201907018807', { kind: 'done' }, true).show, false);                     // hook: not over Netflix
  assert.equal(decide(home, '3201907018807', { kind: 'done' }, false).show, false);                    // Netflix: not important
  assert.equal(decide(home, 'LBUAQX1exg.Hulu', { kind: 'question', important: true }, false).show, true); // Hulu: important
  assert.deepEqual(decide(home, '9Ur5IzDKqV.TizenYouTube', { kind: 'done' }, false),
    { show: true, interrupt: true, returnTo: '9Ur5IzDKqV.TizenYouTube' });                              // other app: interrupt + return
  assert.equal(decide(home, null, { kind: 'working' }, false).show, false);                            // progress never interrupts
  assert.equal(clean('<system-reminder>secret stuff</system-reminder>\nfix the <b>bug</b> <!-- reply 1 -->now'), 'fix the bug now');
  assert.equal(fromHook({ hook_event_name: 'UserPromptSubmit', prompt: '<system-reminder>x</system-reminder> make it pretty' }).step, 'Make it pretty');
  assert.equal(shortTitle('can you please install SamSucks on my samsung tv its a trending github repo'), 'Install SamSucks on my samsung tv');
  assert.equal(shortTitle('ok so fix the login bug, then deploy'), 'Fix the login bug');
  track({ kind: 'working', id: 'a' }, 0); track({ kind: 'working', id: 'b' }, 0); track({ kind: 'done', id: 'a' }, 0);
  assert.equal(activeCount(), 1);
  track({ kind: 'working', id: 'g', source: 'gpt' }, 0); assert.deepEqual(activeBySource(), { claude: 1, gpt: 1 }); track({ kind: 'clear', id: 'g' }, 0);
  track({ kind: 'working', id: 'c' }, STALE_MS + 1); assert.equal(activeCount(), 1); // b went stale
  assert.equal(classify('QUESTION', 'x').type, 'question');
  assert.deepEqual(classify('TASK: Fix single bullets.', 'x'), { type: 'task', title: 'Fix single bullets' });
  assert.deepEqual(classify('CORRECTION: Play YouTube without the Mac app', 'x'), { type: 'correction', title: 'Play YouTube' });
  assert.equal(classify('', 'how did you get mac miller playing').type, 'question');
  assert.equal(classify('', 'not through the mac').type, 'correction');
  assert.equal(classify('ADDITION: Add gaming news', 'x').type, 'addition');
  assert.equal(classify('', 'add politics news').type, 'task');
  console.log('relay rules ok');
} else {
  serve();
}

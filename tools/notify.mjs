// TV alert relay on the Mac: Claude Code / Codex  →  SamSUCKS pop-ups on the TV.
//   POST /notify   a Claude Code hook payload (passive) or a tv-alert event ({alert: true, ...})
//   GET  /events   SamSUCKS long-polls this for pop-ups
//   GET  /media/*  images/audio that tv-alert copied into MEDIA_DIR
// The rules (from the owner):
//   - only when this Mac can see *our* TV (so: on the home Wi-Fi) and the TV is on
//   - agents may alert whenever they see fit, except while Netflix or Hulu is in front:
//     then only `important` alerts get through
//   - automatic hook pop-ups never interrupt: they show only if SamSUCKS is already in front
// To show over another app, the relay brings SamSUCKS forward and afterwards reopens that app.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
  if (ev.kind === 'working') active.set(ev.id, now);
  else if (ev.kind === 'done' || ev.kind === 'clear') active.delete(ev.id);
  for (const [id, t] of active) if (now - t > STALE_MS) active.delete(id);
}
export const activeCount = () => active.size;
let screen = { name: '', at: 0 };
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

// ---------- hook payload → pop-up ----------
export function fromHook(p) {
  const project = p.cwd ? path.basename(p.cwd) : '';
  const id = p.session_id ? 'cc-' + p.session_id : undefined;
  if (p.hook_event_name === 'UserPromptSubmit') {
    const step = clean(p.prompt).slice(0, 90);
    return { kind: 'working', id, title: 'Claude is working', step, project, startedAt: Date.now() };
  }
  if (p.hook_event_name === 'PreToolUse' && p.tool_name === 'AskUserQuestion') {
    const q = p.tool_input && p.tool_input.questions && p.tool_input.questions[0];
    return { kind: 'question', title: 'Claude has a question', text: (q && q.question) || project, project };
  }
  if (p.hook_event_name === 'Notification') return { kind: 'question', title: 'Claude needs you', text: p.message || project, project };
  if (p.hook_event_name === 'Stop') return { kind: 'done', id, title: 'Claude finished', text: project, project };
  return null;
}

// ---------- the rules, as a pure function so they can be tested ----------
// tv: { reachable, ours, on }  front: app id in front or null  ev: the event
export function decide(tv, front, ev, passive) {
  if (!tv.reachable || !tv.ours) return { show: false, reason: 'not on the home Wi-Fi (TV not reachable)' };
  if (!tv.on) return { show: false, reason: 'TV is off' };
  if (front === SELF) return { show: true, interrupt: false };
  if (passive) return { show: false, reason: 'SamSUCKS is not on screen (automatic pop-ups never interrupt)' };
  if (QUIET_APPS[front] && !ev.important) return { show: false, reason: QUIET_APPS[front] + ' is on; only important alerts get through' };
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

async function frontApp() {
  if (await appVisible(SELF)) return SELF;
  const ids = [...Object.keys(QUIET_APPS), ...knownApps];
  const hits = await Promise.all(ids.map(async id => (await appVisible(id)) ? id : null));
  return hits.find(Boolean) || null;
}

const launch = id => fetch(`http://${TV}:8001/api/v2/applications/${id}`, { method: 'POST', signal: AbortSignal.timeout(4000) }).catch(() => {});
const sleep = ms => new Promise(r => setTimeout(r, ms));

function deliver() {
  if (!waiting || !queue.length) return;
  const fresh = queue.filter(n => Date.now() - n.t < MAX_AGE_MS).map(({ t, ...n }) => n);
  queue = [];
  if (!fresh.length) return;
  const res = waiting;
  waiting = null;
  clearTimeout(res.timer);
  res.end(JSON.stringify(fresh));
}

async function handle(ev, passive) {
  for (const k of ['title', 'text', 'step', 'project']) if (ev[k] != null) ev[k] = clean(ev[k]);
  const before = active.size;
  track(ev);
  // The TV's working icon shows this number, whether or not the pop-up itself shows.
  if (active.size !== before) { queue.push({ kind: 'count', n: active.size, t: Date.now() }); deliver(); }
  const tv = await tvState();
  const front = tv.on ? await frontApp() : null;
  const d = decide(tv, front, ev, passive);
  if (!d.show) return { shown: false, reason: d.reason };
  if (d.interrupt) {
    await launch(SELF);
    await sleep(1500); // let SamSUCKS come forward and reconnect its long-poll
  }
  queue.push({ ...ev, t: Date.now() });
  deliver();
  if (d.interrupt && d.returnTo && SHOW_MS[ev.kind]) {
    setTimeout(() => launch(d.returnTo), SHOW_MS[ev.kind] + 1200);
  }
  const lockscreen = !d.interrupt && screen.name === 'idle' && Date.now() - screen.at < 60000;
  return { shown: true, interrupted: !!d.interrupt, returnsTo: d.returnTo || null, front, lockscreen };
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
    if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
      const file = path.join(MEDIA_DIR, path.basename(url.pathname));
      if (!existsSync(file)) { res.statusCode = 404; res.end(); return; }
      createReadStream(file).pipe(res);
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
        else { const ev = p.kind ? p : fromHook(p); if (ev) out = await handle(ev, true); }
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
  assert.equal(fromHook({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Ship it?' }] } }).text, 'Ship it?');
  assert.equal(decide({ reachable: false }, null, { kind: 'done' }, false).show, false);                 // away from home
  assert.equal(decide({ ...home, on: false }, null, { kind: 'done' }, false).reason, 'TV is off');
  assert.deepEqual(decide(home, SELF, { kind: 'done' }, true), { show: true, interrupt: false });         // hook, SamSUCKS in front
  assert.equal(decide(home, '9Ur5IzDKqV.TizenYouTube', { kind: 'done' }, true).show, false);            // hook never interrupts
  assert.equal(decide(home, '3201907018807', { kind: 'done' }, false).show, false);                    // Netflix: not important
  assert.equal(decide(home, 'LBUAQX1exg.Hulu', { kind: 'question', important: true }, false).show, true); // Hulu: important
  assert.deepEqual(decide(home, '9Ur5IzDKqV.TizenYouTube', { kind: 'done' }, false),
    { show: true, interrupt: true, returnTo: '9Ur5IzDKqV.TizenYouTube' });                              // other app: interrupt + return
  assert.equal(decide(home, null, { kind: 'working' }, false).show, false);                            // progress never interrupts
  assert.equal(clean('<system-reminder>secret stuff</system-reminder>\nfix the <b>bug</b> <!-- reply 1 -->now'), 'fix the bug now');
  assert.equal(fromHook({ hook_event_name: 'UserPromptSubmit', prompt: '<system-reminder>x</system-reminder> make it pretty' }).step, 'make it pretty');
  track({ kind: 'working', id: 'a' }, 0); track({ kind: 'working', id: 'b' }, 0); track({ kind: 'done', id: 'a' }, 0);
  assert.equal(activeCount(), 1);
  track({ kind: 'working', id: 'c' }, STALE_MS + 1); assert.equal(activeCount(), 1); // b went stale
  console.log('relay rules ok');
} else {
  serve();
}

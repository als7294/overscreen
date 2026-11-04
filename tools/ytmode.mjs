// YouTube mode: SamSUCKED shows YouTube's own TV site (youtube.com/tv, signed in = Premium) with
// the TV app's real pop-ups injected on top. Uses Developer Mode's debug launch (the same trick
// as TizenBrew): `sdb shell 0 debug <app>` gives a Chrome DevTools port; through it we load the
// site, inject tools/overlay/dist/overlay.js, and push each pop-up event straight into the page.
import { execFile, spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SDB = process.env.SDB || path.join(os.homedir(), 'tizen-studio/tools/sdb');
const TV = process.env.TV_IP || '';
const TARGET = TV + ':26101';
const APP = 'SamSucks01.samsucks';
const LOCAL_PORT = 9339;
const OVERLAY = [path.join(here, 'overlay/dist/overlay.js'), path.join(here, 'overlay.js')].find(existsSync);
const YT_URL = 'https://www.youtube.com/tv';
// The exit hook: YouTube's "exit" calls window.close(); we take the user back to SamSUCKED instead.
const HOOK = `window.close=function(){console.log('ss:exit')};`;

let cdp = null;      // { ws, send }
let active = false;  // YouTube page currently showing
let starting = null;

const run = (args, ms = 15000) => new Promise(res => execFile(SDB, ['-s', TARGET, ...args], { timeout: ms }, (e, out, err) => res(String(out || '') + String(err || ''))));

// Launch SamSUCKED in debug mode and return its DevTools port.
function debugLaunch() {
  return new Promise((resolve, reject) => {
    const p = spawn(SDB, ['-s', TARGET, 'shell', '0 debug ' + APP]);
    let buf = '';
    const done = v => { clearTimeout(t); p.kill(); v instanceof Error ? reject(v) : resolve(v); };
    const t = setTimeout(() => done(new Error('no debug port')), 25000);
    p.stdout.on('data', d => { buf += d; const m = buf.match(/port:\s*(\d+)/); if (m) done(Number(m[1])); });
  });
}

async function setup() {
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.setBypassCSP', { enabled: true }); // YouTube's Trusted Types would block the pills' markup
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK + readFileSync(OVERLAY, 'utf8') });
}

async function connect(tries = 20) {
  for (let i = 0; i < tries; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${LOCAL_PORT}/json`)).json();
      const pg = pages.find(p => p.type === 'page');
      if (pg) return open(pg.webSocketDebuggerUrl);
    } catch (e) {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('DevTools page not found');
}

function open(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0; const wait = new Map();
    const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && wait.has(m.id)) { wait.get(m.id)(m.result || m.error); wait.delete(m.id); return; }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.args.some(a => a.value === 'ss:exit')) exit();
      if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) active = m.params.frame.url.startsWith('https://www.youtube.com');
    };
    ws.onopen = () => resolve({ ws, send });
    ws.onclose = () => { cdp = null; active = false; };
    ws.onerror = () => reject(new Error('DevTools connection failed'));
  });
}

// Debug session (reused while it lasts), then load YouTube with the pills injected.
export async function start() {
  if (starting) return starting;
  starting = (async () => {
    if (!OVERLAY) throw new Error('overlay not built (node tools/overlay/build.mjs)');
    // A relay restart keeps the TV's debug session: reattach to it instead of relaunching.
    if (!cdp) { try { cdp = await connect(3); await setup(); } catch (e) { cdp = null; } }
    if (!cdp) {
      await run(['shell', '0 kill SamSucks01']);
      const port = await debugLaunch();
      await run(['forward', '--remove', 'tcp:' + LOCAL_PORT]);
      await run(['forward', 'tcp:' + LOCAL_PORT, 'tcp:' + port]);
      cdp = await connect();
      await setup();
    }
    // Already on YouTube (reattached): stay put rather than reloading the page.
    const here = (await cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })).result.value || '';
    if (here.startsWith('https://www.youtube.com')) { active = true; if (!(await cdp.send('Runtime.evaluate', { expression: '!!window.ssPills', returnByValue: true })).result.value) await cdp.send('Runtime.evaluate', { expression: HOOK + readFileSync(OVERLAY, 'utf8') }); return { ok: true }; }
    await cdp.send('Page.navigate', { url: YT_URL });
    active = true;
    return { ok: true };
  })().catch(e => {
    // Couldn't set it up: open the regular YouTube app instead of leaving the screen empty.
    fetch(`http://${TV}:8001/api/v2/applications/9Ur5IzDKqV.TizenYouTube`, { method: 'POST' }).catch(() => {});
    throw e;
  }).finally(() => { starting = null; });
  return starting;
}

// Back to SamSUCKED's own screens (the debug session stays, so the next YouTube is instant).
export async function exit() {
  active = false;
  if (cdp) await cdp.send('Page.navigate', { url: 'file:///index.html' });
}

export const isActive = () => active && !!cdp;

// One pop-up event into the YouTube page. Mac-local images become data URLs (the page is https).
export async function push(ev) {
  if (!isActive()) return false;
  const inline = async v => {
    if (typeof v === 'string' && /^http:\/\//.test(v)) {
      try { const r = await fetch(v); const b = Buffer.from(await r.arrayBuffer()); if (b.length < 8e6) return 'data:' + (r.headers.get('content-type') || 'image/jpeg') + ';base64,' + b.toString('base64'); } catch (e) {}
      return v;
    }
    if (Array.isArray(v)) return Promise.all(v.map(inline));
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = await inline(v[k]); return o; }
    return v;
  };
  const e = await inline(ev);
  // A spoken wrap-up pauses the video and resumes it once the talk closes; everything else
  // draws over the playing video without touching it.
  const talk = e.kind === 'wrapup' && e.wrapup && e.wrapup.mode === 'talk';
  const pause = talk ? `(()=>{const v=document.querySelector('video');if(!v||v.paused)return;v.pause();
    const t=setInterval(()=>{if(!document.querySelector('.pp-talk')){clearInterval(t);v.play().catch(()=>{});}},500);
    })(),` : '';
  const r = await cdp.send('Runtime.evaluate', { expression: `window.ssPills ? (${pause}ssPills.show(${JSON.stringify(e)}), 'ok') : 'missing'` });
  return r && r.result && r.result.value === 'ok';
}

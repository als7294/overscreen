// Phone remote, no Mac needed: the phone page lives on the VPS relay
// (tools/remote-relay.py). SamSUCKS long-polls the relay with a secret that only
// the QR code carries, and replays each button on the TV's own remote API
// (ws://127.0.0.1:8001), so keys reach whatever app is on screen. Runs in the
// background too (background-support is on in config.xml).
import { REMOTE_HOST } from '../config.js';
import { warn } from '../util/log.js';
import * as store from '../util/store.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function secret() {
  let s = store.get('remoteSecret');
  if (!s) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    s = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    store.set('remoteSecret', s);
  }
  return s;
}

// Short code for typing the remote's address on a laptop (no ambiguous letters).
export function shortCode() {
  let c = store.get('remoteCode');
  if (!c || c.length !== 5) {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(5);
    crypto.getRandomValues(bytes);
    c = [...bytes].map(b => abc[b % abc.length]).join('');
    store.set('remoteCode', c);
  }
  return c;
}
export function laptopUrl() { return REMOTE_HOST ? REMOTE_HOST + '/' + shortCode() : ''; }
function registerCode() {
  fetch('http://' + REMOTE_HOST + '/code/' + secret(), { method: 'POST', body: shortCode() }).catch(() => {});
}

export function remoteUrl() {
  return REMOTE_HOST ? 'http://' + REMOTE_HOST + '/r#' + secret() : '';
}

let ws = null;
let wsReady = null;

function tvSocket() {
  if (ws && ws.readyState === 1) return Promise.resolve(ws);
  if (wsReady) return wsReady;
  wsReady = new Promise((resolve, reject) => {
    const token = store.get('tvRemoteToken');
    const url = 'ws://127.0.0.1:8001/api/v2/channels/samsung.remote.control?name=' + btoa('SamSUCKS Remote') + (token ? '&token=' + token : '');
    const sock = new WebSocket(url);
    sock.onmessage = e => {
      let msg = {};
      try { msg = JSON.parse(e.data); } catch (err) {}
      if (msg.event === 'ms.channel.connect') {
        if (msg.data && msg.data.token) store.set('tvRemoteToken', msg.data.token);
        ws = sock;
        wsReady = null;
        resolve(sock);
      } else if (msg.event === 'ms.channel.unauthorized' || msg.event === 'ms.channel.timeOut') {
        wsReady = null;
        reject(new Error(msg.event + ' (allow SamSUCKS Remote on the TV)'));
      }
    };
    sock.onerror = () => { wsReady = null; reject(new Error('tv remote socket error')); };
    sock.onclose = () => { if (ws === sock) ws = null; };
  });
  return wsReady;
}

async function press(key) {
  if (key.startsWith('APP:')) {
    try { tizen.application.launch(key.slice(4), null, e => warn('launch failed', e.message)); } catch (e) {}
    return;
  }
  const sock = await tvSocket();
  // Power off from the phone: play the fold-to-a-point animation first (design 1e).
  if (key === 'KEY_POWER' && !document.hidden) await import('./system.js').then(m => m.playPowerOff()).catch(() => {});
  sock.send(JSON.stringify({ method: 'ms.remote.control', params: {
    Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' } }));
}

export async function startRemote() {
  if (!REMOTE_HOST) return;
  registerCode();
  setInterval(registerCode, 5 * 60000); // the relay forgets codes when it restarts
  const url = 'http://' + REMOTE_HOST + '/tv/' + secret();
  for (;;) {
    try {
      const keys = await (await fetch(url)).json();
      for (const k of keys) await press(k).catch(e => warn('remote key failed', k, e.message));
    } catch (e) {
      await sleep(5000); // relay unreachable: keep retrying quietly
    }
  }
}

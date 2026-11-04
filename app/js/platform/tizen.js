// Thin wrapper over the Tizen / Samsung web APIs, with desktop-browser fallbacks
// so the UI can also be developed in Chrome.
import { warn } from '../util/log.js';
import { NOTIFY_HOST } from '../config.js';

export const isTizen = typeof window.tizen !== 'undefined';

// keyCode → action. Desktop keys mirror the remote for development in a browser.
const KEYMAP = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter',
  10009: 'back', 8: 'back', 27: 'back',
  10252: 'playpause', 32: 'playpause', 415: 'play', 19: 'pause', 413: 'stop',
  417: 'ff', 412: 'rw', 427: 'pageup', 428: 'pagedown', 33: 'pageup', 34: 'pagedown',
  403: 'red', 404: 'green', 405: 'yellow', 406: 'blue', 457: 'info', 10073: 'info',
};

export function actionFor(e) {
  return KEYMAP[e.keyCode] || null;
}

export function registerKeys() {
  if (!isTizen) return;
  const keys = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward',
    'MediaRewind', 'ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow',
    'ColorF3Blue', 'Info'];
  for (const k of keys) {
    try { tizen.tvinputdevice.registerKey(k); } catch (e) { warn('registerKey failed', k); }
  }
}

export function exitApp() {
  try { tizen.application.getCurrentApplication().exit(); } catch (e) { window.close(); }
}

// Apps for the apps row. The TV reports ~150 "visible" apps, mostly system services,
// so keep store apps (10-character package prefix) plus a few built-in favourites.
const BUILT_IN = ['org.tizen.netflix-app', 'org.tizen.primevideo', 'com.samsung.tv.aria-video', 'org.tizen.browser'];
// ponytail: hand-kept list of Samsung's own store-style packages; add to it if junk shows up
const NOT_APPS = ['2025ePop02', 'AaTvHome01', '25emanual1', 'yL49PNFmjW', 'WSRedi0001', 'HupEmjIB4I', '9TYrsHWbaB', 'SamSucks01'];

export function isUserApp(id) {
  if (BUILT_IN.includes(id)) return true;
  const m = /^([A-Za-z0-9]{10})\./.exec(id);
  return !!m && !NOT_APPS.includes(m[1]);
}

// Popular apps lead the row; everything else follows alphabetically.
const FIRST = ['YouTube', 'Netflix', 'Prime Video', 'Disney+', 'HBO Max', 'Hulu', 'Apple TV', 'Peacock TV', 'Spotify', 'Twitch'];
const rank = name => { const i = FIRST.indexOf(name); return i < 0 ? FIRST.length : i; };

export function listApps() {
  if (!isTizen) {
    // Desktop preview only.
    return Promise.resolve(['YouTube', 'Netflix', 'Prime Video', 'Disney+', 'Spotify'].map(name => ({ id: name, name, icon: '' })));
  }
  return new Promise(resolve => {
    let self = '';
    try { self = tizen.application.getCurrentApplication().appInfo.id; } catch (e) {}
    tizen.application.getAppsInfo(apps => {
      resolve(apps.filter(a => a.show && a.iconPath && a.id !== self && isUserApp(a.id))
        .map(a => ({ id: a.id, name: a.name.split(' - ')[0], icon: a.iconPath }))
        .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)));
    }, e => { warn('getAppsInfo failed', e.message); resolve([]); });
  });
}

const YOUTUBE = '9Ur5IzDKqV.TizenYouTube';
export function launchApp(id) {
  if (!isTizen) return;
  const real = () => tizen.application.launch(id, null, e => warn('launch failed', id, e.message));
  // YouTube opens inside SamSUCKED when the Mac is around (so Claude/Codex pop-ups show on top);
  // otherwise the regular YouTube app.
  if (id === YOUTUBE && NOTIFY_HOST) {
    fetch('http://' + NOTIFY_HOST + '/music/state', { signal: AbortSignal.timeout(1500) })
      .then(r => { if (!r.ok) throw new Error('relay ' + r.status); fetch('http://' + NOTIFY_HOST + '/ytmode/start', { method: 'POST' }).catch(() => {}); })
      .catch(real);
    return;
  }
  real();
}

export function deviceInfo() {
  let model = 'Browser';
  let name = 'SamSUCKS';
  try { model = webapis.productinfo.getRealModel() || webapis.productinfo.getModel(); } catch (e) {}
  try { name = 'Samsung ' + (webapis.productinfo.getModel() || 'TV'); } catch (e) {}
  // PMS has a built-in "Tizen" profile (the official app) that rejects our
  // transcode requests with 400; "Samsung" gets the generic profile plus our
  // own X-Plex-Client-Profile-Extra.
  return { model, name, platform: isTizen ? 'Samsung' : 'Web' };
}

export function supports4K() {
  try { return webapis.productinfo.isUdPanelSupported(); } catch (e) { return false; }
}

// Keep the screen saver from kicking in during playback.
export function setScreenSaver(on) {
  try {
    webapis.appcommon.setScreenSaver(on ? webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON
      : webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF);
  } catch (e) {}
}

// Boot: play the boot animation, then open on the idle screen (radio, clock, news).
// Any key there opens the Google TV-style home. The app never asks to sign in to Plex.
import { DEV, DEV_HOST, DEV_PLEX_URL, VERSION, NOTIFY_HOST } from './config.js';
import * as router from './router.js';
import { isTizen, registerKeys, listApps } from './platform/tizen.js';
import { session, reconnect, signOut } from './session.js';
import { HomeScreen } from './screens/home.js';
import { IdleScreen } from './screens/idle.js';
import { LauncherScreen } from './screens/launcher.js';
import * as radio from './ui/radio.js';
import { startRemote } from './ui/remote.js';
import { startPills } from './ui/pill.js';
import { playBootChime } from './ui/chime.js';
import { initHud } from './ui/hud.js';
import { log, warn } from './util/log.js';
import * as nav from './nav.js';
import * as store from './util/store.js';

const BOOT_MS = 3400;

function lofi() {
  return IdleScreen({ onOpen: () => router.push(LauncherScreen({ onPlex: session.token && session.server ? openPlex : null, onGames: openGames })) });
}

// Games hub (design 7a/7b) lives in its own screen; the other agent's module may not exist yet.
function openGames() {
  import('./screens/games.js').then(m => router.push(m.GamesScreen())).catch(e => warn('games screen missing', e.message));
}

function goHome() {
  router.reset(lofi());
  router.push(HomeScreen());
}

// No sign-in screen: a dead Plex session just lands back on lofi.
function goLogin() {
  router.reset(lofi());
}

function openPlex() {
  if (session.token && session.server) {
    goHome();
    verify();
  } else {
    goLogin();
  }
}

async function verify() {
  // Home already painted from cache; make sure the saved connection still works.
  try {
    await session.server.get('/identity');
  } catch (e) {
    if (e.status === 401) { signOut(); goLogin(); return; }
    warn('saved server unreachable, re-resolving', e.message);
    try {
      await reconnect();
      goHome();
    } catch (err) {
      if (err.status === 401) { signOut(); goLogin(); }
    }
  }
}

// The UI is laid out for the TV's fixed 1920×1080 viewport. In a desktop
// browser, zoom it to fit the window and center it. zoom (not a transform)
// re-renders text and images at the window's real resolution.
function fitWindow() {
  const root = document.documentElement;
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  root.style.position = 'relative'; // so the margins below move #app too
  root.style.zoom = s;
  root.style.marginLeft = Math.max(0, (innerWidth - 1920 * s) / 2 / s) + 'px';
  root.style.marginTop = Math.max(0, (innerHeight - 1080 * s) / 2 / s) + 'px';
}

function start() {
  // A release build installed over a dev build must not inherit its LAN shortcut.
  if (!DEV && session.token === 'lan-dev') {
    signOut();
    store.set('hud', undefined);
  }
  if (DEV && DEV_PLEX_URL && !session.token) {
    // Dev shortcut for servers that allow unauthenticated LAN access.
    store.set('token', 'lan-dev');
    store.set('user', { title: 'LAN (dev)' });
    store.set('server', { uri: DEV_PLEX_URL, token: '', name: 'Plex (LAN dev)', id: 'lan-dev' });
    location.reload();
    return;
  }
  router.reset(lofi());
}

export function boot() {
  if (DEV) window.__ss = { router, session, nav };
  log('boot', VERSION, navigator.userAgent);
  registerKeys();
  if (!isTizen) {
    fitWindow();
    window.addEventListener('resize', fitWindow);
  }
  router.init(document.getElementById('app'));
  initHud(() => (router.top() && router.top().name) || '');
  window.addEventListener('samsucks:restart', start);
  // Dev builds only; release builds don't ship js/dev/.
  if (DEV && DEV_HOST) import('./dev/remote.js').then(m => m.startDevRemote());
  startPills();
  startRemote();
  // Volume / mute overlays (designs 1j, 1k).
  import('./ui/system.js').then(m => m.startSystemOverlays()).catch(e => warn('system overlays missing', e.message));
  // Tell the Mac alert relay which SamSUCKS screen is up (lockscreen = alerts welcome).
  let lastScreen = '';
  if (NOTIFY_HOST) setInterval(() => {
    const name = (router.top() && router.top().name) || '';
    if (name === lastScreen && Date.now() % 30000 > 3000) return; // on change, plus a refresh every ~30 s
    lastScreen = name;
    fetch('http://' + NOTIFY_HOST + '/state', { method: 'POST', body: JSON.stringify({ screen: name }) }).catch(() => {});
  }, 3000);
  // Tell the Mac alert relay which apps exist, so it can tell what's on screen.
  if (NOTIFY_HOST) listApps().then(apps => fetch('http://' + NOTIFY_HOST + '/apps', { method: 'POST', body: JSON.stringify(apps.map(a => a.id)) })).catch(() => {});
  playBootChime();
  start();
  // The music starts once the boot animation is over.
  setTimeout(radio.play, BOOT_MS);
  const splash = document.getElementById('splash');
  setTimeout(() => {
    splash.classList.add('gone');
    setTimeout(() => splash.parentNode && splash.parentNode.removeChild(splash), 500);
  }, BOOT_MS);
}

// Account, server and diagnostics.
import { DEV, VERSION } from '../config.js';
import { h, toggleClass } from '../util/dom.js';
import { session, signOut, useServer } from '../session.js';
import { getServers, connect } from '../plex/auth.js';
import { setHud, hudEnabled } from '../ui/hud.js';
import * as router from '../router.js';
import { ServerPicker } from './login.js';
import { error } from '../util/log.js';
import { startMode, setStartMode } from '../ui/radio.js';
import { pref, setPref } from '../util/prefs.js';
import { resetNews } from '../ui/news.js';
import { useAmbience, setLegacyGradients, legacyGradients } from '../ui/backdrop.js';

const BGS = { bubble: 'Stars + blue nebula', n11: 'Stars + rose nebula', pillars: 'Stars + teal nebula', carina: 'Stars + amber nebula', stars: 'Just stars' };

export function SettingsScreen() {
  const el = h('div', 'screen settings');
  const ambience = useAmbience();
  h('h1', 'settings-title', el).textContent = 'Settings';
  const list = h('div', 'settings-list', el);
  const foot = h('div', 'settings-foot', el);
  foot.textContent = 'SmittyBox ' + VERSION + (DEV ? ' (dev)' : '') + ' · ' + (session.server ? session.server.uri.replace(/X-Plex-Token=.*/, '') : '');

  let index = 0;
  let items = [];

  function build() {
    list.innerHTML = '';
    items = [
      { label: 'Start-up music', value: startMode() === 'random' ? 'A different station each time' : 'Same as last time',
        run: () => { setStartMode(startMode() === 'random' ? 'last' : 'random'); build(); } },
      ...[['tech', 'Tech'], ['offbeat', 'Offbeat'], ['culture', 'Culture'], ['politics', 'Politics'], ['world', 'World'], ['business', 'Business'], ['science', 'Science'], ['ai', 'AI'], ['games', 'Gaming'], ['edm', 'Bass & EDM']].map(([k, name]) => (
        { label: 'News: ' + name, value: pref('news.' + k) ? 'On' : 'Off', run: () => { setPref('news.' + k, !pref('news.' + k)); resetNews(); build(); } })),
      { label: 'Lockscreen background', value: BGS[pref('bgLoop')] || BGS.bubble,
        run: () => { const o = Object.keys(BGS); setPref('bgLoop', o[(o.indexOf(pref('bgLoop')) + 1) % o.length]); build(); } },
      { label: 'Story pace', value: { relaxed: 'Relaxed', normal: 'Normal', quick: 'Quick' }[pref('storyPace')],
        run: () => { const o = ['relaxed', 'normal', 'quick']; setPref('storyPace', o[(o.indexOf(pref('storyPace')) + 1) % 3]); build(); } },
      { label: 'Alert sounds', value: pref('sounds') ? 'On' : 'Off', run: () => { setPref('sounds', !pref('sounds')); build(); } },
      { label: 'Clock', value: pref('clock24') ? '24-hour' : '12-hour', run: () => { setPref('clock24', !pref('clock24')); build(); } },
      { label: 'Temperature', value: pref('tempUnit') === 'C' ? '°C' : '°F', run: () => { setPref('tempUnit', pref('tempUnit') === 'C' ? 'F' : 'C'); build(); } },
      { label: 'Back to lockscreen after', value: pref('idleMin') ? pref('idleMin') + ' min' : 'Never',
        run: () => { const o = [3, 10, 0]; setPref('idleMin', o[(o.indexOf(pref('idleMin')) + 1) % 3]); build(); } },
      // Plex rows only matter when there's a Plex session (the app never asks to sign in).
      ...(session.token ? [
        { label: 'Server', value: session.server ? session.server.name : '—', run: switchServer },
        { label: 'Signed in as', value: session.user ? session.user.title : '—', run: doSignOut, action: 'Sign out' },
      ] : []),
      { label: 'Performance overlay', value: hudEnabled() ? 'On' : 'Off', run: () => { setHud(!hudEnabled()); build(); } },
      // For before/after recordings: brings back the full-screen gradients that took ~2s per repaint.
      { label: 'Demo: original slow renderer', value: legacyGradients() ? 'On' : 'Off', run: () => { setLegacyGradients(!legacyGradients()); build(); } },
    ];
    items.forEach(it => {
      it.el = h('div', 'setting', list);
      h('span', 'setting-label', it.el).textContent = it.label;
      h('span', 'setting-value', it.el).textContent = it.value + (it.action ? '  ·  ' + it.action : '');
    });
    render();
  }

  function render() {
    items.forEach((it, i) => toggleClass(it.el, 'focus', i === index));
  }

  async function switchServer() {
    try {
      const servers = await getServers(session.token);
      if (servers.length === 1) {
        const uri = await connect(servers[0]);
        useServer(servers[0], uri);
        restart();
        return;
      }
      router.push(ServerPicker({ servers, onDone: restart }));
    } catch (e) {
      error('server list failed', e);
    }
  }

  function doSignOut() {
    signOut();
    restart();
  }

  function restart() {
    // Rebuild from scratch: app.js decides between login and home.
    window.dispatchEvent(new Event('samsucks:restart'));
  }

  build();

  return {
    el,
    name: 'settings',
    onShow() { ambience.restore(); },
    onKey(action) {
      if (action === 'up') { index = Math.max(0, index - 1); render(); return true; }
      if (action === 'down') { index = Math.min(items.length - 1, index + 1); render(); return true; }
      if (action === 'enter') { items[index].run(); return true; }
      return false;
    },
  };
}

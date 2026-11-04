// Home (design 1f), Google TV style: full-bleed hero, tab bar, brand-colored app tiles,
// a headlines row peeking underneath. Tabs: For you · News · Music · Games · Apps.
// Back (or 3 minutes untouched) returns to the lockscreen.
import { h, setText } from '../util/dom.js';
import { listApps, launchApp } from '../platform/tizen.js';
import { InputScreen, connectedInputs, sourceName } from './input.js';
import { togglePause, onTrack } from '../ui/radio.js';
import { stories, sized } from '../ui/news.js';
import { clockText } from './idle.js';
import { nowPlayingChip } from '../ui/nowplaying.js';
import { openPicker } from '../ui/musicpicker.js';
import * as router from '../router.js';
import { SettingsScreen } from './settings.js';
import { pref } from '../util/prefs.js';

const TABS = ['For you', 'News', 'Music', 'Games', 'Apps'];
const TILE = 300 + 24;
const HERO_MS = 9000;

// Brand tiles (the design's stand-ins for app icons): background, text color.
const BRANDS = {
  Netflix: ['#000', '#E50914'], YouTube: ['#fff', '#FF0000'], 'YouTube TV': ['#fff', '#282828'], 'Prime Video': ['#1A98FF', '#fff'],
  'Disney+': ['#0E1E5B', '#fff'], 'HBO Max': ['#002BE7', '#fff'], Hulu: ['#1CE783', '#0B0C0F'], 'Apple TV': ['#000', '#fff'],
  'Peacock TV': ['#000', '#fff'], Spotify: ['#1DB954', '#000'], Twitch: ['#9146FF', '#fff'], Tubi: ['#7408FF', '#FFFF13'],
  Crunchyroll: ['#F47521', '#fff'], Xbox: ['#107C10', '#fff'], ESPN: ['#D00', '#fff'], 'Sling TV': ['#0072EB', '#fff'],
  Plex: ['#1F1F1F', '#E5A00D'], Instagram: ['#C13584', '#fff'], Fubo: ['#E43B32', '#fff'], 'AMC+': ['#000', '#fff'],
};

export function LauncherScreen({ onPlex, onGames }) {
  const el = h('div', 'screen home');
  const heroWrap = h('div', 'home-hero', el);
  const heroImgs = [h('img', 'home-hero-img', heroWrap), h('img', 'home-hero-img', heroWrap)];
  let heroFront = 0;
  h('div', 'home-hero-shade', heroWrap);

  // Top bar
  const top = h('div', 'home-top', el);
  const tabsEl = h('div', 'home-tabs', top);
  h('div', 'home-round home-search', tabsEl).innerHTML = '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>';
  const tabEls = TABS.map(t => { const b = h('div', 'home-tab', tabsEl); b.textContent = t; return b; });
  const right = h('div', 'home-right', top);
  const chip = nowPlayingChip(right, 'small');
  const gear = h('div', 'home-round', right);
  gear.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>';
  const clock = h('div', 'home-clock', right);

  // Hero text
  const heroText = h('div', 'home-hero-text', el);
  const kicker = h('div', 'home-kicker', heroText);
  const title = h('div', 'home-title', heroText);
  const dots = h('div', 'home-dots', heroText);

  const body = h('div', 'home-body', el);
  const content = h('div', 'home-content', body);

  let apps = [];
  let news = [];
  let tab = 0;
  let zone = 'rows';        // 'tabs' | 'rows'
  let rowIndex = 0;
  const cols = [];
  let rows = [];            // [{ title, kind: 'apps'|'inputs'|'news'|'music', items, el, track, tiles }]
  let inputs = [];
  let heroIndex = 0;

  function appTile(a, parent) {
    const t = h('div', 'home-tile', parent);
    const brand = BRANDS[a.name];
    if (brand) { t.style.background = brand[0]; t.style.color = brand[1]; h('span', 'home-tile-name', t).textContent = a.name; }
    else if (a.icon) { t.classList.add('icon'); const img = h('img', '', t); img.src = a.icon; img.onerror = () => { img.remove(); h('span', 'home-tile-name', t).textContent = a.name; }; }
    else h('span', 'home-tile-name', t).textContent = a.name;
    return t;
  }

  function inputTile(src, parent) {
    const t = h('div', 'home-tile input-tile', parent);
    h('span', 'input-tile-kind', t).textContent = src.type === 'TV' ? 'ANTENNA' : 'HDMI';
    h('span', 'home-tile-name', t).textContent = sourceName(src);
    return t;
  }

  function newsTile(s, parent) {
    const t = h('div', 'home-tile news', parent);
    if (s.img) { const img = h('img', '', t); img.src = sized(s.img, 320, 180); }
    else { t.classList.add('text'); h('div', 'home-tile-src', t).textContent = s.src; }
    h('div', 'home-tile-cap', t).textContent = s.text;
    return t;
  }

  function setHero(i) {
    if (!news.length) return;
    heroIndex = (i + news.length) % news.length;
    const s = news[heroIndex];
    const back = heroImgs[1 - heroFront];
    back.onload = () => { back.classList.add('on'); heroImgs[heroFront].classList.remove('on'); heroFront = 1 - heroFront; };
    back.src = sized(s.img, 1600, 900) || 'https://picsum.photos/seed/hero' + heroIndex + '/1920/1080';
    setText(kicker, s.src + ' · ' + s.ago);
    setText(title, s.text);
    dots.innerHTML = news.slice(0, 5).map((_, n) => '<i' + (n === heroIndex % 5 ? ' class="on"' : '') + '></i>').join('');
  }

  function build() {
    content.textContent = '';
    rows = [];
    const name = TABS[tab];
    el.classList.toggle('compact', name === 'Apps' || name === 'Music');
    if (name === 'For you') {
      rows.push({ title: 'Your apps', kind: 'apps', items: apps });
      // Consoles, cable boxes, live TV: shown inside SamSUCKED so pop-ups can sit on top.
      if (inputs.length) rows.push({ title: 'Inputs', kind: 'inputs', items: inputs });
      rows.push({ title: 'Headlines', kind: 'news', items: news });
    } else if (name === 'News') {
      for (let i = 0; i < news.length; i += 5) rows.push({ title: i ? '' : 'Top stories', kind: 'news', items: news.slice(i, i + 5) });
    } else if (name === 'Apps') {
      for (let i = 0; i < apps.length; i += 5) rows.push({ title: i ? '' : 'All apps', kind: 'apps', items: apps.slice(i, i + 5) });
    } else if (name === 'Music') {
      rows.push({ title: 'Listening now', kind: 'music', items: [{}] });
    }
    let y = 0;
    rows.forEach(r => {
      r.el = h('div', 'home-row', content);
      r.el.style.top = y + 'px';
      h('div', 'home-row-title', r.el).textContent = r.title;
      r.track = h('div', 'home-track', r.el);
      if (r.kind === 'music') {
        const card = h('div', 'home-tile music', r.track);
        nowPlayingChip(card, 'huge');
        h('div', 'home-music-hint', card).textContent = 'OK to pause or play';
        r.tiles = [card];
      } else {
        r.tiles = r.items.map(it => (r.kind === 'apps' ? appTile : r.kind === 'inputs' ? inputTile : newsTile)(it, r.track));
      }
      y += r.title || rows.length === 1 ? 276 : 220;
    });
    rowIndex = Math.min(rowIndex, Math.max(0, rows.length - 1));
    render();
  }

  function render() {
    tabEls.forEach((t, i) => { t.classList.toggle('current', i === tab); t.classList.toggle('focus', zone === 'tabs' && i === tab); });
    chip.el.classList.toggle('focus', zone === 'chip');
    gear.classList.toggle('focus', zone === 'gear');
    rows.forEach((r, ri) => {
      const col = Math.min(cols[ri] || 0, r.tiles.length - 1);
      r.tiles.forEach((t, ci) => t.classList.toggle('focus', zone === 'rows' && ri === rowIndex && ci === col));
      r.track.style.transform = 'translateX(' + (-Math.max(0, col - 3) * TILE) + 'px)';
    });
    const rowTop = rows[rowIndex] ? parseInt(rows[rowIndex].el.style.top, 10) : 0;
    content.style.transform = 'translateY(' + (-(zone === 'rows' ? Math.max(0, rowTop - 276) : 0)) + 'px)';
    // The hero recedes once you scroll past the first row, like Google TV.
    el.classList.toggle('scrolled', zone === 'rows' && rowIndex > 0);
  }

  function move(action) {
    if (zone === 'gear') {
      if (action === 'left') zone = 'chip';
      else if (action === 'down' && rows.length) zone = 'rows';
    } else if (zone === 'chip') {
      if (action === 'right') zone = 'gear';
      else if (action === 'left') zone = 'tabs';
      else if (action === 'down' && rows.length) zone = 'rows';
    } else if (zone === 'tabs') {
      if (action === 'right' && tab === TABS.length - 1) zone = 'chip';
      else if (action === 'left' || action === 'right') {
        const nextTab = Math.max(0, Math.min(TABS.length - 1, tab + (action === 'left' ? -1 : 1)));
        if (nextTab !== tab) { tab = nextTab; rowIndex = 0; cols.length = 0; build(); }
      } else if (action === 'down' && rows.length) zone = 'rows';
    } else {
      const r = rows[rowIndex];
      const col = cols[rowIndex] || 0;
      if (action === 'left') cols[rowIndex] = Math.max(0, col - 1);
      else if (action === 'right') cols[rowIndex] = Math.min(r.tiles.length - 1, col + 1);
      else if (action === 'up') { if (rowIndex > 0) { cols[rowIndex - 1] = cols[rowIndex - 1] ?? col; rowIndex--; } else zone = 'tabs'; }
      else if (action === 'down' && rowIndex < rows.length - 1) { cols[rowIndex + 1] = cols[rowIndex + 1] ?? col; rowIndex++; }
    }
    render();
  }

  function select() {
    if (zone === 'chip') { openPicker(); return; }
    if (zone === 'gear') { router.push(SettingsScreen()); return; }
    if (zone === 'tabs') {
      if (TABS[tab] === 'Games' && onGames) onGames();
      else if (rows.length) { zone = 'rows'; render(); }
      return;
    }
    const r = rows[rowIndex];
    const item = r.items[Math.min(cols[rowIndex] || 0, r.items.length - 1)];
    if (r.kind === 'music') togglePause();
    else if (r.kind === 'news') { setHero(news.indexOf(item)); zone = 'tabs'; render(); }
    else if (r.kind === 'inputs') router.push(InputScreen(item));
    else if (item.id === 'plex') onPlex();
    else launchApp(item.id);
  }

  let idleTimer = 0;
  let timers = [];
  // Settings → Back to lockscreen after (0 = never).
  const resetIdle = () => { clearTimeout(idleTimer); const min = pref('idleMin'); if (min) idleTimer = setTimeout(() => router.back(), min * 60000); };
  const tickClock = () => { const c = clockText(new Date()); setText(clock, c.h + ':' + c.m); };

  Promise.all([listApps(), stories(), connectedInputs()]).then(([list, s, ins]) => {
    inputs = ins;
    apps = (onPlex ? [{ id: 'plex', name: 'Plex' }] : []).concat(list);
    news = s;
    setHero(0);
    build();
  });

  return {
    name: 'launcher',
    el,
    onShow() {
      tickClock();
      resetIdle();
      timers = [setInterval(tickClock, 10000), setInterval(() => setHero((heroIndex + 1) % Math.min(5, news.length || 1)), HERO_MS)];
    },
    onHide() {
      clearTimeout(idleTimer);
      timers.forEach(clearInterval);
    },
    destroy() { chip.destroy(); },
    onKey(action) {
      resetIdle();
      if (['up', 'down', 'left', 'right'].includes(action)) { move(action); return true; }
      if (action === 'enter') { select(); return true; }
      if (action === 'playpause' || action === 'play' || action === 'pause') { togglePause(); return true; }
      if (action === 'back' && zone === 'rows' && rowIndex > 0) { rowIndex = 0; render(); return true; }
      if (action === 'back' && zone === 'rows') { zone = 'tabs'; render(); return true; }
      return false; // back from the tabs returns to the lockscreen
    },
  };
}

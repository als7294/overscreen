// Games hub (7a): two big cards, "Connect controller" and "Xbox Cloud Gaming" (← → to switch).
// Connect controller (7b): a sheet that waits for a new gamepad (Gamepad API), offers OK for
// Samsung's own pairing guide, confirms, then returns to the hub showing the pad as connected.
// Back closes the sheet, or leaves the screen (onKey returns false and the router pops it).
import { h, setText, toggleClass } from '../util/dom.js';
import { launchApp } from '../platform/tizen.js';

const XBOX_APP = 'GHI3a0zMSx.XboxGamePass';
const PAIR_GUIDE_APP = 'com.samsung.tv.gamepadguide';
const BG = 'https://picsum.photos/seed/game-0/1920/1080?blur=10';
const CLOUD_ART = 'https://picsum.photos/seed/game-0/1000/800';

const PULSE = '<div class="gm-pulse"><i></i><i></i><i></i></div>';
const CHECK = (size, color) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + color +
  '" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const PAD_ICON = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M7 7h10a5 5 0 0 1 4.9 6l-.8 3.6a2.4 2.4 0 0 1-4.1 1.1L14.5 15h-5L7 17.7a2.4 2.4 0 0 1-4.1-1.1L2.1 13A5 5 0 0 1 7 7z"/>' +
  '<path d="M7 10v3M5.5 11.5h3"/><circle cx="16" cy="10.5" r=".6" fill="currentColor"/><circle cx="18" cy="12.5" r=".6" fill="currentColor"/></svg>';
// Generic controller drawing for the pairing sheet; the pair button on top is lit.
const CONTROLLER = '<svg width="360" height="240" viewBox="0 0 360 240" fill="none">' +
  '<path d="M70 30C110 18 250 18 290 30C330 40 350 90 358 160C364 210 340 236 312 232C290 228 276 200 258 178C248 166 236 162 220 162H140C124 162 112 166 102 178C84 200 70 228 48 232C20 236-4 210 2 160C10 90 30 40 70 30Z" fill="rgba(255,255,255,.07)" stroke="rgba(255,255,255,.35)" stroke-width="3"/>' +
  '<path d="M95 78v34M78 95h34" stroke="rgba(255,255,255,.55)" stroke-width="12" stroke-linecap="round"/>' +
  '<circle cx="265" cy="76" r="9" fill="rgba(255,255,255,.45)"/><circle cx="265" cy="114" r="9" fill="rgba(255,255,255,.45)"/>' +
  '<circle cx="246" cy="95" r="9" fill="rgba(255,255,255,.45)"/><circle cx="284" cy="95" r="9" fill="rgba(255,255,255,.45)"/>' +
  '<circle cx="135" cy="134" r="20" stroke="rgba(255,255,255,.45)" stroke-width="3"/><circle cx="225" cy="134" r="20" stroke="rgba(255,255,255,.45)" stroke-width="3"/>' +
  '<circle cx="180" cy="72" r="15" fill="rgba(255,255,255,.18)" stroke="rgba(255,255,255,.6)" stroke-width="3"/>' +
  '<rect x="164" y="13" width="32" height="10" rx="5" fill="#2FD4C8"/></svg>';

function pads() {
  try { return Array.prototype.filter.call(navigator.getGamepads ? navigator.getGamepads() : [], Boolean); } catch (e) { return []; }
}
const padKey = p => p.index + ':' + p.id;
// "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)" -> "Xbox Wireless Controller"
const padName = p => (p.id.replace(/\s*\(.*$/, '').replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').trim() || 'Controller');

export function GamesScreen() {
  const el = h('div', 'screen games');
  const bg = h('img', 'gm-bg', el);
  bg.onload = () => bg.classList.add('on');
  bg.src = BG;
  h('div', 'gm-shade', el);

  const top = h('div', 'gm-top', el);
  setText(h('div', 'gm-title', top), 'Games');
  const padChip = h('div', 'gm-pad', top);
  padChip.innerHTML = PAD_ICON;
  const padChipText = h('span', '', padChip);
  const clock = h('div', 'gm-clock', top);

  // 7a: the two cards
  const cards = h('div', 'gm-cards', el);
  const connect = h('div', 'gm-card gm-connect', cards);
  h('div', 'gm-badge', connect).innerHTML = PULSE + '<div class="gm-badge-core">' + CHECK(26, '#03201E') + '</div>';
  const cTitle = h('div', 'gm-h', connect);
  const cText = h('div', 'gm-p', connect);
  const status = h('div', 'gm-status', connect);
  h('div', 'gm-dot', status);
  const statusText = h('span', '', status);
  const cBtn = h('div', 'gm-btn', connect);

  const cloud = h('div', 'gm-card gm-cloud', cards);
  const art = h('img', '', cloud);
  art.src = CLOUD_ART;
  art.onerror = () => art.remove();
  h('div', 'gm-cloud-shade', cloud);
  const ct = h('div', 'gm-cloud-text', cloud);
  setText(h('div', 'gm-h', ct), 'Xbox Cloud Gaming');
  setText(h('div', 'gm-p', ct), 'Jump back into your games.');
  setText(h('div', 'gm-btn white', ct), 'Open');
  const cardEls = [connect, cloud];

  // 7b: the pairing sheet
  const pair = h('div', 'gm-pair hidden', el);
  h('div', 'gm-pair-dim', pair);
  const sheet = h('div', 'gm-sheet', pair);
  h('div', 'gm-art', sheet).innerHTML = CONTROLLER + PULSE;
  const col = h('div', 'gm-col', sheet);
  setText(h('div', 'gm-h', col), 'Connect your controller');
  setText(h('div', 'gm-p', col), 'Bluetooth controllers you’ve paired before connect on their own.');
  const steps = h('div', 'gm-steps', col);
  ['Turn it on with the centre button', 'Hold the pair button on top for 3 seconds', 'Wait for the light to flash quickly'].forEach((s, i) => {
    const row = h('div', 'gm-step', steps);
    setText(h('b', '', row), i + 1);
    row.appendChild(document.createTextNode(s));
  });
  const state = h('div', 'gm-state', col);
  h('div', 'gm-state-icon', state).innerHTML = PULSE + '<div class="gm-state-core">' + CHECK(20, '#03201E') + '</div>';
  const stateText = h('div', '', state);
  const stateTitle = h('div', 'gm-state-title', stateText);
  const stateSub = h('div', 'gm-state-sub', stateText);
  const hints = h('div', 'gm-hints', col);
  hints.innerHTML = '<div class="gm-key">OK</div><span>Samsung pairing guide</span><div class="gm-key">Back</div><span>Cancel</span>';

  let focus = 0;
  let mode = 'hub'; // 'hub' | 'search' | 'done'
  let baseline = {};
  let current = null; // the connected pad, if any
  let poll = 0;
  let clockTimer = 0;
  let doneTimer = 0;

  function renderFocus() {
    cardEls.forEach((c, i) => toggleClass(c, 'focus', i === focus));
  }

  function renderHub() {
    toggleClass(connect, 'gm-connected', !!current);
    setText(cTitle, current ? 'Controller connected' : 'Connect controller');
    setText(cText, current ? padName(current) + ' is ready. Open Xbox Cloud Gaming to play.'
      : 'No controller found. Pair a Bluetooth controller in a few seconds.');
    setText(statusText, current ? 'Connected' : 'Not connected');
    setText(cBtn, current ? 'Pair another' : 'Connect');
    setText(padChipText, current ? padName(current) : 'No controller');
  }

  function openPair() {
    mode = 'search';
    baseline = {};
    pads().forEach(p => { baseline[padKey(p)] = true; });
    setText(stateTitle, 'Looking for controllers…');
    setText(stateSub, 'Keep holding the pair button');
    pair.classList.remove('done', 'hidden');
    void pair.offsetWidth;
    pair.classList.add('on');
  }

  function closePair() {
    mode = 'hub';
    clearTimeout(doneTimer);
    pair.classList.remove('on');
    doneTimer = setTimeout(() => { if (mode === 'hub') pair.classList.add('hidden'); }, 320);
  }

  function confirm(p) {
    mode = 'done';
    current = p;
    setText(stateTitle, 'Controller connected');
    setText(stateSub, padName(p) + ' · taking you to Games');
    pair.classList.add('done');
    renderHub();
    clearTimeout(doneTimer);
    doneTimer = setTimeout(() => { focus = 1; renderFocus(); closePair(); }, 2000);
  }

  function refresh() {
    const list = pads();
    if (mode === 'search') {
      const fresh = list.find(p => !baseline[padKey(p)]);
      if (fresh) { confirm(fresh); return; }
    }
    const still = current && list.find(p => padKey(p) === padKey(current));
    const next = still || list[0] || null;
    if (next !== current) { current = next; renderHub(); }
  }

  function tick() {
    const d = new Date();
    setText(clock, (d.getHours() % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0'));
  }

  function onPadEvent() { refresh(); }

  renderHub();
  renderFocus();

  return {
    name: 'games',
    el,
    onShow() {
      tick();
      clockTimer = setInterval(tick, 10000);
      // Chromium only lists a pad after one of its buttons is pressed; the event and poll catch that.
      window.addEventListener('gamepadconnected', onPadEvent);
      window.addEventListener('gamepaddisconnected', onPadEvent);
      poll = setInterval(refresh, 500);
      refresh();
    },
    onHide() {
      clearInterval(clockTimer);
      clearInterval(poll);
      window.removeEventListener('gamepadconnected', onPadEvent);
      window.removeEventListener('gamepaddisconnected', onPadEvent);
    },
    destroy() {
      clearTimeout(doneTimer);
    },
    onKey(action) {
      if (mode !== 'hub') {
        if (action === 'back') { closePair(); return true; }
        if (action === 'enter' && mode === 'search') { launchApp(PAIR_GUIDE_APP); return true; }
        return true; // the sheet is modal
      }
      if (action === 'left' || action === 'right') {
        const next = action === 'left' ? 0 : 1;
        if (next !== focus) { focus = next; renderFocus(); }
        return true;
      }
      if (action === 'enter') {
        if (focus === 0) openPair();
        else launchApp(XBOX_APP);
        return true;
      }
      return action === 'up' || action === 'down';
    },
  };
}

// System overlays: power-off animation (1e), volume (1j) and mute (1k).
// Styles live in css/system.css. Everything animates transform/opacity only.
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import { isTizen } from '../platform/tizen.js';

// ---------- power off ----------
// Folds the whole app to a Tiffany line, then to a point. Resolves after ~1.2 s,
// leaving a black screen; the caller then sends the power key. If the app is still
// visible a few seconds later (power key failed, or desktop), the screen comes back.
let powering = null;
export function playPowerOff() {
  if (powering) return powering;
  const root = document.documentElement;
  const line = h('div', 'po-line', document.body);
  root.classList.add('power-off');
  function restore() {
    root.classList.remove('power-off');
    if (line.parentNode) line.parentNode.removeChild(line);
    document.removeEventListener('visibilitychange', onVis);
    clearTimeout(fallback);
    powering = null;
  }
  // The TV resumes the app later with this state still applied; undo it then.
  function onVis() { if (document.visibilityState === 'visible') restore(); }
  let fallback = 0;
  powering = new Promise(resolve => setTimeout(() => {
    document.addEventListener('visibilitychange', onVis);
    fallback = setTimeout(restore, 6000);
    resolve();
  }, 1200));
  return powering;
}

// ---------- volume + mute ----------
const SPEAKER = '<polygon points="4,9 8,9 13,5 13,19 8,15 4,15" fill="#fff" stroke="none"/>';
const VOL_ICON = '<svg class="ic-vol" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  SPEAKER + '<path class="wave w1" d="M16.5 9a4 4 0 0 1 0 6"/><path class="wave w2" d="M19 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
const MUTE_ICON = '<svg class="ic-mute" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2FD4C8" stroke-width="2.4" stroke-linecap="round">' +
  SPEAKER + '<path class="slash" d="M3 3l18 18" stroke-dasharray="30"/></svg>';
const MUTED_MARK = (size, color, fill) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + color +
  '" stroke-width="' + (size > 60 ? 2 : 2.4) + '" stroke-linecap="round"><polygon points="4,9 8,9 13,5 13,19 8,15 4,15" fill="' + fill +
  '" stroke="none"/><path d="M16 9l6 6M22 9l-6 6"/></svg>';

const HIDE_MS = 2000;
let ov = null;
let level = 0;
let muted = false;
let shown = false;
let hideTimer = 0;
let offTimer = 0;
let muteTimers = [];

function build() {
  if (ov) return ov;
  const el = h('div', 'so', document.body);
  const L = cls => h('div', 'so-layer ' + cls, el);
  const o = { el };
  L('so-dim');
  L('so-shade');
  L('so-glow-b');
  o.glowL = L('so-glow-s l'); o.glowR = L('so-glow-s r');
  L('so-line-b');
  o.edgeL = L('so-edge l'); o.edgeR = L('so-edge r');
  o.headL = L('so-head l'); o.headR = L('so-head r');
  o.rip = L('so-rip');
  L('so-big').innerHTML = MUTED_MARK(110, '#2FD4C8', '#fff');
  const panel = L('so-panel');
  o.num = h('div', 'so-num', panel);
  const track = h('div', 'so-track', panel);
  o.grey = h('div', 'so-fill grey', track);
  o.fill = h('div', 'so-fill tiff', track);
  const icon = h('div', 'so-icon', panel);
  icon.innerHTML = VOL_ICON + MUTE_ICON;
  o.w1 = icon.querySelector('.w1'); o.w2 = icon.querySelector('.w2');
  o.slash = icon.querySelector('.slash');
  const chip = L('so-chip');
  chip.innerHTML = MUTED_MARK(30, '#2FD4C8', '#2FD4C8') + '<span>Muted</span>';
  ov = o;
  return o;
}

// Make sure the layer is in the tree and has had a style pass, so the next class
// change transitions instead of jumping.
function wake() {
  const o = build();
  clearTimeout(offTimer);
  if (!o.el.classList.contains('live')) {
    o.el.classList.add('live');
    void o.el.offsetWidth;
  }
  return o;
}

function render() {
  const o = ov;
  if (!o) return;
  const f = level / 100;
  const lit = shown && !muted;
  setText(o.num, level);
  setTransform(o.fill, 'scaleY(' + f.toFixed(3) + ')');
  setTransform(o.grey, 'scaleY(' + f.toFixed(3) + ')');
  const edge = lit ? 'scaleY(' + f.toFixed(3) + ')' : 'scaleY(0)';
  const head = lit ? 'translateY(' + Math.round(-f * 1080) + 'px)' : 'none';
  setTransform(o.edgeL, edge); setTransform(o.edgeR, edge);
  setTransform(o.glowL, edge); setTransform(o.glowR, edge);
  setTransform(o.headL, head); setTransform(o.headR, head);
  o.w1.style.opacity = level > 0 ? 1 : 0.2;
  o.w2.style.opacity = level > 35 ? 1 : 0.2;
  toggleClass(o.el, 'shown', shown);
  toggleClass(o.el, 'lit', lit);
  toggleClass(o.el, 'muted', muted);
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    shown = false;
    render();
    // Drop the layers once everything has faded, unless the muted chip stays up.
    if (!muted) offTimer = setTimeout(() => ov && ov.el.classList.remove('live'), 900);
  }, HIDE_MS);
}

function clearMuteTimers() {
  muteTimers.forEach(clearTimeout);
  muteTimers = [];
}

function setMuted(on) {
  const o = ov;
  if (muted === on) return;
  muted = on;
  clearMuteTimers();
  if (on) {
    // Big muted mark pops with a ripple, then settles into the small chip.
    o.rip.classList.remove('go');
    o.slash.style.animation = 'none';
    void o.rip.offsetWidth;
    o.slash.style.animation = '';
    o.rip.classList.add('go');
    muteTimers.push(setTimeout(() => o.el.classList.add('big'), 100));
    muteTimers.push(setTimeout(() => o.el.classList.add('chip'), 1200));
    muteTimers.push(setTimeout(() => o.el.classList.remove('big'), 1400));
  } else {
    o.el.classList.remove('big', 'chip');
    o.rip.classList.remove('go');
  }
}

function update(nextLevel, nextMuted) {
  wake(); // the hidden pose has been styled, so this change transitions in
  if (nextLevel != null) level = Math.max(0, Math.min(100, Math.round(nextLevel)));
  setMuted(!!nextMuted);
  shown = true;
  render();
  scheduleHide();
}

// Show the volume overlay at a level (0-100). Changing the volume unmutes, as on the TV.
export function showVolume(nextLevel) {
  update(nextLevel, false);
}

// Show (or clear) the mute state. The small "Muted" chip stays while muted.
export function showMute(on) {
  update(null, on);
}

// On the TV: follow the remote's volume and mute keys. Safe to call on desktop.
let started = false;
export function startSystemOverlays() {
  if (started || !isTizen) return;
  started = true;
  let api;
  try { api = tizen.tvaudiocontrol; } catch (e) { return; }
  if (!api) return;
  const isMute = () => { try { return !!api.isMute(); } catch (e) { return muted; } };
  try { level = api.getVolume(); } catch (e) {}
  let lastMute = isMute();
  // Already muted at launch: just put the chip up once the boot animation is over.
  if (lastMute) setTimeout(() => {
    if (!isMute() || muted) return;
    const o = wake();
    muted = true;
    o.el.classList.add('chip');
    render();
  }, 3600);
  try {
    api.setVolumeChangeListener(v => {
      lastMute = isMute();
      update(v, lastMute);
    });
  } catch (e) {}
  // The mute key fires no event, so poll it (cheap: one sync call).
  setInterval(() => {
    const m = isMute();
    if (m !== lastMute) {
      lastMute = m;
      showMute(m);
    }
  }, 700);
}

// Claude / GPT pop-ups for the assistants on the Mac (styles in css/popups.css).
// The TV can't accept connections, so it long-polls tools/notify.mjs instead.
//   question, done, image: transient pills at the top centre, shown one at a time
//   working: persists until updated (same id = update in place) or cleared
//   wrapup: full-screen sheet (card / show / talk) that runs, then dismisses
// pillOnKey(action) must be offered keys first by whoever routes remote input.
import { NOTIFY_HOST } from '../config.js';
import { setText } from '../util/dom.js';
import { stop as radioStop, play as radioPlay, track, musicCommand, duck } from './radio.js';
import { playAlertSound, soundFor } from './alertsound.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOW_MS = { question: 9000, done: 6000, image: 10000 };
const SLIDE_MS = { show: 7000, card: 5000 };
const BRAND = {
  claude: { name: 'Claude', icon: 'img/brand/agent-a.svg' },
  gpt: { name: 'ChatGPT', icon: 'img/brand/agent-b.svg' },
};
const CHECK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2FD4C8" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const FOLDER = '<svg width="20" height="20" viewBox="0 0 24 24" fill="#2FD4C8"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/></svg>';
const DONE_BADGE = '<div class="pp-badge"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0A9B97" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12.5l4 4L18 8"/></svg></div>';
const SPEAKER = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0b1011" stroke-width="2.4" stroke-linecap="round"><polygon points="4,9 8,9 13,5 13,19 8,15 4,15" fill="#0b1011" stroke="none"/><path d="M16.5 10a3 3 0 0 1 0 4" opacity=".45"/></svg>';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const brandOf = ev => BRAND[ev.source === 'gpt' ? 'gpt' : 'claude'];
const ai = (b, cls = '', badge = '') => `<div class="pp-ai ${cls}"><img src="${b.icon}" alt="">${badge}</div>`;
const checks = pts => pts && pts.length ? `<div class="pp-checks">${pts.map(t => `<div>${CHECK}${esc(t)}</div>`).join('')}</div>` : '';

function el(html, parent = document.body) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const n = t.content.firstChild;
  parent.appendChild(n);
  return n;
}

function ago(ms) {
  if (ms < 60000) return Math.max(1, Math.round(ms / 1000)) + ' s';
  const m = Math.round(ms / 60000);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}

function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  const ss = String(s % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
}

// The key sentence becomes <strong>: `key` if it's in the text, else the first sentence.
function highlight(text, key) {
  text = String(text);
  let i = key ? text.indexOf(key) : -1, n = key ? key.length : 0;
  if (i < 0) { const m = /^.*?[.!?](?=\s|$)/.exec(text); i = 0; n = m ? m[0].length : text.length; }
  return esc(text.slice(0, i)) + '<strong>' + esc(text.slice(i, i + n)) + '</strong>' + esc(text.slice(i + n));
}

// One shared 20 Hz ticker for clocks, count-ups and talk sync; it stops when nobody listens.
const ticks = new Set();
let tickTimer = 0;
function onTick(fn) {
  ticks.add(fn);
  if (!tickTimer) tickTimer = setInterval(() => { const now = Date.now(); ticks.forEach(f => f(now)); }, 50);
  return () => {
    ticks.delete(fn);
    if (!ticks.size) { clearInterval(tickTimer); tickTimer = 0; }
  };
}

function closer(root, cleanup) {
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    if (cleanup) cleanup();
    root.classList.add('pp-out');
    setTimeout(() => root.remove(), 600);
  };
}

function topSlot(ev, inner) {
  const cls = (ev.source === 'gpt' ? ' pp-gpt' : '') + (ev.important ? ' pp-imp' : '') + ' pp-k-' + ev.kind; // pp-k-* picks the tag
  return el(`<div class="pp pp-top${cls}"><div class="pp-anim">${inner}</div></div>`);
}

function timed(ev, root, ms) {
  const p = { ev };
  const timer = setTimeout(() => finish(p), ms);
  p.close = closer(root, () => clearTimeout(timer));
  return p;
}

// ---------- question (restyled classic pill) ----------
function openQuestion(ev) {
  const b = brandOf(ev);
  const root = topSlot(ev, `<div class="pp-box pp-pill pp-q">${ai(b, '', '<div class="pp-badge pp-bob">?</div>')}
    <div class="pp-words"><div class="pp-title">${esc(ev.title || b.name + ' has a question')}</div>
    <div class="pp-sub">${esc(ev.text)}</div></div></div>`);
  return timed(ev, root, SHOW_MS.question * (ev.important ? 2 : 1));
}

// ---------- done (4c) ----------
function openDone(ev) {
  const b = brandOf(ev);
  const took = ev.startedAt ? 'Finished in ' + ago(Date.now() - ev.startedAt) : '';
  const meta = (took ? `<span>${took}</span>` : '') + (ev.project ? `<span class="pp-chip">${FOLDER}${esc(ev.project)}</span>` : '');
  const head = `<div class="pp-head">${ai(b, '', DONE_BADGE)}<div class="pp-words">
    <div class="pp-title">${esc(ev.title || b.name + ' finished')}</div><div class="pp-meta">${meta}</div></div></div>`;
  const text = ev.text ? highlight(ev.text, ev.highlight) : '';
  const root = topSlot(ev, text
    ? `<div class="pp-box pp-card">${head}<div class="pp-text">${text}<div class="pp-sweep" aria-hidden="true"><div>${text}</div></div></div></div>`
    : `<div class="pp-box pp-pill">${head}</div>`);
  // ~6 s, a little longer when there's a lot to read
  const ms = Math.max(SHOW_MS.done, Math.min(12000, String(ev.text || '').length * 60));
  return timed(ev, root, ms * (ev.important ? 2 : 1));
}

const MSG_APPS = {
  imessage: { label: 'iMessage', icon: 'img/brand/app-message.svg' },
  facetime: { label: 'FaceTime', icon: 'img/brand/app-call.svg' },
  discord: { label: 'Discord', icon: 'img/brand/app-chat.svg' },
};
// The TV has one decoder for compressed audio, and the radio holds it. Voice clips are decoded in
// software and played through Web Audio instead, so they start instantly and mix over the softened
// music. Looks like an <audio> element to the code below (currentTime, duration, events, play/pause).
let voiceCtx = null;
function voiceClip(url) {
  const ctx = voiceCtx || (voiceCtx = new (window.AudioContext || window.webkitAudioContext)());
  const on = {}; const fire = n => (on[n] || []).forEach(f => f());
  let buf = null, src = null, startedAt = 0, wantPlay = false, stopped = false, done;
  const ready = new Promise(r => { done = r; });
  const begin = () => {
    if (!buf || stopped || src) return;
    src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
    src.onended = () => { if (!stopped) fire('ended'); };
    startedAt = ctx.currentTime; src.start();
  };
  fetch(url).then(r => r.arrayBuffer()).then(a => new Promise((res, rej) => ctx.decodeAudioData(a, res, rej)))
    .then(b => { buf = b; done(); fire('loadedmetadata'); if (wantPlay) begin(); }).catch(() => { done(); fire('error'); });
  return {
    ready,
    get currentTime() { return src ? ctx.currentTime - startedAt : 0; },
    get duration() { return buf ? buf.duration : NaN; },
    addEventListener(n, f) { (on[n] = on[n] || []).push(f); },
    play() { wantPlay = true; if (ctx.state === 'suspended') ctx.resume(); begin(); return Promise.resolve(); },
    pause() { stopped = true; try { if (src) src.stop(); } catch (e) {} },
    removeAttribute() {}, load() {},
  };
}

// ---------- voice: a spoken update without pictures, as a regular-size pill ----------
function openVoice(ev, w, lines) {
  const b = brandOf(ev);
  const bars = '<span class="pp-vbars"><i></i><i></i><i></i><i></i></span>';
  const root = topSlot(ev, `<div class="pp-box pp-card pp-voice">
    <div class="pp-head">${ai(b)}<div class="pp-words"><div class="pp-title">${esc(w.title || ev.title || b.name)}</div>
    <div class="pp-meta"><span>${bars}${b.name} is talking</span></div></div></div><div class="pp-text pp-vline"></div></div>`);
  root.classList.add('pp-talk'); // lets YouTube mode pause the video while this is up
  const line = root.querySelector('.pp-vline');
  const est = l => 0.36 * String(l.text).split(/\s+/).length + 0.5;
  let starts = []; lines.forEach((l, i) => { starts[i] = typeof l.at === 'number' ? l.at : i ? starts[i - 1] + est(lines[i - 1]) : 0; });
  const total = starts[starts.length - 1] + est(lines[lines.length - 1]);
  let audio = null, resume = false, cur = -1, from = Date.now(), done = false;
  const show = i => { if (i === cur) return; cur = i; line.classList.remove('in'); void line.offsetWidth; setText(line, lines[i].text); line.classList.add('in'); };
  if (w.audio) {
    audio = ev._audio || voiceClip(w.audio);
    resume = !track.paused; if (resume) duck(true); // the music softens under the voice, it doesn't stop
    audio.addEventListener('loadedmetadata', () => { if (lines.every(l => typeof l.at !== 'number') && isFinite(audio.duration)) { const k = audio.duration / total; starts = starts.map(x => x * k); } });
    audio.addEventListener('ended', () => finishSoon());
    const fallback = () => { if (!audio) return; from = Date.now() - audio.currentTime * 1000; audio = null; };
    audio.addEventListener('error', fallback);
    audio.play().catch(fallback);
  }
  show(0);
  const off = onTick(now => {
    const t = audio ? audio.currentTime : (now - from) / 1000;
    if (!audio && t > total + 1.5) return finishSoon();
    let i = 0; while (i + 1 < starts.length && t >= starts[i + 1]) i++;
    show(i);
  });
  const p = { ev };
  const safety = setTimeout(() => finish(p), (total + 30) * 1000); // never stuck if the audio stalls
  p.close = closer(root, () => { off(); clearTimeout(safety); if (audio) audio.pause(); if (resume) duck(false); });
  function finishSoon() { if (done) return; done = true; off(); setTimeout(() => finish(p), 1600); }
  return p;
}

// ---------- message: an iMessage/text from the Mac (sender photo, name, the text) ----------
function openMessage(ev) {
  const name = ev.title || 'New message';
  const initials = name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const av = ev.avatar ? `<img src="${esc(ev.avatar)}" alt="">` : `<span>${esc(initials)}</span>`;
  const app = MSG_APPS[ev.app] ? ev.app : 'imessage';
  const meta = (ev.group ? `<span class="pp-chip">${esc(ev.group)}</span>` : '') + `<span>${MSG_APPS[app].label}</span>`;
  // Sender's photo with the green Messages icon tucked on its corner, like on iPhone.
  const head = `<div class="pp-head"><div class="pp-ai pp-msg-av">${av}<img class="pp-msg-badge" src="${MSG_APPS[app].icon}" alt=""></div><div class="pp-words">
    <div class="pp-title">${esc(name)}</div><div class="pp-meta">${meta}</div></div></div>`;
  const root = topSlot(ev, `<div class="pp-box pp-card pp-msg pp-app-${app}">${head}<div class="pp-text">${esc(ev.text || '')}</div></div>`);
  return timed(ev, root, Math.max(6000, Math.min(12000, String(ev.text || '').length * 70)));
}

// ---------- working (4b, 4f from GPT) ----------
function openWorking(ev) {
  const b = brandOf(ev);
  const root = topSlot(ev, `<div class="pp-box pp-pill pp-wk">${ai(b, 'pp-spin')}
    <div class="pp-words"><div class="pp-title"></div><div class="pp-sub pp-one"></div></div><div class="pp-time"></div></div>
    <div class="pp-plan"></div>`);
  const [title, sub, time, plan] = ['.pp-title', '.pp-sub', '.pp-time', '.pp-plan'].map(s => root.querySelector(s));
  // A correction ("no, not like that") gets its own amber look.
  root.classList.toggle('pp-correct', ev.variant === 'correction');
  root.classList.toggle('pp-add', ev.variant === 'addition'); // "also add…": its own green tag
  const p = { ev, working: true };
  let miniTimer = 0;
  let lastStep = ev.collapsedOnce ? (ev.step || ev.text || '') : null;
  if (ev.collapsedOnce) root.classList.add('pp-mini', 'pp-mini-instant');
  // Up for ~3.5 s, then it collapses and flies right into the shared working icon.
  const expandBriefly = () => { root.classList.remove('pp-mini'); clearTimeout(miniTimer); miniTimer = setTimeout(() => { root.classList.remove('pp-mini-instant'); root.classList.add('pp-mini'); const w = working.get(p.ev.id); if (w) w.collapsedOnce = true; setTimeout(updateDock, 1050); }, 3500); };
  p.update = e => {
    p.ev = e;
    // Only a new message re-opens the pill; a refined title for the same message doesn't.
    const step = e.quote || e.step || e.text || '';
    if (step !== lastStep) { lastStep = step; root.classList.remove('pp-mini-instant'); expandBriefly(); }
    const steps = Array.isArray(e.plan) ? e.plan : [];
    const now = steps.find(s => s.state === 'now');
    setText(title, e.title || b.name + ' is working');
    // Your message in quotes when the pill came from a prompt; otherwise the current step.
    setText(sub, e.quote ? '“' + e.quote + '”' : e.step || (now && now.label) || e.text || '');
    if (plan.children.length !== steps.length) {
      plan.innerHTML = steps.map(() => '<div class="pp-step"><div class="pp-track"><div class="pp-fill"></div></div><div class="pp-lbl"></div></div>').join('');
    }
    steps.forEach((s, i) => {
      const n = plan.children[i];
      const cls = 'pp-step ' + (s.state === 'done' || s.state === 'now' ? s.state : 'next');
      if (n.className !== cls) n.className = cls;
      setText(n.lastChild, s.label);
    });
  };
  p.update(ev);
  const off = onTick(now => setText(time, clock(now - p.ev.startedAt)));
  p.close = closer(root, () => { off(); clearTimeout(miniTimer); });
  return p;
}

// ---------- image (4e) ----------
function openImage(ev) {
  const b = brandOf(ev);
  const src = esc(ev.image);
  let file = String(ev.image || '').split(/[?#]/)[0].split('/').pop();
  try { file = decodeURIComponent(file); } catch (e) { /* keep it raw */ }
  if (file.indexOf('.') < 0) file = 'Image';
  const root = topSlot(ev, `<div class="pp-box pp-pill pp-ipill">${ai(b)}
      <div class="pp-words"><div class="pp-title">${esc(ev.title || b.name + ' sent an image')}</div><div class="pp-sub pp-one">${esc(ev.text)}</div></div>
      ${ev.project ? `<div class="pp-tag">${FOLDER}${esc(ev.project)}</div>` : ''}</div>
    <div class="pp-box pp-shot" style="--dur:${SHOW_MS.image}ms"><img src="${src}" alt="">
      <div class="pp-left"><div></div></div>
      <div class="pp-foot"><span>${esc(file)}</span><span><span class="pp-key">OK</span>Full screen</span></div></div>`);
  const img = root.querySelector('img'), shot = root.querySelector('.pp-shot');
  const p = { ev };
  let timer = 0, full = null, closed = false;
  const t0 = Date.now();
  // Grow once the pill has landed and the image is decoded (or 4 s at most).
  Promise.race([img.decode().catch(() => {}), sleep(4000)]).then(() => setTimeout(() => {
    if (closed || full) return;
    shot.classList.add('open');
    timer = setTimeout(() => finish(p), SHOW_MS.image);
  }, Math.max(0, 650 - (Date.now() - t0))));
  p.onKey = a => {
    if (a === 'enter' && !full) {
      clearTimeout(timer);
      full = el(`<div class="pp pp-full"><img src="${src}" alt=""></div>`);
      void full.offsetWidth;
      full.classList.add('on');
      return true;
    }
    if (a === 'enter' || a === 'back') { finish(p); return true; }
    return !!full; // full screen swallows everything else
  };
  p.close = closer(root, () => {
    closed = true;
    clearTimeout(timer);
    if (full) { const f = full; f.classList.remove('on'); setTimeout(() => f.remove(), 400); }
  });
  return p;
}

// ---------- wrap-up: 5d card, 6a show, 6b talk ----------
function openWrapup(ev) {
  const w = ev.wrapup || {};
  const b = brandOf(ev);
  const slides = (w.slides || []).filter(s => s && s.image);
  const lines = (w.lines || []).filter(l => l && l.text);
  // A spoken update with no pictures gets the compact voice pill instead of the full sheet.
  if (w.mode === 'talk' && lines.length && !lines.some(l => l.image) && !slides.length) return openVoice(ev, w, lines);
  const kind = w.mode === 'talk' && lines.length ? 'talk' : slides.some(s => s.stats && s.stats.length) ? 'show' : 'card5';
  const took = ev.startedAt ? ago(Date.now() - ev.startedAt) : '';
  const meta = [took, ev.project].filter(Boolean).join(' · ');
  const finished = 'Project finished' + (took ? ' · ' + took : '');
  const title = esc(w.title || 'Project finished');
  const dots = n => n > 1 ? `<div class="pp-dots">${'<i></i>'.repeat(n)}</div>` : '';

  // talk: one image layer per distinct image; each line shows the latest image at or before it
  const talkImgs = [];
  const lineImg = [];
  lines.forEach((l, i) => {
    if (l.image && !talkImgs.includes(l.image)) talkImgs.push(l.image);
    lineImg[i] = l.image ? talkImgs.indexOf(l.image) : i ? lineImg[i - 1] : -1;
  });
  const stage = srcs => `<div class="pp-stage">${srcs.map(s => `<div class="pp-s6"><div><img src="${esc(s)}" alt=""></div><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>`).join('')}</div>`;

  let sheet;
  if (kind === 'card5') {
    sheet = `<div class="pp-in"><div class="pp-cl">
        <div class="pp-hrow">${ai(b)}<div class="pp-hm">${esc(finished)}</div></div>
        <div class="pp-ctitle">${title}</div>
        ${w.summary ? `<div class="pp-sum">${ev.highlight ? highlight(w.summary, ev.highlight) : esc(w.summary)}</div>` : ''}
        ${checks(w.points)}</div>
      ${slides.length ? `<div class="pp-cr"><div class="pp-caprow"><span class="pp-cap"></span>${dots(slides.length)}</div>
        <div class="pp-media" style="--slide:${SLIDE_MS.card}ms">${slides.map(s => `<img src="${esc(s.image)}" alt="">`).join('')}</div></div>` : ''}
    </div>`;
  } else {
    const head = kind === 'talk'
      ? `<div class="pp-speak">${ai(b)}<b>${b.name}</b><span class="pp-wave">${[0.9, 0.6, 1.1, 0.7, 1.0, 0.55, 0.85, 0.75, 0.95].map((d, i) => `<i style="animation-duration:${d}s;animation-delay:${-i * 0.17}s"></i>`).join('')}</span><small>Speaking</small></div><div class="pp-hs">${esc(finished)}</div>`
      : `${ai(b)}<div><div class="pp-ht">Project finished</div><div class="pp-hs">${esc(meta)}</div></div>`;
    const words = String(w.title || 'Project finished').split(/\s+/).map((x, i) => `<span><span style="transition-delay:${(0.1 + i * 0.09).toFixed(2)}s">${esc(x)}</span></span>`).join('');
    const left = kind === 'talk'
      ? `<div class="pp-lyr"><div class="pp-ly">${lines.map(l => `<div class="pp-ln"><div>${String(l.text).split(/\s+/).map(x => `<span>${esc(x)}</span>`).join(' ')}</div></div>`).join('')}</div></div>${checks(w.points)}`
      : `<div class="pp-dotrow">${dots(slides.length)}<div class="pp-n"></div></div><div class="pp-panel"></div>`;
    sheet = `<div class="pp-in pp-zoom"><div class="pp-hrow">${head}</div><div class="pp-t6">${words}</div>
      <div class="pp-b6"><div class="pp-l6">${left}</div><div class="pp-r6">${stage(kind === 'talk' ? talkImgs : slides.map(s => s.image))}</div></div></div>`;
  }

  const noImg = kind === 'talk' && !talkImgs.length ? ' pp-noimg' : '';
  const root = el(`<div class="pp pp-wrap pp-${kind}${ev.source === 'gpt' ? ' pp-gpt' : ''}${noImg}">
    <div class="pp-scrim"></div>
    <div class="pp-box pp-wpill">${ai(b)}<div><div class="pp-wt">Project finished</div><div class="pp-ws">${title}</div></div></div>
    <div class="pp-sheet">${sheet}</div>
    ${kind === 'talk' ? `<div class="pp-music"><div>${SPEAKER}</div><b>Music softened</b><span>&nbsp;· while ${b.name} talks</span></div>` : ''}
  </div>`);

  const p = { ev };
  const timers = [];
  const offs = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  const end = () => finish(p);
  const q = s => root.querySelector(s);
  const all = s => Array.prototype.slice.call(root.querySelectorAll(s));
  const setDots = i => all('.pp-dots i').forEach((d, k) => d.classList.toggle('on', k === i));

  function runSlides(perSlide, show) {
    const imgs = kind === 'card5' ? all('.pp-media img') : all('.pp-s6');
    const panel = q('.pp-panel'), n = q('.pp-n'), cap = q('.pp-cap');
    const go = i => {
      setDots(i);
      imgs.forEach((m, k) => m.classList.toggle('on', k === i));
      if (cap) setText(cap, slides[i].caption);
      if (n) setText(n, slides.length > 1 ? (i + 1) + ' / ' + slides.length : '');
      if (panel) show(panel, slides[i], i);
      at(perSlide, () => (i + 1 < slides.length ? go(i + 1) : end()));
    };
    if (slides.length) go(0); else at(perSlide * 2, end);
  }

  function showPanel(panel, s, i) {
    panel.classList.remove('on');
    at(i ? 350 : 0, () => {
      const stats = s.stats || [];
      const bar = stats.find(x => x.before != null && x.after != null);
      const mx = bar ? Math.max(bar.before, bar.after) || 1 : 1;
      const u = x => (x.unit ? ' ' + esc(x.unit) : '');
      panel.innerHTML = `<div class="pp-pn">${esc(s.caption)}</div>
        ${stats.length ? `<div class="pp-tiles">${stats.slice(0, 2).map(x => `<div class="pp-tile"><div class="pp-val"><span class="pp-cnt">0</span><em>${esc(x.unit || '')}</em></div><div class="pp-tl">${esc(x.label)}</div></div>`).join('')}</div>` : ''}
        ${bar ? `<div class="pp-bars"><div class="pp-bl">${esc(bar.label)}</div>
          <div class="pp-br"><span>Before</span><div class="pp-trk"><div class="pp-bf" style="--s:${(bar.before / mx).toFixed(3)}"></div></div><b>${esc(bar.before)}${u(bar)}</b></div>
          <div class="pp-br after"><span>After</span><div class="pp-trk"><div class="pp-bf" style="--s:${(bar.after / mx).toFixed(3)}"></div></div><b><span class="pp-cnt">0</span>${u(bar)}</b></div></div>` : ''}`;
      void panel.offsetWidth;
      panel.classList.add('on');
      // count up (ease-out cubic over 1.2 s), text written at most 20 times a second
      const targets = stats.slice(0, 2).map(x => +x.value || 0).concat(bar ? [+bar.after || 0] : []);
      const decs = targets.map(v => Math.min(2, (String(v).split('.')[1] || '').length));
      const spans = all('.pp-panel .pp-cnt');
      const t0 = Date.now() + 300;
      const off = onTick(now => {
        const k = Math.min(1, Math.max(0, (now - t0) / 1200)), e = 1 - Math.pow(1 - k, 3);
        spans.forEach((sp, j) => setText(sp, (targets[j] * e).toFixed(decs[j])));
        if (k >= 1) off();
      });
      offs.push(off);
    });
  }

  function runTalk() {
    const lns = all('.pp-ln'), track_ = q('.pp-ly'), shots = all('.pp-s6');
    const words = lns.map(l => Array.prototype.slice.call(l.querySelectorAll('span')));
    const est = l => 0.36 * String(l.text).split(/\s+/).length + 0.5; // seconds to say a line
    let starts = [];
    lines.forEach((l, i) => { starts[i] = typeof l.at === 'number' ? l.at : i ? starts[i - 1] + est(lines[i - 1]) : 0; });
    const total = () => starts[starts.length - 1] + est(lines[lines.length - 1]);
    let audio = null, resume = false;
    const t0 = Date.now();
    let clockFrom = t0;
    if (w.audio) {
      audio = ev._audio || voiceClip(w.audio);
      resume = !track.paused; // ponytail: radio.js doesn't export `wanted`; !paused is the closest public signal
      if (resume) { duck(true); q('.pp-music').classList.add('on'); } // softened, not stopped
      const fallback = () => { if (!audio) return; clockFrom = Date.now() - audio.currentTime * 1000; audio = null; };
      audio.addEventListener('loadedmetadata', () => {
        // no timings given: spread the lines over the clip by their length
        if (lines.every(l => typeof l.at !== 'number') && isFinite(audio.duration)) {
          const k = audio.duration / total();
          starts = starts.map(s => s * k);
        }
      });
      audio.addEventListener('ended', () => at(2000, end));
      audio.addEventListener('error', fallback);
      audio.play().catch(fallback);
    }
    let cur = -1, word = -1;
    const off = onTick(now => {
      const t = audio ? audio.currentTime : (now - clockFrom) / 1000;
      if (!audio && t > total() + 2.5) { off(); end(); return; }
      let i = 0;
      while (i + 1 < starts.length && t >= starts[i + 1]) i++;
      const len = (i + 1 < starts.length ? starts[i + 1] : starts[i] + est(lines[i])) - starts[i];
      const wi = Math.min(words[i].length - 1, Math.floor(((t - starts[i]) / len) * words[i].length));
      if (i !== cur) {
        cur = i;
        word = -2;
        lns.forEach((l, k) => { l.className = 'pp-ln' + (k === i ? ' cur' : Math.abs(k - i) === 1 ? ' near' : ''); });
        const ln = lns[i];
        track_.style.transform = `translateY(${Math.round(168 - ln.offsetTop - ln.offsetHeight / 2)}px)`;
        shots.forEach((s, k) => s.classList.toggle('on', k === lineImg[i]));
      }
      if (wi !== word) {
        word = wi;
        words[i].forEach((s, k) => { s.className = k < wi ? 'said' : k === wi ? 'now' : ''; });
      }
    });
    offs.push(off);
    offs.push(() => {
      if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
      audio = null;
      if (resume) duck(false);
    });
  }

  // pill drops in, unfolds into the sheet, then the content runs
  void root.offsetWidth;
  root.classList.add('in');
  at(1200, () => root.classList.add('grow'));
  at(1500, () => root.classList.add('pill-off'));
  at(1700, () => {
    root.classList.add('go');
    if (kind === 'talk') runTalk();
    else runSlides(SLIDE_MS[kind === 'show' ? 'show' : 'card'], kind === 'show' ? showPanel : null);
  });
  p.onKey = a => {
    if (a === 'back' || a === 'enter') finish(p);
    return true; // modal: nothing behind it reacts while it's up
  };
  p.close = closer(root, () => {
    timers.forEach(clearTimeout);
    offs.forEach(f => f());
    root.classList.remove('grow');
  });
  return p;
}

// ---------- scheduling ----------
const OPEN = { question: openQuestion, done: openDone, image: openImage, wrapup: openWrapup, working: openWorking, message: openMessage };
const queue = [];          // transient pop-ups, one at a time
const working = new Map(); // id -> latest working event; the newest shows when nothing else does
let cur = null;

function open(ev) {
  return (OPEN[ev.kind] || openQuestion)(ev);
}

// One pop-up on screen at a time: the next one waits until the last has fully gone.
let gateUntil = 0;
let pumpTimer = 0;
function closeCurrent() {
  if (cur) cur.close();
  cur = null;
  gateUntil = Date.now() + 480; // the exit animation takes ~400 ms
}
function pump() {
  if (cur && !cur.working) return;
  const wait = gateUntil - Date.now();
  if (wait > 0) { clearTimeout(pumpTimer); pumpTimer = setTimeout(pump, wait + 10); return; }
  if (queue.length) {
    if (cur) { closeCurrent(); pump(); return; }
    cur = open(queue.shift());
    return;
  }
  let w = null;
  working.forEach(v => { w = v; });
  if (cur && w && cur.ev.id === w.id) return;
  if (cur) { closeCurrent(); pump(); return; }
  cur = w ? open(w) : null;
}

function finish(p) {
  if (cur !== p) return;
  closeCurrent();
  p.close();
  pump();
}

// On the lockscreen, each new pop-up gets a short sound (the music dips under it).
// Progress updates to a pop-up that's already showing stay silent.
function chime(ev) {
  if (ev.kind === 'clear' || !document.querySelector('.screen.lock:not(.hidden)')) return;
  if (ev.kind === 'working' && working.has(ev.id == null ? 'working' : ev.id)) return;
  playAlertSound(soundFor(ev), ev.source);
}

// The shared working icon (top-right, under the header): one icon for every task the
// sessions on the Mac are working on, with the count. The relay sends the true count;
// pills seen here count too, so the number is right even before the relay's update.
// Claude and Codex/GPT each get their own icon; when both are busy they sit side by side.
let activeBy = { claude: 0, gpt: 0 };
let relayTasks = [];
const docks = {};
// Each busy assistant gets a group in one row: its icon, then a short label that cycles through
// its task names every 5 s with a shimmer. Claude's group comes first, Codex's right after it.
let dockRow = null;
const labels = {};      // src -> { el, timer, i }
function taskLabels(src) {
  const fromRelay = relayTasks.filter(t => t.source === src).map(t => t.label);
  if (fromRelay.length) return fromRelay;
  return [...working.values()].filter(e => (e.source === 'gpt' ? 'gpt' : 'claude') === src).map(e => e.step || e.text || e.title || 'Working');
}
function updateLabel(src, on) {
  let L = labels[src];
  if (!on) { if (L) { L.el.classList.remove('on'); clearInterval(L.timer); L.timer = 0; } return; }
  if (!L) {
    L = labels[src] = { el: document.createElement('div'), timer: 0, i: -1 };
    L.el.className = 'pp-dock-label pp-dock-label-' + src;
    L.el.innerHTML = '<span></span>';
    docks[src].after(L.el);
    void L.el.offsetWidth;
  }
  L.el.classList.add('on');
  const show = () => {
    const list = taskLabels(src).filter(Boolean);
    if (!list.length) return;
    L.i = (L.i + 1) % list.length;
    const span = L.el.firstChild;
    const text = (list.length > 1 ? (L.i + 1) + '/' + list.length + '  ' : '') + list[L.i];
    if (span.textContent === text) return;
    span.classList.remove('in');
    void span.offsetWidth;
    span.textContent = text;
    span.classList.add('in');
  };
  if (!L.timer) { L.i = -1; show(); L.timer = setInterval(show, 5000); }
}

function updateDock() {
  let slot = 0;
  const shown = [];
  for (const src of ['claude', 'gpt']) {
    const mine = [...working.values()].filter(e => (e.source === 'gpt' ? 'gpt' : 'claude') === src);
    // A pill still on screen (not yet collapsed into the icon) isn't counted yet: the icon
    // appears, or its number goes up, only when that pill lands.
    const inFlight = mine.filter(e => !e.collapsedOnce).length;
    const n = Math.max(0, Math.max(activeBy[src] || 0, mine.length) - inFlight);
    let d = docks[src];
    if (!d && n) {
      d = docks[src] = document.createElement('div');
      d.className = 'pp-dock pp-dock-' + src;
      d.innerHTML = `<i class="pp-mini-ring"></i><img src="${BRAND[src].icon}" alt=""><b class="pp-count"></b>`;
      if (!dockRow) { dockRow = document.createElement('div'); dockRow.className = 'pp-docks'; document.body.appendChild(dockRow); }
      // Claude first, Codex after it.
      if (src === 'claude') dockRow.prepend(d); else dockRow.appendChild(d);
      void d.offsetWidth;
    }
    if (!d) continue;
    const count = d.querySelector('.pp-count');
    if (count.textContent !== String(n)) {
      const grew = n > Number(count.textContent || 0);
      count.textContent = String(n); count.classList.remove('bump'); void count.offsetWidth; count.classList.add('bump');
      // the pill has just landed: a very subtle snap-shake
      if (grew && d.classList.contains('on')) { d.classList.remove('snap'); void d.offsetWidth; d.classList.add('snap'); }
    }
    d.classList.toggle('on', n > 0);
    // Claude takes the rightmost slot; Codex sits just left of it (or rightmost if alone).
    d.style.setProperty('--slot', n > 0 ? slot++ : 0);
    if (n > 0) shown.push(src);
    updateLabel(src, n > 0);
  }
  document.documentElement.style.setProperty('--docks', shown.length);
  if (dockRow) dockRow.classList.toggle('two', shown.length > 1);
}

export function showPill(ev) {
  if (!ev || !ev.kind) return;
  if (ev.kind === 'music') { musicCommand(ev); return; } // from the Mac menu-bar remote
  if (ev.kind === 'count') {
    activeBy = ev.by || { claude: Math.max(0, ev.n | 0), gpt: 0 };
    relayTasks = Array.isArray(ev.tasks) ? ev.tasks : [];
    updateDock();
    return;
  }
  // Spoken updates: fetch and decode the voice first (≤ 2.5 s), so pill and voice start together.
  if (ev.wrapup && ev.wrapup.audio && !ev._audio) {
    ev._audio = voiceClip(ev.wrapup.audio);
    Promise.race([ev._audio.ready, sleep(2500)]).then(() => showPill(ev));
    return;
  }
  chime(ev);
  const id = ev.id;
  if (ev.kind === 'clear') {
    if (id == null) return;
    working.delete(id);
    updateDock();
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].id === id) queue.splice(i, 1);
    if (cur && cur.ev.id === id) finish(cur); else pump();
    return;
  }
  if (ev.kind === 'working') {
    const key = id == null ? 'working' : id;
    const prev = working.get(key);
    ev = Object.assign({}, ev, { id: key, startedAt: ev.startedAt || (prev && prev.startedAt) || Date.now(), collapsedOnce: !!(prev && prev.collapsedOnce) });
    working.delete(key); // re-insert so the most recently updated one is "newest"
    working.set(key, ev);
    if (cur && cur.working && cur.ev.id === key) cur.update(ev);
    else pump();
    return;
  }
  if (id != null) {
    const w = working.get(id);
    if (w) { // e.g. done replacing its working pill: keep its start for "Finished in"
      working.delete(id);
      updateDock();
      if (!ev.startedAt) ev = Object.assign({}, ev, { startedAt: w.startedAt });
    }
    if (cur && cur.ev.id === id) { queue.unshift(ev); finish(cur); return; }
  }
  queue.push(ev);
  pump();
}

// Offer remote keys here first. True = an image or wrap-up pop-up used the key.
export function pillOnKey(action) {
  return !!(cur && cur.onKey && cur.onKey(action));
}

export async function startPills() {
  if (!NOTIFY_HOST) return;
  for (;;) {
    try {
      const res = await fetch('http://' + NOTIFY_HOST + '/events');
      for (const n of await res.json()) showPill(n);
    } catch (e) {
      await sleep(5000); // Mac asleep or relay down: keep trying quietly
    }
  }
}

// Dev: one of each state in sequence (about 2.5 minutes in all).
window.__pillDemo = async () => {
  const pic = n => 'https://picsum.photos/1600/900?random=' + n;
  const plan = now => ['Read the idle screen code', 'Swap in a lighter ticker', 'Run the fps bench', 'Check it on the TV']
    .map((label, i) => ({ label, state: i < now ? 'done' : i === now ? 'now' : 'next' }));
  const work = (now, extra) => showPill(Object.assign({ id: 'demo-w', kind: 'working', title: 'Lighter news ticker', step: plan(now)[now].label, plan: plan(now), startedAt: Date.now() - 84000 }, extra));
  showPill({ kind: 'question', title: 'Claude has a question', text: 'Run it against the staging database first?' });
  await sleep(10000);
  work(0);
  await sleep(3500); work(1);
  await sleep(3500);
  showPill({ id: 'demo-g', source: 'gpt', kind: 'working', title: 'Lighter news ticker', step: 'Run the fps bench', plan: plan(2), startedAt: Date.now() - 84000 });
  await sleep(4000); showPill({ id: 'demo-g', kind: 'clear' });
  await sleep(1500); work(2);
  await sleep(3000);
  showPill({ id: 'demo-w', kind: 'done', title: 'Lighter news ticker', project: 'samsucks/app',
    text: 'Swapped the ticker for a lighter version. The idle screen is back to 54 fps.', highlight: 'The idle screen is back to 54 fps.' });
  showPill({ kind: 'image', title: 'Idle screen redesign', text: 'New layout is live in the dev build', project: 'samsucks/app', image: pic(1) });
  showPill({ kind: 'wrapup', title: 'Project finished', project: 'samsucks/app', startedAt: Date.now() - 8040000, highlight: 'Idle holds 54 fps and Home 51 fps.',
    wrapup: { mode: 'show', title: 'SamSUCKS frontend redesign', summary: 'New idle screen, Home, boot and pop-ups are live on the TV. Idle holds 54 fps and Home 51 fps.',
      points: ['Idle screen and news', 'Home and app rows', 'Boot, volume and pop-ups'],
      slides: [{ image: pic(2), caption: 'New idle screen' }, { image: pic(3), caption: 'Boot animation' }, { image: pic(4), caption: 'Home and app rows' }] } });
  showPill({ kind: 'wrapup', project: 'samsucks/app', startedAt: Date.now() - 8040000,
    wrapup: { mode: 'show', title: 'SamSUCKS frontend redesign', slides: [
      { image: pic(5), caption: 'Boot animation', stats: [{ label: 'Length', value: 3.4, unit: 's' }, { label: 'Boot frame rate', value: 60, unit: 'fps', before: 22, after: 60 }] },
      { image: pic(6), caption: 'Phone remote', stats: [{ label: 'Tap latency', value: 40, unit: 'ms', before: 180, after: 40 }, { label: 'Buttons', value: 6 }] },
      { image: pic(7), caption: 'Idle and Home', stats: [{ label: 'Idle frame rate', value: 54, unit: 'fps', before: 6, after: 54 }, { label: 'Home', value: 51, unit: 'fps' }] }] } });
  showPill({ kind: 'wrapup', startedAt: Date.now() - 8040000,
    wrapup: { mode: 'talk', title: 'SamSUCKS frontend redesign', points: ['Idle screen and news', 'Home and app rows', 'Boot, volume and pop-ups'], lines: [
      { text: 'New idle screen,', image: pic(8) }, { text: 'Home, boot and pop-ups', image: pic(9) },
      { text: 'are live on the TV.', image: pic(10) }, { text: 'Idle holds 54 fps.', image: pic(8) }] } });
};

// Lockscreen (design 2c): what the TV shows at power-on and when idle.
// Big clock + date + weather, now-playing chip, a story that crossfades every 14 s
// (headline, summary, image, key points), a timer line to the next story, and the
// phone-remote QR. ← → flip stories, Play/Pause pauses the music, any other key opens Home.
import qrcode from '../vendor/qrcode.js';
import { h, setText } from '../util/dom.js';
import { togglePause } from '../ui/radio.js';
import { stories, sized, savedStories, words, similar } from '../ui/news.js';
import { weather } from '../ui/weather.js';
import { remoteUrl, laptopUrl } from '../ui/remote.js';
import { nowPlayingChip } from '../ui/nowplaying.js';
import { pref, PACE } from '../util/prefs.js';
import { openPicker } from '../ui/musicpicker.js';


// Stories already shown (survives restarts): [{ t: headline, w: [key words], at: ms }]. A story
// you've seen, or the same story from another outlet, stays out for ~20 h, then may come back.
const SEEN_KEY = 'ss.seenStories';
const SEEN_TTL = 20 * 3600000;
let seen = [];
try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]').filter(x => x && x.t && Date.now() - x.at < 48 * 3600000); } catch (e) {}
const wordsOf = new Map();
const keyWords = t => { if (!wordsOf.has(t)) wordsOf.set(t, words(t)); return wordsOf.get(t); };
// When this story (or a near-identical one) was last shown, or 0.
export function seenAt(text, list = seen) {
  const w = keyWords(text);
  let at = 0;
  for (const x of list) if (x.t === text || similar(w, new Set(x.w))) at = Math.max(at, x.at);
  return at;
}
function markSeen(text) {
  seen = seen.filter(x => x.t !== text);
  seen.push({ t: text, w: [...keyWords(text)], at: Date.now() });
  if (seen.length > 500) seen = seen.slice(-500);
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) {}
}
// New-to-you stories first (keeping the feed's mix), then ones seen over ~20 h ago, oldest first.
// Stories seen more recently than that are left out unless there'd be almost nothing to show.
export function unseenFirst(list, seenList = seen) {
  const tagged = list.map(x => ({ x, at: seenAt(x.text, seenList) }));
  const fresh = tagged.filter(e => !e.at).map(e => e.x);
  const old = tagged.filter(e => e.at && Date.now() - e.at > SEEN_TTL).sort((a, b) => a.at - b.at).map(e => e.x);
  const recent = tagged.filter(e => e.at && Date.now() - e.at <= SEEN_TTL).sort((a, b) => a.at - b.at).map(e => e.x);
  const out = fresh.concat(old);
  return out.length >= 8 ? out : out.concat(recent);
}

// Key points are shown whole, never cut off: keep only as many as fit the panel
// (about 56 characters a line in the big window, 9 lines in all).
export function fitPoints(points, perLine = 64, maxLines = 6) { // points under the headline, photo beside them
  const out = [];
  let lines = 0;
  for (const p of points) {
    const need = Math.ceil(p.length / perLine);
    if (need > 3 || lines + need > maxLines) continue;
    out.push(p);
    lines += need;
    if (out.length === 3) break;
  }
  return out.length >= 3 ? out : []; // three solid points, or none at all
}

// Quoted phrases in a headline (‘…’, “…”, "…") get their own color. Apostrophes
// (Apple’s) are left alone: a quote must open after a space and close before one.
export function quoteHtml(text) {
  const esc = String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // Double quotes may hold apostrophes (“We’re…”); single quotes close at ’ before a space/punctuation.
  return esc.replace(/(^|[\s(—–-])([“"])([^“”"]{2,}?)([”"])(?=[\s,.:;!?)—–-]|$)/g, '$1<span class="lock-q">$2$3$4</span>')
    .replace(/(^|[\s(—–-])(‘)(.{2,}?)(’)(?=[\s,.:;!?)—–-]|$)/g, (m, a, o, x, c) => /lock-q/.test(x) ? m : a + '<span class="lock-q">' + o + x + c + '</span>');
}

// A headline that IS a quote: it opens with a quote that runs for at least 30% of it
// (“We will not back down,” senator says). A title in quotes (‘Stick’ season 2) isn't one.
const LEAD_QUOTE = /^[“‘"](.{2,}?)([”’"])(?=[\s,.:;!?—–-]|$)([\s\S]*)$/;
export function isQuoteHeadline(t) {
  const m = String(t).match(LEAD_QUOTE);
  return !!m && m[1].length / String(t).length >= 0.3;
}
// The big decorative mark stands in for the opening quote; the quoted words are bright, the
// attribution after them dimmed (by CSS).
export function quoteHeadlineHtml(t) {
  const m = String(t).match(LEAD_QUOTE);
  const esc = x => x.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return '<span class="lock-q">' + esc(m[1]) + (m[2] === '’' ? '’' : '”') + '</span>' + quoteHtml(m[3]);
}

export function clockText(d) {
  const h24 = pref('clock24');
  const hrs = h24 ? String(d.getHours()).padStart(2, '0') : d.getHours() % 12 || 12;
  return { h: String(hrs), m: String(d.getMinutes()).padStart(2, '0'), ampm: h24 ? '' : d.getHours() < 12 ? 'AM' : 'PM',
    day: d.toLocaleDateString('en-US', { weekday: 'long' }), date: d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) };
}

export function weatherIcon(parent, kind) {
  const el = h('div', 'wx wx--' + kind, parent);
  h('i', 'wx-sun', el); h('i', 'wx-cloud', el); h('i', 'wx-drops', el);
  return el;
}

export function IdleScreen({ onOpen }) {
  const el = h('div', 'screen lock');
  // Background: a dark sky. Three star layers twinkle out of step and a faint Hubble nebula
  // (Settings → Lockscreen background) drifts slowly. Only opacity/transform animate.
  const sky = h('div', 'lock-sky', el);
  const neb = h('img', 'lock-neb', sky);
  [1, 2, 3].forEach(n => { h('img', 'lock-stars s' + n, sky).src = 'media/space/stars-' + n + '.png'; });
  const setBg = () => {
    const k = ['bubble', 'n11', 'pillars', 'carina', 'stars'].includes(pref('bgLoop')) ? pref('bgLoop') : 'bubble';
    neb.style.display = k === 'stars' ? 'none' : '';
    const f = 'media/space/neb-' + k + '.jpg';
    if (k !== 'stars' && !neb.src.endsWith(f)) neb.src = f;
  };
  h('div', 'lock-shade', el);

  // Top: clock | day/date | weather ............ now playing
  const top = h('div', 'lock-top', el);
  const left = h('div', 'lock-top-left', top);
  const clock = h('div', 'lock-clock', left);
  const hh = h('span', '', clock); h('span', 'lock-colon', clock).textContent = ':'; const mm = h('span', '', clock);
  h('div', 'lock-rule', left);
  const dayBox = h('div', 'lock-day', left);
  const day = h('div', 'lock-dayname', dayBox);
  const date = h('div', 'lock-date', dayBox);
  const wxRule = h('div', 'lock-rule dim', left);
  const wx = h('div', 'lock-wx', left);
  let wxIcon = null;
  const wxTemp = h('div', 'lock-temp', wx);
  const wxWords = h('div', 'lock-wx-words', wx);
  const wxLabel = h('div', 'lock-wx-label', wxWords);
  const wxHiLo = h('div', 'lock-wx-hilo', wxWords);
  const chip = nowPlayingChip(top, 'large');

  // Story: text on the left, image + key points on the right.
  const story = h('div', 'lock-story', el);
  const srcRow = h('div', 'lock-src', story);
  const srcLogo = h('img', 'lock-src-logo', srcRow);
  const srcName = h('span', '', srcRow);
  const srcAgo = h('span', 'lock-src-ago', srcRow);
  // Ground News-style coverage: how many outlets ran it and their Left / Center / Right split.
  const bias = h('div', 'lock-bias', el);
  const biasBar = h('div', 'lock-bias-bar', bias);
  const segs = ['L', 'C', 'R'].map(k => h('i', 'seg-' + k, biasBar));
  const biasText = h('div', 'lock-bias-text', bias);
  const headline = h('div', 'lock-headline', story);
  // The same headline in Grift Medium, dimmed: crossfaded in when the key points arrive.
  const lite = h('div', 'lock-lite', story);
  const dek = h('div', 'lock-dek', story);
  const pts = h('div', 'lock-points', story);
  const ptsList = h('div', 'lock-points-list', pts);
  // Photo card on the right: its shape follows the photo (16:9, 3:2, 4:3, 1:1 or 4:5) so nothing
  // is cropped badly. Two layers for gallery crossfades, plus a muted clip when the feed has one.
  const side = h('div', 'lock-side', el);
  const sideImgs = [h('img', 'on', side), h('img', '', side)];
  const sideVid = h('video', '', side);
  sideVid.muted = true; sideVid.loop = true; sideVid.setAttribute('playsinline', '');
  sideVid.onerror = () => side.classList.remove('clip');
  let galleryTimer = 0;

  // Bottom: timer to the next story ........ phone remote
  const bottom = h('div', 'lock-bottom', el);
  const next = h('div', 'lock-next', bottom);
  const bar = h('div', 'lock-bar', next);
  const barFill = h('i', '', bar);
  const nextText = h('div', 'lock-next-text', next);
  h('span', 'lock-next-label', nextText).textContent = 'Next';
  const nextTitle = h('span', 'lock-next-title', nextText);
  const url = remoteUrl();
  if (url) {
    const qrChip = h('div', 'lock-qr', bottom);
    const box = h('div', 'lock-qr-box', qrChip);
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    h('div', 'lock-qr-words', qrChip).innerHTML = '<b>Remote</b><span>Scan with your phone</span><em>Laptop: AirDrop it from your phone</em>';
  }

  let list = [];
  let index = 0;
  let timers = [];
  let storyTimer = 0;
  let pointsTimer = 0;
  // Load and decode an image off-screen so the swap never stalls a frame.
  function ready(url) {
    return new Promise(resolve => {
      if (!url) return resolve(false);
      const img = new Image();
      img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(img));
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // Card shape from the photo's own proportions, snapped to a few standard ratios.
  function fitCard(img) {
    const r = img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 16 / 9;
    const ratio = [16 / 9, 3 / 2, 4 / 3, 1, 4 / 5].reduce((a, b) => Math.abs(b - r) < Math.abs(a - r) ? b : a);
    const W = 640, H = 460;
    side.style.width = Math.round(ratio >= W / H ? W : H * ratio) + 'px';
    side.style.height = Math.round(ratio >= W / H ? W / ratio : H) + 'px';
  }

  // Where everything sits, measured once per story while the points are still invisible.
  //  Photo phase: the bold headline block is centred on the photo card's middle line.
  //  Points phase: the light headline + points block and the card are both centred on y=580.
  let cardTo = '';
  function layout() {
    const G = 56;                                         // light headline → first point
    const hasCard = !el.classList.contains('noimg');
    const cardH = hasCard ? side.offsetHeight : 0;
    pts.style.height = '';
    lite.style.top = headline.offsetTop + 'px';
    pts.style.top = (headline.offsetTop + lite.offsetHeight + G) + 'px';
    const tail = 8;                                       // last line's descender space
    // Block = source line (stays, dimmed) → light headline → last point.
    const textH = () => headline.offsetTop + lite.offsetHeight + G + pts.offsetHeight - tail;
    while (ptsList.children.length > 2 && textH() > 560) ptsList.lastChild.remove();
    // Text block (light headline's letters → last point) and photo card share one middle line.
    // The card stays put; with no photo the text centres on y=580.
    const mid = hasCard ? 350 + cardH / 2 : 580, tH = textH();
    cardTo = '';
    el.style.setProperty('--story-shift', Math.round(mid - tH / 2 - 350) + 'px');
    el.style.setProperty('--card-shift', '0px');
    el.style.setProperty('--story-shift0', hasCard ? Math.max(-60, Math.round((cardH - story.offsetHeight) / 2)) + 'px' : '0px');
  }

  // Card photos for a story: three for a gallery (3+ photos), otherwise the lead photo.
  const shotsOf = st => { const p = ((st && st.imgs && st.imgs.length) ? st.imgs : [st && st.img]).filter(Boolean); return (p.length >= 3 ? p.slice(0, 3) : p.slice(0, 1)).map(u => sized(u, 1280)); };
  // Decoded photos kept for the change-over (the next story's is fetched during this one).
  const pre = new Map();
  function preloaded(url) {
    if (!url) return Promise.resolve(null);
    if (!pre.has(url)) { pre.set(url, ready(url)); if (pre.size > 6) pre.delete(pre.keys().next().value); }
    return pre.get(url);
  }

  let token = 0;
  async function show(i) {
    if (!list.length) return;
    const my = ++token;
    // End of the list: re-order (new stories first, then the least recently seen) instead of
    // looping straight back to stories from half an hour ago.
    if (i >= list.length) { list = unseenFirst(list); i = 0; }
    index = (i + list.length) % list.length;
    const s = list[index];
    // Fewer lines when the coverage strip is showing, so points never reach it.
    const covd = s.coverage && (s.coverage.L + s.coverage.C + s.coverage.R) >= 2 && s.coverage.total >= 2;
    const points = fitPoints(s.points, 54, 6);
    const pics = points.length;
    // Change-over: the old story and its photo fade out together (~0.35 s) while the new photo
    // finishes loading (it was preloaded during the previous story, so usually it's ready).
    // A photo that still isn't ready after ~1.2 s is skipped: the story shows without one rather
    // than the photo popping in late.
    let shots = shotsOf(s);
    const wasIn = el.classList.contains('in');
    if (wasIn) el.classList.add('out');
    const [first] = await Promise.all([
      Promise.race([preloaded(shots[0]), new Promise(r => setTimeout(() => r(null), 1200))]),
      new Promise(r => setTimeout(r, wasIn ? 380 : 0)),
    ]);
    if (my !== token) return; // flipped again while loading
    if (!first) shots = [];
    const hasImg = shots.length > 0;
    const pace = PACE[pref('storyPace')] || 1; // Settings → Story pace
    // Headline time before the points: ~8 s, or ~3.4 s per photo for a gallery.
    const lead = (shots.length > 1 ? shots.length * 3400 : hasImg ? 8500 : 4000) * pace;
    const total = lead + (1000 + pics * 5200) * pace;
    el.classList.add('swap');                       // no transitions while the content is replaced
    el.classList.remove('in', 'points', 'noimg', 'out');
    void el.offsetWidth;
    srcLogo.src = s.logo;
    setText(srcName, s.src);
    setText(srcAgo, '· ' + s.ago);
    const cov = s.coverage;
    const rated = cov ? cov.L + cov.C + cov.R : 0;
    el.classList.toggle('has-bias', !!cov && cov.total >= 2 && rated >= 2);
    if (cov && rated >= 2) {
      const pct = k => Math.round(cov[k] / rated * 100);
      ['L', 'C', 'R'].forEach((k, n) => { segs[n].style.width = pct(k) + '%'; segs[n].style.display = cov[k] ? '' : 'none'; });
      biasText.innerHTML = '<b>' + cov.total + ' outlets</b>' + ['L', 'C', 'R'].filter(k => cov[k]).map(k => '<span class="t-' + k + '">' + { L: 'Left', C: 'Center', R: 'Right' }[k] + ' ' + pct(k) + '%</span>').join('');
    }
    const isQuote = isQuoteHeadline(s.text);
    el.classList.toggle('quote', isQuote);
    // Quote headlines: the big decorative mark replaces the opening one in the text.
    headline.innerHTML = isQuote ? quoteHeadlineHtml(s.text) : quoteHtml(s.text);
    lite.innerHTML = headline.innerHTML;
    markSeen(s.text);
    setText(dek, s.dek);
    // Smaller type for longer headlines, so a headline always fits whole.
    el.classList.toggle('long', s.text.length > 60 && s.text.length <= 95);
    el.classList.toggle('longer', s.text.length > 95);
    clearInterval(galleryTimer);
    if (hasImg) {
      fitCard(first);
      sideImgs[0].src = shots[0]; sideImgs[0].classList.add('on'); sideImgs[1].classList.remove('on'); sideImgs[1].removeAttribute('src');
      let g = 0;
      if (shots.length > 1) galleryTimer = setInterval(() => {
        if (++g >= shots.length) return clearInterval(galleryTimer);
        const next = sideImgs[g % 2], prev = sideImgs[1 - g % 2];
        ready(shots[g]).then(ok => { if (!ok || my !== token) return; next.src = shots[g]; next.classList.add('on'); prev.classList.remove('on'); });
      }, 3400 * pace);
    }
    // A short muted clip from the feed (Politico, MIT Tech Review) plays in the card instead.
    side.classList.toggle('clip', !!s.video);
    if (s.video) { sideVid.src = s.video; sideVid.play().catch(() => side.classList.remove('clip')); }
    else if (sideVid.src) { sideVid.pause(); sideVid.removeAttribute('src'); sideVid.load(); }
    el.classList.toggle('noimg', !hasImg && !s.video);
    el.classList.toggle('nopts', !points.length);
    ptsList.textContent = '';
    points.forEach(p => { const r = h('div', 'lock-point', ptsList); h('i', '', r); h('span', '', r).textContent = p; });
    setText(nextTitle, list[(index + 1) % list.length].text);
    preloaded(shotsOf(list[(index + 1) % list.length])[0]); // decode the next story's photo now
    // Lay the key points out now, hidden, 48px under the (smaller) light headline, so the hand-off
    // later is only fades. Points that would run into the coverage strip / "Next" bar are dropped.
    layout();
    void el.offsetWidth;
    el.classList.remove('swap');
    el.classList.add('in');
    barFill.style.animation = 'none';
    void barFill.offsetWidth;
    barFill.style.animation = 'lock-progress ' + total + 'ms linear forwards';
    clearTimeout(storyTimer);
    clearTimeout(pointsTimer);
    // Hand-off: the subline fades, the headline crossfades to its dimmer light version, then the
    // points rise in one by one, ~2.4 s apart to read. Nothing moves or re-wraps.
    if (pics) pointsTimer = setTimeout(() => {
      clearInterval(galleryTimer);
      if (cardTo) side.style.height = cardTo;
      el.classList.add('points');
      [...ptsList.children].forEach((r, n) => { r.style.transitionDelay = (0.8 + n * 2.4 * pace) + 's'; });
    }, lead);
    storyTimer = setTimeout(() => show(index + 1), total);
  }

  function tickClock() {
    // Weather and date only in the mornings (5–11 am); the rest of the day that space
    // holds the working-task icons (pill.js docks them there via data-morning).
    const hour = new Date().getHours();
    const morning = hour >= 5 && hour < 11;
    el.classList.toggle('morning', morning);
    document.documentElement.dataset.morning = morning ? '1' : '0';
    const c = clockText(new Date());
    setText(hh, c.h); setText(mm, c.m); setText(day, c.day); setText(date, c.date);
  }

  async function tickWeather() {
    const w = await weather();
    const show = !!w;
    wx.style.display = wxRule.style.display = show ? '' : 'none';
    if (!w) return;
    if (wxIcon) wxIcon.remove();
    wxIcon = weatherIcon(wx, w.icon);
    wx.insertBefore(wxIcon, wxTemp);
    setText(wxTemp, w.temp + '°');
    setText(wxLabel, w.label);
    setText(wxHiLo, 'H ' + w.hi + '° · L ' + w.lo + '°');
  }

  async function load() {
    const fresh = await stories();
    if (!fresh.length) return;
    const first = !list.length;
    if (first) list = unseenFirst(fresh, seen);
    else {
      // Refresh: brand-new stories (not seen, not already queued) go straight after the current
      // one, so fresh news shows up within a story or two; the rest of the queue keeps its order.
      const queued = new Set(list.map(x => x.text));
      const brandNew = fresh.filter(x => !queued.has(x.text) && !seenAt(x.text));
      list = list.slice(0, index + 1).concat(brandNew, list.slice(index + 1));
    }
    if (first) show(0);
  }

  return {
    name: 'idle',
    el,
    onShow() {
      tickClock();
      setBg();
      // Open on a story right away from the last batch, while fresh news loads behind it.
      if (!list.length) { const saved = savedStories(); if (saved.length) { list = unseenFirst(saved, seen); show(0); } }
      // First show sits under the boot animation: fetch and parse news only once it's done.
      const delay = document.getElementById('splash') ? 3600 : 0;
      setTimeout(() => { tickWeather(); load(); }, delay);
      if (list.length) show(index);
      timers = [setInterval(tickClock, 10000), setInterval(tickWeather, 20 * 60000), setInterval(load, 10 * 60000)];
    },
    onHide() {
      timers.forEach(clearInterval);
      clearTimeout(storyTimer);
      clearTimeout(pointsTimer);
      clearInterval(galleryTimer);
    },
    destroy() { chip.destroy(); },
    onKey(action) {
      if (action === 'playpause' || action === 'play' || action === 'pause') { togglePause(); return true; }
      // Up highlights the music pill; OK on it opens the station picker.
      if (action === 'up') { chip.el.classList.add('focus'); return true; }
      if (chip.el.classList.contains('focus')) {
        if (action === 'enter') { chip.el.classList.remove('focus'); openPicker(); return true; }
        if (action === 'down' || action === 'back') { chip.el.classList.remove('focus'); return true; }
      }
      if (action === 'left' || action === 'right') { show(index + (action === 'left' ? -1 : 1)); return true; }
      if (action === 'back') return false; // exits the app
      onOpen();
      return true;
    },
  };
}

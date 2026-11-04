// Lockscreen (design 2c): what the TV shows at power-on and when idle.
// Big clock + date + weather, now-playing chip, a story that crossfades every 14 s
// (headline, summary, image, key points), a timer line to the next story, and the
// phone-remote QR. ← → flip stories, Play/Pause pauses the music, any other key opens Home.
import qrcode from '../vendor/qrcode.js';
import { h, setText } from '../util/dom.js';
import { togglePause } from '../ui/radio.js';
import { stories, sized } from '../ui/news.js';
import { weather } from '../ui/weather.js';
import { remoteUrl } from '../ui/remote.js';
import { nowPlayingChip } from '../ui/nowplaying.js';
import { openPicker } from '../ui/musicpicker.js';


// Stories already shown (survives restarts), so a reboot never opens on old news.
const SEEN_KEY = 'ss.seenStories';
let seen = [];
try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch (e) {}
function markSeen(text) {
  if (seen.includes(text)) return;
  seen.push(text);
  if (seen.length > 400) seen = seen.slice(-400);
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) {}
}
// Unseen stories first (keeping the feed's mix order), then the ones you've seen.
export function unseenFirst(list, seenList) {
  const s = new Set(seenList);
  return list.filter(x => !s.has(x.text)).concat(list.filter(x => s.has(x.text)));
}

export function clockText(d) {
  const hrs = d.getHours() % 12 || 12;
  return { h: String(hrs), m: String(d.getMinutes()).padStart(2, '0'), ampm: d.getHours() < 12 ? 'AM' : 'PM',
    day: d.toLocaleDateString('en-US', { weekday: 'long' }), date: d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) };
}

export function weatherIcon(parent, kind) {
  const el = h('div', 'wx wx-' + kind, parent);
  h('i', 'wx-sun', el); h('i', 'wx-cloud', el); h('i', 'wx-drops', el);
  return el;
}

export function IdleScreen({ onOpen }) {
  const el = h('div', 'screen lock');
  const bgs = [h('img', 'lock-bg', el), h('img', 'lock-bg', el)];
  const bgCanvas = h('canvas', 'lock-bg lock-bg-art', el);
  bgCanvas.width = 64;
  bgCanvas.height = 36;
  let bgFront = 0;
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
  const headline = h('div', 'lock-headline', story);
  const dek = h('div', 'lock-dek', story);
  const side = h('div', 'lock-side', el);
  const sideImg = h('img', '', side);
  const pts = h('div', 'lock-points', el);

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
    h('div', 'lock-qr-words', qrChip).innerHTML = '<b>Phone remote</b><span>Scan with your camera</span>';
  }

  let list = [];
  let index = 0;
  let timers = [];
  let storyTimer = 0;
  let pointsTimer = 0;
  const bgUrl = n => 'https://picsum.photos/seed/samsucks' + (n % 12) + '/1920/1080?blur=10';

  // Load and decode an image off-screen so the swap never stalls a frame.
  function ready(url) {
    return new Promise(resolve => {
      if (!url) return resolve(false);
      const img = new Image();
      img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(true));
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  // Cheap blur: draw the photo tiny, let the GPU scale it up to full screen.
  function blurredInto(canvas, url) {
    return new Promise(resolve => {
      const img = new Image();
      // decode() first, off the main thread; drawing an undecoded photo stalls the TV for seconds.
      img.onload = () => (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => {
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(true);
      });
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  let token = 0;
  async function show(i) {
    if (!list.length) return;
    const my = ++token;
    index = (i + list.length) % list.length;
    const s = list[index];
    const pics = s.points.length;
    // Story length: 7 s with the photo, then ~5 s per key point so there's time to read.
    const hasImg = !!s.img;
    const total = (hasImg ? 7000 : 4000) + pics * 5200;
    const useArticleBg = index % 2 === 1 && (s.img2 || s.img);
    const side = sized(s.img, 640, 360);
    await Promise.all([ready(side), useArticleBg ? blurredInto(bgCanvas, sized(s.img2 || s.img, 128, 72)) : ready(bgUrl(index))]);
    if (my !== token) return; // flipped again while loading
    el.classList.remove('in', 'points', 'noimg');
    void el.offsetWidth;
    srcLogo.src = s.logo;
    setText(srcName, s.src);
    setText(srcAgo, '· ' + s.ago);
    setText(headline, s.text);
    markSeen(s.text);
    setText(dek, s.dek);
    el.classList.toggle('long', s.text.length > 70);
    if (hasImg) sideImg.src = side;
    el.classList.toggle('noimg', !hasImg);
    pts.textContent = '';
    s.points.forEach(p => { const r = h('div', 'lock-point', pts); h('i', '', r); h('span', '', r).textContent = p; });
    setText(nextTitle, list[(index + 1) % list.length].text);
    // Background: every other story uses a blurred photo from the article itself.
    if (useArticleBg) { bgCanvas.classList.add('on'); bgs.forEach(b => b.classList.remove('on')); }
    else {
      const back = bgs[1 - bgFront];
      back.src = bgUrl(index);
      back.classList.add('on'); bgs[bgFront].classList.remove('on'); bgFront = 1 - bgFront;
      bgCanvas.classList.remove('on');
    }
    el.classList.add('in');
    barFill.style.animation = 'none';
    void barFill.offsetWidth;
    barFill.style.animation = 'lock-progress ' + total + 'ms linear forwards';
    clearTimeout(storyTimer);
    clearTimeout(pointsTimer);
    // After the photo has had its moment, fade it out, then bring the points in one by one.
    if (pics) pointsTimer = setTimeout(() => {
      el.classList.add('points');
      [...pts.children].forEach((r, n) => { r.style.transitionDelay = (0.9 + n * 4.2) + 's'; });
    }, hasImg ? 6000 : 1500);
    storyTimer = setTimeout(() => show(index + 1), total);
  }

  function tickClock() {
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
    list = unseenFirst(fresh, seen);
    if (first) show(0);
  }

  return {
    name: 'idle',
    el,
    onShow() {
      tickClock();
      tickWeather();
      load();
      if (list.length) show(index);
      timers = [setInterval(tickClock, 10000), setInterval(tickWeather, 20 * 60000), setInterval(load, 15 * 60000)];
    },
    onHide() {
      timers.forEach(clearInterval);
      clearTimeout(storyTimer);
      clearTimeout(pointsTimer);
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

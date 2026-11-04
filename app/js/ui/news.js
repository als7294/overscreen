// Stories for the lockscreen and Home, from three groups of feeds:
//   tech  The Verge, Ars Technica, Engadget, TechCrunch
//   ai    Verge AI, Ars AI, TechCrunch AI, MIT Technology Review
//   edm   UKF, EDM Identity, EDMTunes, Dancing Astronaut   (bass / EDM, now and then)
// They're interleaved tech, ai, tech, ai, edm (newest first within each group), up to 80
// stories, so a lap takes ~20 minutes and the feeds refresh every 15. Photos are optional.
// Deals, gift guides, podcasts and other filler are dropped. Hacker News is the fallback.
import { warn } from '../util/log.js';

const FAVICON = d => 'https://www.google.com/s2/favicons?sz=128&domain=' + d;
const FILLER = /\b(deals?|% off|sale|save \$|discount|coupon|gift guide|best .{0,30}(to buy|for \d{4}|gifts?)|podcast|vergecast|newsletter|installer|quiz|giveaway|sponsored|how to watch|live ?blog|week in review|today only|lowest price|preorder now|promo code)\b/i;
const MAX = 80;
const PATTERN = ['tech', 'ai', 'tech', 'ai', 'edm'];

const FEEDS = [
  ['tech', 'The Verge', 'theverge.com', 'https://www.theverge.com/rss/index.xml'],
  ['tech', 'Ars Technica', 'arstechnica.com', 'https://feeds.arstechnica.com/arstechnica/index'],
  ['tech', 'Engadget', 'engadget.com', 'https://www.engadget.com/rss.xml'],
  ['tech', 'TechCrunch', 'techcrunch.com', 'https://techcrunch.com/feed/'],
  ['ai', 'The Verge', 'theverge.com', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml'],
  ['ai', 'Ars Technica', 'arstechnica.com', 'https://arstechnica.com/ai/feed/'],
  ['ai', 'TechCrunch', 'techcrunch.com', 'https://techcrunch.com/category/artificial-intelligence/feed/'],
  ['ai', 'MIT Tech Review', 'technologyreview.com', 'https://www.technologyreview.com/topic/artificial-intelligence/feed/'],
  ['edm', 'UKF', 'ukf.com', 'https://ukf.com/feed/'],
  ['edm', 'EDM Identity', 'edmidentity.com', 'https://edmidentity.com/feed/'],
  ['edm', 'EDMTunes', 'edmtunes.com', 'https://www.edmtunes.com/feed/'],
  ['edm', 'Dancing Astronaut', 'dancingastronaut.com', 'https://dancingastronaut.com/feed/'],
];

let cache = null;
let cachedAt = 0;

export function ago(date) {
  const m = Math.max(1, Math.round((Date.now() - date) / 60000));
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  return h < 24 ? h + ' hr ago' : Math.round(h / 24) + 'd ago';
}

// Whole sentences of real length, for the summary and the key points.
export function sentences(text, n) {
  return (text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+["”’)]?(\s|$)/g) || [])
    .map(s => s.trim()).filter(s => s.length > 40 && s.length < 220).slice(0, n);
}

export function isWorthIt(s) {
  return s.text.length >= 30 && s.text.split(' ').length >= 5 && !FILLER.test(s.text);
}

// tech, ai, tech, ai, edm … each group newest first; a group that runs out is skipped.
export function interleave(groups, pattern, max) {
  const out = [];
  const at = {};
  while (out.length < max && pattern.some(g => (groups[g] || []).length > (at[g] || 0))) {
    for (const g of pattern) {
      const list = groups[g] || [];
      if ((at[g] || 0) < list.length && out.length < max) out.push(list[at[g] = (at[g] || 0) + 1, at[g] - 1]);
    }
  }
  return out;
}

const html = text => new DOMParser().parseFromString(text || '', 'text/html');
const decode = t => html(t).body.textContent; // titles arrive escaped (&#8216; …)
const first = (node, names) => { for (const n of names) { const e = node.getElementsByTagName(n)[0]; if (e) return e; } return null; };
const text = (node, names) => { const e = first(node, names); return e ? e.textContent : ''; };
const goodImg = u => u && /^https?:/.test(u) && !/\.svg|emoji|avatar|1x1|pixel|gravatar|rss-large|logo/i.test(u);

// Article photos are often 2000–3000 px; the TV only needs card size, and decoding the
// full thing stalls it. wsrv.nl (free image CDN) resizes on the fly.
export function sized(url, w, h) {
  if (!url || /picsum\.photos|wsrv\.nl/.test(url)) return url;
  return 'https://wsrv.nl/?url=' + encodeURIComponent(url) + '&w=' + w + '&h=' + h + '&fit=cover&output=jpg&q=78';
}

function parse([cat, src, domain], xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const items = [...doc.getElementsByTagName('item'), ...doc.getElementsByTagName('entry')];
  return items.map(i => {
    const body = html(text(i, ['content:encoded', 'content']) || text(i, ['description', 'summary']));
    const imgs = [...body.querySelectorAll('img')].map(x => x.getAttribute('src'));
    const media = first(i, ['media:content', 'media:thumbnail', 'enclosure']);
    if (media) imgs.unshift(media.getAttribute('url'));
    const good = imgs.filter(goodImg);
    const summary = decode(text(i, ['description', 'summary']));
    const pts = sentences([...body.querySelectorAll('p')].map(p => p.textContent).join(' ') || summary, 6);
    const dek = summary.length > 40 && summary.length < 300 && !/<|\[…\]|\.\.\.$/.test(summary) ? summary : pts[0] || '';
    const when = new Date(text(i, ['pubDate', 'published', 'updated']) || Date.now());
    return {
      cat, src, logo: FAVICON(domain), when: when.getTime(), ago: ago(when),
      text: decode(text(i, ['title'])).trim(), dek: dek.trim(),
      points: pts.filter(p => p !== dek).slice(0, 3), img: good[0] || '', img2: good[1] || '',
    };
  });
}

async function hackerNews() {
  const ids = (await (await fetch('https://hacker-news.firebaseio.com/v0/topstories.json')).json()).slice(0, 30);
  const items = await Promise.all(ids.map(id => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json())));
  return items.filter(i => i && i.title && i.score > 150).map(i => ({
    cat: 'tech', src: 'Hacker News', logo: FAVICON('news.ycombinator.com'), when: i.time * 1000, ago: ago(i.time * 1000),
    text: i.title, dek: '', points: [], img: '', img2: '',
  }));
}

export async function stories() {
  if (cache && Date.now() - cachedAt < 15 * 60000) return cache;
  // Fetch in parallel, but parse one feed at a time with a pause between, so a refresh
  // never blocks the TV for long enough to hitch an animation.
  const texts = await Promise.all(FEEDS.map(f => fetch(f[3]).then(r => r.text()).catch(e => { warn('feed failed', f[3], e.message); return ''; })));
  const all = [];
  for (let n = 0; n < FEEDS.length; n++) {
    if (texts[n]) try { all.push(...parse(FEEDS[n], texts[n])); } catch (e) { warn('feed parse failed', FEEDS[n][3], e.message); }
    await new Promise(r => setTimeout(r, 60));
  }
  const seen = new Set();
  const fresh = all.filter(isWorthIt).filter(s => !seen.has(s.text.toLowerCase()) && seen.add(s.text.toLowerCase()));
  const groups = {};
  for (const s of fresh) (groups[s.cat] = groups[s.cat] || []).push(s);
  Object.values(groups).forEach(g => g.sort((a, b) => b.when - a.when));
  let list = interleave(groups, PATTERN, MAX);
  if (list.length < 10) list = list.concat(await hackerNews().catch(() => []));
  if (list.length) { cache = list; cachedAt = Date.now(); }
  return cache || [];
}

export async function headlines() {
  return (await stories()).map(s => s.text);
}

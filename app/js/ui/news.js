// Stories for the lockscreen and Home, from three groups of feeds:
//   tech  The Verge, Ars Technica, Engadget, TechCrunch
//   ai    Verge AI, Ars AI, TechCrunch AI, MIT Technology Review
//   politics NPR, Fox News, The Hill, Axios, BBC, NY Post, Politico, CBS, National Review,
//         Vox, Breitbart, The Dispatch (grouped per story, with a Left/Center/Right coverage bar)
//   games The Verge Games, PC Gamer, GameSpot, Eurogamer, Polygon, IGN
//   edm   UKF, EDM Identity, EDMTunes, Dancing Astronaut   (bass / EDM, now and then)
// They're interleaved tech, ai, games, tech, ai, edm (newest first within each group), up to 80
// stories, so a lap takes ~20 minutes and the feeds refresh every 15. Photos are optional.
// Deals, gift guides, podcasts and other filler are dropped. Hacker News is the fallback.
import { warn } from '../util/log.js';
import { pref } from '../util/prefs.js';

const FAVICON = d => 'https://www.google.com/s2/favicons?sz=128&domain=' + d;
// Never on the TV: gore, injuries, bodily stuff. (Health stories in general stay, minus photos: see ICKY.)
const GORE = /\b(gore|gory|corpses?|dead bod(y|ies)|decapitat\w*|dismember\w*|maggots?|parasit\w+|tapeworms?|flesh-eating|necro\w+|autops(y|ies)|maim\w*|mutilat\w*|vomit\w*|diarrh\w*|feces|pus)\b/i;
// Medical stories: the headline is fine, the photos usually aren't (rashes, wounds, surgery).
const ICKY = /\b(measles|rash(es)?|pox|smallpox|chickenpox|monkeypox|mpox|leprosy|lesions?|wounds?|infect\w*|disease|outbreak|virus|bacteri\w*|fung\w+|tumou?rs?|cancer|surger(y|ies)|surgical|injur\w+|bites?|skin|eye drops?|ticks?|lice|bedbugs?|rabies|ebola|cholera|patients?|hospital\w*)\b/i;
const FILLER = /\bdrops? to \$|black friday|cyber monday|prime (big deal )?day|\$\d+\.\d\d\b|^(opinion|op-ed|editorial|letters?)\b|\b(deals?|% off|sale|save \$|discount|coupon|gift guide|best .{0,30}(to buy|for \d{4}|gifts?)|podcast|vergecast|newsletter|installer|quiz|giveaway|sponsored|how to watch|live ?blog|week in review|today only|lowest price|preorder now|promo codes?|coupon codes?|discount codes?|voucher codes?)\b|\bis (only|just) \$|\bfor (only|just) \$|\$\d[\d,.]* (right now|today)|\bon sale\b|\b(trailer|teaser|livestream|live stream|premiere|official (music )?video|lyric video|guest mix|full set|#shorts|reacts?)\b/i;
const MAX = 120;
// Topics switched off in Settings simply drop out of this rotation.
// One offbeat and one culture story per 18: mostly tech, politics, AI and games.
const PATTERN = ['tech', 'politics', 'ai', 'games', 'tech', 'offbeat', 'politics', 'world', 'ai', 'tech', 'games', 'business', 'politics', 'culture', 'ai', 'science', 'tech', 'edm'];
// Ground News-style topics: only stories several outlets are covering (with the bias bar).
const MULTI_OUTLET = { politics: 3, world: 3, business: 2, science: 2 };

// Media bias per outlet, Ground News style (Left / Center / Right), approximated from
// AllSides' published ratings (lean-left counts as Left, lean-right as Right).
export const BIAS = {
  NPR: 'L', Politico: 'L', CBS: 'L', CNBC: 'L', Vox: 'L', Axios: 'L', 'NBC News': 'L', 'The Verge': 'L',
  'The Hill': 'C', BBC: 'C', Reuters: 'C',
  'Fox News': 'R', 'NY Post': 'R', 'Washington Times': 'R', 'National Review': 'R', Breitbart: 'R', 'The Dispatch': 'R',
};

const FEEDS = [
  ['tech', 'The Verge', 'theverge.com', 'https://www.theverge.com/rss/index.xml'],
  ['tech', 'Ars Technica', 'arstechnica.com', 'https://feeds.arstechnica.com/arstechnica/index'],
  ['tech', 'Engadget', 'engadget.com', 'https://www.engadget.com/rss.xml'],
  ['tech', 'TechCrunch', 'techcrunch.com', 'https://techcrunch.com/feed/'],
  ['tech', 'Wired', 'wired.com', 'https://www.wired.com/feed/rss'],
  ['tech', '9to5Mac', '9to5mac.com', 'https://9to5mac.com/feed/'],
  ['tech', 'MacRumors', 'macrumors.com', 'https://feeds.macrumors.com/MacRumors-All'],
  ['tech', "Tom's Hardware", 'tomshardware.com', 'https://www.tomshardware.com/feeds/all'],
  ['games', 'Rock Paper Shotgun', 'rockpapershotgun.com', 'https://www.rockpapershotgun.com/feed'],
  ['edm', 'EDM Sauce', 'edmsauce.com', 'https://www.edmsauce.com/feed/'],
  ['politics', 'NBC News', 'nbcnews.com', 'https://feeds.nbcnews.com/nbcnews/public/politics'],
  ['politics', 'Washington Times', 'washingtontimes.com', 'https://www.washingtontimes.com/rss/headlines/news/politics/'],
  ['offbeat', 'UPI Odd News', 'upi.com', 'https://rss.upi.com/news/odd_news.rss'],
  ['offbeat', 'Sky News', 'news.sky.com', 'https://feeds.skynews.com/feeds/rss/strange.xml'],
  ['offbeat', 'Good News Network', 'goodnewsnetwork.org', 'https://www.goodnewsnetwork.org/feed/'],
  ['culture', 'Variety', 'variety.com', 'https://variety.com/feed/'],
  ['culture', 'Rolling Stone', 'rollingstone.com', 'https://www.rollingstone.com/feed/'],
  ['world', 'BBC', 'bbc.com', 'https://feeds.bbci.co.uk/news/world/rss.xml'],
  ['world', 'NPR', 'npr.org', 'https://feeds.npr.org/1004/rss.xml'],
  ['world', 'Fox News', 'foxnews.com', 'https://moxie.foxnews.com/google-publisher/world.xml'],
  ['world', 'CBS', 'cbsnews.com', 'https://www.cbsnews.com/latest/rss/world'],
  ['world', 'NBC News', 'nbcnews.com', 'https://feeds.nbcnews.com/nbcnews/public/world'],
  ['business', 'BBC', 'bbc.com', 'https://feeds.bbci.co.uk/news/business/rss.xml'],
  ['business', 'NPR', 'npr.org', 'https://feeds.npr.org/1006/rss.xml'],
  ['business', 'CNBC', 'cnbc.com', 'https://www.cnbc.com/id/10001147/device/rss/rss.html'],
  ['science', 'BBC', 'bbc.com', 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml'],
  ['science', 'NPR', 'npr.org', 'https://feeds.npr.org/1007/rss.xml'],
  ['science', 'Fox News', 'foxnews.com', 'https://moxie.foxnews.com/google-publisher/science.xml'],
  ['politics', 'NPR', 'npr.org', 'https://feeds.npr.org/1014/rss.xml'],
  ['politics', 'Fox News', 'foxnews.com', 'https://moxie.foxnews.com/google-publisher/politics.xml'],
  ['politics', 'The Hill', 'thehill.com', 'https://thehill.com/homenews/feed/'],
  ['politics', 'Axios', 'axios.com', 'https://api.axios.com/feed/'],
  ['politics', 'BBC', 'bbc.com', 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml'],
  ['politics', 'NY Post', 'nypost.com', 'https://nypost.com/politics/feed/'],
  ['politics', 'Politico', 'politico.com', 'https://rss.politico.com/politics-news.xml'],
  ['politics', 'CBS', 'cbsnews.com', 'https://www.cbsnews.com/latest/rss/politics'],
  ['politics', 'National Review', 'nationalreview.com', 'https://www.nationalreview.com/feed/'],
  ['politics', 'Vox', 'vox.com', 'https://www.vox.com/rss/politics/index.xml'],
  ['politics', 'Breitbart', 'breitbart.com', 'https://feeds.feedburner.com/breitbart'],
  ['politics', 'The Dispatch', 'thedispatch.com', 'https://thedispatch.com/feed/'],
  ['ai', 'The Verge', 'theverge.com', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml'],
  ['ai', 'Ars Technica', 'arstechnica.com', 'https://arstechnica.com/ai/feed/'],
  ['ai', 'TechCrunch', 'techcrunch.com', 'https://techcrunch.com/category/artificial-intelligence/feed/'],
  ['ai', 'MIT Tech Review', 'technologyreview.com', 'https://www.technologyreview.com/topic/artificial-intelligence/feed/'],
  ['games', 'The Verge', 'theverge.com', 'https://www.theverge.com/rss/games/index.xml'],
  ['games', 'PC Gamer', 'pcgamer.com', 'https://www.pcgamer.com/rss/'],
  ['games', 'GameSpot', 'gamespot.com', 'https://www.gamespot.com/feeds/mashup/'],
  ['games', 'Eurogamer', 'eurogamer.net', 'https://www.eurogamer.net/feed'],
  ['games', 'Polygon', 'polygon.com', 'https://www.polygon.com/rss/index.xml'],
  ['games', 'IGN', 'ign.com', 'https://feeds.ign.com/ign/all'],
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
// Decimals, versions and initials ("27.3", "$17.4", "U.S.") don't end a sentence. Section labels
// ("Why it matters:", "Zoom in:") and doubled sub-headings ("Safari Safari has…") are trimmed off.
export function sentences(text, n) {
  const t = text.replace(/\s+/g, ' ').replace(/(\d)\.(\d)/g, '$1\u2024$2').replace(/\b(U\.S|U\.K|U\.N|E\.U|Sen|Rep|Gov|Dr|Mr|Mrs|Ms|St|Jr|Sr|Inc|Corp|Co|Lt|Gen|No|vs)\.(?=\s)/g, m => m.replace(/\./g, '\u2024')).replace(/\b([A-Z])\.(?=[A-Z]\.|\s[a-z])/g, '$1\u2024');
  return (t.match(/[^.!?]+[.!?]+["”’)]?(\s|$)/g) || [])
    .map(s => s.trim().replace(/\u2024/g, '.').replace(/^[A-Z][\w’' ]{1,24}:\s+(?=[A-Z])/, '').replace(/^(\S+(?: \S+)?) \1\b\s*/, '$1 '))
    .filter(s => s.length > 40 && s.length < 220 && !/…|\.\.\.|read the full story|continue reading/i.test(s)).slice(0, n);
}

// Headlines that are someone's take rather than news: first person, reviews, explainers,
// listicles, advice, and question headlines.
const NOT_NEWS = /\b(my|i|i'm|i’m|i've|i’ve|i'd|i’d|me|we tried|we tested|our (favorite|picks?|take))\b|\b(thoughts on|hands[- ]on|first look|impressions|ranked|ranking|explained|explainer|what (to|you) (know|expect)|everything (we|you) know|things to know|here'?s (why|how|what)|here’s (why|how|what)|why you|you (should|need|can|might)|should you|how to|guide|best .{0,25}(for|of|to)|worth it|deep dive|recap|roundup|round-up|biggest .{0,20}(announcements|moments)|everything new|all the news|all the (new|best)|full (speech|video|interview)|live (updates|results|coverage)|follow (today|tonight|live)|election results)\b|\breview(ed)?\s*[:|–—-]|\breview\s*$|^review\b|\?\s*$/i;
// Quoted words don't count (a quote headline can say "I").
const unquoted = t => String(t).replace(/(^|\s)[“"‘'][^“”"‘’']{3,}[”"’']/g, ' ');
// Clickbait and filler: listicles, reaction pieces, puzzles and horoscopes, shouting, run-on titles.
const CLICKBAIT = /^\d+\s+(things|ways|reasons|best|tips|times|signs|questions|takeaways|of the|moments|facts)\b|you won'?t believe|you won’t believe|everyone is talking|(goes|went) viral|internet (reacts|is losing|can'?t)|fans (react|are losing|slam|are furious)|people are (saying|losing)|what we know( so far)?|\b(wordle|connections|strands|quordle|crossword|horoscope|zodiac)\b|today'?s .{0,20}(answer|hints?)|deal of the day|\bslams?\b|\bdestroys?\b|\bepic\b|jaw-?dropping|must-see|mind-?blowing/i;
const shouting = t => { const l = t.replace(/[^A-Za-z]/g, ''); return l.length > 12 && l.replace(/[^A-Z]/g, '').length / l.length > 0.6; };
export function isWorthIt(s) {
  return s.text.length >= 30 && s.text.length <= 140 && !CLICKBAIT.test(s.text) && !shouting(s.text) && s.text.split(' ').length >= 5 && !FILLER.test(s.text) && !GORE.test(s.text) && !NOT_NEWS.test(unquoted(s.text));
}

// A key point has to stand on its own: a plain statement of fact, not the writer talking,
// not a caption/credit/promo, not leaning on the sentence before it, not a rerun of the headline.
const POINT_JUNK = /\b(i|i'm|i’m|i've|i’ve|i'd|i’d|me|my|mine|we'll|we’ll|we've|we’ve|us|our|you|your|you're|you’re|you'll|you’ll|yours)\b|\b(photo|image|credit|getty|reuters\/|ap photo|illustration|caption|subscribe|sign up|newsletter|podcast|read more|click|tap here|affiliate|commission|sponsored|advertis\w+|cookie|this (article|story|post|piece)|editor'?s note|disclosure|update:|updated|related:|watch:|listen:|follow us|email|contact)\b|https?:|@\w|[:;]\s*$|^\W/i;
const LEANS_ON_CONTEXT = /^(do|don't|don’t|make sure|be sure|keep|try|remember|note|check|consider|imagine|if|when|while|as|because|but|and|so|or|yet|still|also|however|meanwhile|instead|that|this|these|those|it|its|it's|it’s|they|their|them|he|his|she|her|there|here|such|which|then|now|plus|indeed|anyway|well|oh|ok|okay|yes|no)\b/i;
export function goodPoint(p, title, dek) {
  if (POINT_JUNK.test(p) || LEANS_ON_CONTEXT.test(p)) return false;
  if (/^[“"]/.test(p) || (p.match(/[“”"]/g) || []).length > 2) return false; // mostly a quote
  const w = words(p), t = words(title + ' ' + dek);
  let shared = 0; for (const x of w) if (t.has(x)) shared++;
  return w.size >= 6 && shared / w.size < 0.6;                                      // adds something new
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

// Strip feed cruft from headlines: "WATCH:", "| Fox News", "(VIDEO)", doubled spaces.
export function cleanTitle(t, src) {
  let s = String(t).replace(/\s+/g, ' ').trim();
  s = s.replace(/^(watch|live|breaking|video|listen|exclusive|update[d]?)\s*[:|-]\s*/i, '');
  s = s.replace(/\s*[\(\[](video|watch|photos?|live|updated?)[\)\]]\s*/gi, ' ');
  s = s.replace(new RegExp('\\s*[|\\-–—]\\s*(' + String(src).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '|the verge|ars technica|fox news|npr|bbc news|politico|axios|cbs news)\\s*$', 'i'), '');
  return s.trim();
}

// ---------- same story, several outlets (Ground News style) ----------
const STOP = new Set('the a an and or of to in on for with at by from as is are was were be been has have had it its this that these those after over into amid says said new will would could about than more most not but how why what who when where his her their they you your our we he she just now'.split(' '));
export function words(t) {
  return new Set(String(t).toLowerCase().replace(/[’'`]s\b/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w)));
}
export function similar(a, b) {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared >= 3 && shared / Math.min(a.size, b.size) >= 0.4;
}
// Groups stories about the same event; each group keeps its best version (photo, summary)
// plus who covered it and their Left / Center / Right split.
const HIDDEN_SRC = new Set(['Fox News']);
export function cluster(list) {
  const groups = [];
  for (const s of list) {
    const w = words(s.text);
    const g = groups.find(g => g.cat === s.cat && similar(g.words, w));
    if (g) { g.items.push(s); for (const x of w) g.words.add(x); } else groups.push({ cat: s.cat, words: w, items: [s] });
  }
  // Fox News only counts toward coverage: its own version of a story is never what's shown.
  return groups.filter(g => g.items.some(x => !HIDDEN_SRC.has(x.src))).map(g => {
    const best = g.items.filter(x => !HIDDEN_SRC.has(x.src)).sort((a, b) => (!!b.img - !!a.img) || (b.points.length - a.points.length) || (b.when - a.when))[0];
    const outlets = [...new Set(g.items.map(x => x.src))];
    const cov = { L: 0, C: 0, R: 0, total: outlets.length, outlets };
    outlets.forEach(o => { if (BIAS[o]) cov[BIAS[o]]++; });
    return Object.assign({}, best, { when: Math.max(...g.items.map(x => x.when)), coverage: cov });
  });
}

const html = text => new DOMParser().parseFromString(text || '', 'text/html');
const decode = t => html(t).body.textContent; // titles arrive escaped (&#8216; …)
const first = (node, names) => { for (const n of names) { const e = node.getElementsByTagName(n)[0]; if (e) return e; } return null; };
const text = (node, names) => { const e = first(node, names); return e ? e.textContent : ''; };
// ---------- picking a story's photo ----------
// Whole path words only ("uploads/" is where most sites keep their photos, so no bare "ads").
const JUNK_IMG = /\.svg(\?|$)|1x1|rss-large|feeds\.feedburner|doubleclick|gravatar|(^|[\/._-])(emoji|avatar|pixel|spacer|blank|logos?|icons?|badges?|sprite|favicon|ads?|tracking|share|button)([\/._-]|$)/i;
// Undo WordPress-style thumbnail crops ("photo-150x150.jpg" → "photo.jpg").
export function fullSize(u) {
  return String(u).replace(/-\d{2,4}x\d{2,4}(?=\.(jpe?g|png|webp)(\?|$))/i, '');
}
// Largest candidate in a srcset ("a.jpg 320w, b.jpg 1280w" → b.jpg).
export function largestSrc(srcset) {
  let best = null;
  for (const part of String(srcset || '').split(',')) {
    const [url, size] = part.trim().split(/\s+/);
    const n = parseFloat(size) || 1;
    if (url && (!best || n > best.n)) best = { url, n };
  }
  return best ? best.url : '';
}
const sizeOk = (w, h) => !((w && w < 300) || (h && h < 160));
const sameImage = (a, b) => fullSize(a).split('?')[0] === fullSize(b).split('?')[0];
// Ranked candidates: feed-declared media (biggest first), enclosures, then article images.
export function pickImages(item, body) {
  const out = [];
  const add = u => { u = u && fullSize(u.trim()); if (u && /^https?:/.test(u) && !JUNK_IMG.test(u) && !out.some(x => sameImage(x, u))) out.push(u); };
  const media = [...item.getElementsByTagName('media:content'), ...item.getElementsByTagName('media:thumbnail')]
    .filter(m => !m.getAttribute('medium') || m.getAttribute('medium') === 'image' || /image/.test(m.getAttribute('type') || ''))
    .filter(m => sizeOk(+m.getAttribute('width'), +m.getAttribute('height')))
    .sort((x, y) => (+y.getAttribute('width') || 0) - (+x.getAttribute('width') || 0));
  media.forEach(m => add(m.getAttribute('url')));
  [...item.getElementsByTagName('enclosure')].filter(e => /^image\//.test(e.getAttribute('type') || 'image/')).forEach(e => add(e.getAttribute('url')));
  [...body.querySelectorAll('img')]
    .filter(i => sizeOk(+i.getAttribute('width'), +i.getAttribute('height')))
    .forEach(i => add(largestSrc(i.getAttribute('srcset')) || i.getAttribute('data-src') || i.getAttribute('src')));
  return out;
}

// Article photos are often 2000–3000 px; the TV only needs card size, and decoding the
// full thing stalls it. wsrv.nl (free image CDN) resizes on the fly.
// Without h, the photo keeps its own shape (just scaled to w wide).
export function sized(url, w, h) {
  if (!url || /picsum\.photos|wsrv\.nl|i\.ytimg\.com/.test(url)) return url;
  return 'https://wsrv.nl/?url=' + encodeURIComponent(url) + '&w=' + w + (h ? '&h=' + h + '&fit=cover' : '') + '&output=jpg&q=78';
}

const CLIPS = false; // muted news clips in the photo card: off for now
// A clip some feeds carry (Politico's Brightcove players, MIT Tech Review <video>s), played muted.
export function pickVideo(item, body) {
  const v = body.querySelector('[data-mp4url]');
  const tag = body.querySelector('video[src], video source[src]');
  const enc = [...item.getElementsByTagName('media:content'), ...item.getElementsByTagName('enclosure')].find(m => /\.mp4(\?|$)/i.test(m.getAttribute('url') || ''));
  const u = (v && v.getAttribute('data-mp4url')) || (tag && tag.getAttribute('src')) || (enc && enc.getAttribute('url')) || '';
  return /^https?:.*\.mp4(\?|$)/i.test(u) ? u.replace(/^http:/, 'https:') : '';
}

function parse([cat, src, domain], xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const items = [...doc.getElementsByTagName('item'), ...doc.getElementsByTagName('entry')];
  return items.map(i => {
    const body = html(text(i, ['content:encoded', 'content']) || text(i, ['description', 'summary']));
    const good = pickImages(i, body);
    const summary = decode(text(i, ['description', 'summary']));
    const pts = sentences([...body.querySelectorAll('p')].map(p => p.textContent).join(' ') || summary, 14);
    const dek = summary.length > 40 && summary.length < 300 && !/<|\[…\]|\.\.\.$/.test(summary) ? summary : pts[0] || '';
    const when = new Date(text(i, ['pubDate', 'published', 'updated']) || Date.now());
    const story = {
      cat, src, logo: FAVICON(domain), when: when.getTime(), ago: ago(when),
      text: cleanTitle(decode(text(i, ['title'])), src), dek: dek.trim(),
      points: [],
      img: good[0] || '', img2: good[1] || '', imgs: good.slice(0, 6), video: CLIPS ? pickVideo(i, body) : '',
    };
    // Key points: only the sentences that stand on their own; fewer than 3 good ones → none.
    const keep = pts.filter(p => p !== story.dek && goodPoint(p, story.text, story.dek)).slice(0, 6);
    story.points = keep.length >= 3 ? keep : [];
    // Medical stories keep their headline but lose the photos and clips (no rashes on the TV).
    if (ICKY.test(story.text + ' ' + story.dek)) Object.assign(story, { img: '', img2: '', imgs: [], video: '' });
    return story;
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
  if (cache && Date.now() - cachedAt < 10 * 60000) return cache;
  // Fetch in parallel, but parse one feed at a time with a pause between, so a refresh
  // never blocks the TV for long enough to hitch an animation.
  const texts = await Promise.all(FEEDS.map(f => fetch(f[3]).then(r => r.text()).catch(e => { warn('feed failed', f[3], e.message); return ''; })));
  const all = [];
  for (let n = 0; n < FEEDS.length; n++) {
    if (texts[n]) try { all.push(...parse(FEEDS[n], texts[n])); } catch (e) { warn('feed parse failed', FEEDS[n][3], e.message); }
    await new Promise(r => setTimeout(r, 60));
  }
  const seen = new Set();
  // Fresh news only: the last 12 h, or 24 h late at night (10 pm–6 am) when less is published.
  // If that leaves too little, widen to 36 h rather than run dry.
  const hour = new Date().getHours();
  const maxAge = (hour >= 22 || hour < 6 ? 24 : 12) * 3600000;
  const recent = all.filter(s => Date.now() - s.when < maxAge);
  const pool = recent.length >= 60 ? recent : all.filter(s => Date.now() - s.when < 36 * 3600000);
  // Every story needs a photo (the gross-photo ones were stripped and drop out here too).
  const fresh = pool.filter(isWorthIt).filter(s => s.img).filter(s => !seen.has(s.text.toLowerCase()) && seen.add(s.text.toLowerCase()));
  const groups = {};
  // Ground News-style topics only keep real stories: several outlets covering them.
  for (const s of cluster(fresh)) if (!MULTI_OUTLET[s.cat] || s.coverage.total >= MULTI_OUTLET[s.cat]) (groups[s.cat] = groups[s.cat] || []).push(s);
  // Within a topic: widely covered stories first (each extra outlet counts like 3 hours newer).
  // Stories with real key points count like 4 hours newer, so the good ones lead.
  const rank = s => s.when + (s.coverage.total - 1) * 3 * 3600000 + (s.points.length ? 4 * 3600000 : 0);
  Object.values(groups).forEach(g => g.sort((a, b) => rank(b) - rank(a)));
  // No single outlet takes over a topic: at most 6 stories each per topic.
  // (Politics is exempt: those are multi-outlet stories, and the rotation already keeps them to 2 in 8.)
  for (const k of Object.keys(groups)) { if (MULTI_OUTLET[k]) continue; const per = {}; groups[k] = groups[k].filter(s => (per[s.src] = (per[s.src] || 0) + 1) <= 6); }
  // Settings → News topics: drop the groups that are switched off (tech if all are off).
  const pattern = PATTERN.filter(g => pref('news.' + g));
  let list = interleave(groups, pattern.length ? pattern : ['tech'], MAX);
  if (list.length < 10) list = list.concat(await hackerNews().catch(() => []));
  if (list.length) {
    cache = list;
    cachedAt = Date.now();
    // Keep the latest batch on the TV so the lockscreen opens on a story instantly next time.
    try { localStorage.setItem('ss.newsCache', JSON.stringify(list.slice(0, 40))); } catch (e) {}
  }
  return cache || [];
}

export function savedStories() {
  try { return JSON.parse(localStorage.getItem('ss.newsCache') || '[]'); } catch (e) { return []; }
}

export function resetNews() { cache = null; cachedAt = 0; }

export async function headlines() {
  return (await stories()).map(s => s.text);
}

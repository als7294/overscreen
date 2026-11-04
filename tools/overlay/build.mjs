// Builds dist/overlay.js: the TV app's pills + their CSS, fonts and icons in one self-contained
// script, injected by tools/ytmode.mjs into YouTube's TV site running inside SamSUCKED.
//   node tools/overlay/build.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '../../app');
import { existsSync } from 'node:fs';
const data = (f, type) => existsSync(path.join(app, f)) ? 'data:' + type + ';base64,' + readFileSync(path.join(app, f)).toString('base64') : '';
const stub = path.join(here, 'stubs.js');

const out = await build({
  entryPoints: [path.join(here, 'entry.js')], bundle: true, format: 'iife', write: false, minify: true, target: 'chrome100',
  plugins: [{ name: 'stubs', setup(b) { b.onResolve({ filter: /(^|\/)(radio|config)\.js$/ }, () => ({ path: stub })); } }],
});
let js = out.outputFiles[0].text;
for (const icon of ['agent-a.svg', 'agent-b.svg', 'app-message.svg', 'app-call.svg', 'app-chat.svg']) js = js.split('img/brand/' + icon).join(data('img/brand/' + icon, 'image/svg+xml'));

const fonts = [
  ['Inter', 400, 'inter-latin-400-normal.woff2', 'woff2'], ['Inter', 500, 'inter-latin-500-normal.woff2', 'woff2'],
  ['Inter', 600, 'inter-latin-600-normal.woff2', 'woff2'], ['Inter', 700, 'inter-latin-700-normal.woff2', 'woff2'],
  ['Grift', '100 900', 'Grift-Black.otf', 'opentype'], ['GriftMedium', 500, 'Grift-Medium.otf', 'opentype'],
].filter(([, , file]) => existsSync(path.join(app, 'fonts', file))).map(([f, w, file, fmt]) => `@font-face{font-family:'${f}';font-weight:${w};src:url(${data('fonts/' + file, fmt === 'woff2' ? 'font/woff2' : 'font/otf')}) format('${fmt}')}`).join('');
const vars = readFileSync(path.join(app, 'css/app.css'), 'utf8').match(/:root \{[\s\S]*?\n\}/)[0];
const popups = readFileSync(path.join(app, 'css/popups.css'), 'utf8').replace(/@font-face[^}]*\}/g, '');
// Above everything YouTube draws; positioned like on the lockscreen (top centre, icons top right).
const extra = `.pp,.pp-docks,.pp-dock,.pp-dock-label{z-index:2147483000!important;font-family:var(--body)}
html[data-screen="yt"] .pp-docks{left:auto!important;right:72px!important;top:52px!important}
html[data-screen="yt"] .pp-docks::before{content:'';position:absolute;left:-150px;right:-64px;top:-34px;bottom:-40px;z-index:-1;pointer-events:none;
  background:radial-gradient(closest-side at 60% 50%,rgba(0,0,0,.5) 0%,rgba(0,0,0,.24) 55%,rgba(0,0,0,0) 100%);opacity:0;transition:opacity .4s ease}
html[data-screen="yt"] .pp-docks:has(.pp-dock.on)::before{opacity:1}
html[data-screen="yt"] .pp-box{box-shadow:0 28px 80px rgba(0,0,0,.75),0 8px 22px rgba(0,0,0,.55)!important}`;
const css = fonts + vars + popups + extra;

mkdirSync(path.join(here, 'dist'), { recursive: true });
writeFileSync(path.join(here, 'dist/overlay.js'), `(()=>{if(window.ssPills)return;
const add=()=>{const s=document.createElement('style');s.id='ss-overlay';s.textContent=${JSON.stringify(css)};(document.head||document.documentElement).appendChild(s);
const h=document.documentElement;h.dataset.screen='yt';h.dataset.morning='1';};
if(document.documentElement)add();else document.addEventListener('DOMContentLoaded',add);
${js}})();`);
console.log('overlay.js', Math.round(readFileSync(path.join(here, 'dist/overlay.js')).length / 1024) + ' KB');

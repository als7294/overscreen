// An HDMI input or live TV, shown full screen INSIDE SamSUCKED (Samsung's TV Window API puts the
// source's picture behind the page), so Claude/Codex pop-ups draw on top of it for real.
// Back returns to Home. The radio pauses while you watch and comes back after.
import { h, setText } from '../util/dom.js';
import { stop as radioStop, play as radioPlay, track } from '../ui/radio.js';
import { warn } from '../util/log.js';
import * as router from '../router.js';

export const sourceName = s => s.type === 'TV' ? 'Live TV' : s.type + ' ' + s.number;

// Connected inputs: [{ type, number, ... }] (live TV first).
export function connectedInputs() {
  return new Promise(resolve => {
    try {
      tizen.systeminfo.getPropertyValue('VIDEOSOURCE', v => resolve(v.connected.filter(s => s.type === 'TV' || s.type === 'HDMI')
        .sort((a, b) => (a.type === 'TV' ? -1 : 0) - (b.type === 'TV' ? -1 : 0) || a.number - b.number)), () => resolve([]));
    } catch (e) { resolve([]); }
  });
}

export function InputScreen(src) {
  const el = h('div', 'screen input');
  const hint = h('div', 'input-hint', el);
  let resumeRadio = false;
  return {
    name: 'input',
    el,
    onShow() {
      document.documentElement.classList.add('playing');
      setText(hint, sourceName(src) + ' · Back to return');
      el.classList.remove('hint-off'); setTimeout(() => el.classList.add('hint-off'), 3500);
      resumeRadio = !track.paused; radioStop();
      try {
        tizen.tvwindow.setSource(src, () => tizen.tvwindow.show(() => {}, e => warn('tvwindow show', e.message), ['0px', '0px', '1920px', '1080px'], 'MAIN', 'BEHIND'),
          e => warn('tvwindow source', e.message));
      } catch (e) { warn('tvwindow', e.message); }
    },
    onHide() {
      try { tizen.tvwindow.hide(() => {}, () => {}); } catch (e) {}
      document.documentElement.classList.remove('playing');
      if (resumeRadio) radioPlay();
    },
    onKey(action) {
      if (action === 'back') { router.back(); return true; }
      el.classList.remove('hint-off'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.add('hint-off'), 2500);
      return true; // everything else is swallowed: the source is controlled with its own remote/controller
    },
  };
}

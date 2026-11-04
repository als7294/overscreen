// Simple preferences for the Settings screen (stored on the TV).
const DEFAULTS = {
  'news.tech': true, 'news.politics': true, 'news.offbeat': true, 'news.culture': true,
  'news.ai': true, 'news.games': true, 'news.edm': true,
  'news.world': false, 'news.business': false, 'news.science': false, // opt-in, in Settings
  bgLoop: 'bubble',      // lockscreen sky nebula: bubble | n11 | pillars | carina | stars
  storyPace: 'normal',   // relaxed | normal | quick
  sounds: true,          // alert sounds on the lockscreen
  clock24: false,
  tempUnit: 'F',         // F | C
  idleMin: 3,            // minutes on Home before the lockscreen comes back; 0 = never
};

export function pref(key) {
  try {
    const v = localStorage.getItem('ss.pref.' + key);
    return v == null ? DEFAULTS[key] : JSON.parse(v);
  } catch (e) {
    return DEFAULTS[key];
  }
}

export function setPref(key, value) {
  try { localStorage.setItem('ss.pref.' + key, JSON.stringify(value)); } catch (e) {}
}

export const PACE = { relaxed: 1.35, normal: 1, quick: 0.7 };

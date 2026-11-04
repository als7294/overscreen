// Current weather for the lockscreen: location from the TV's IP, forecast from Open-Meteo
// (free, no key). Fahrenheit. Cached for 20 minutes.
import { pref } from '../util/prefs.js';

let cache = null;
let cachedAt = 0;
let cachedUnit = '';

// WMO weather codes → words + which icon to draw.
export function describe(code) {
  if (code === 0) return ['Clear', 'sun'];
  if (code <= 2) return ['Partly cloudy', 'partly'];
  if (code === 3) return ['Cloudy', 'cloud'];
  if (code <= 48) return ['Fog', 'cloud'];
  if (code <= 67 || (code >= 80 && code <= 82)) return ['Rain', 'rain'];
  if (code <= 77 || code === 85 || code === 86) return ['Snow', 'snow'];
  return ['Storms', 'rain'];
}

export async function weather() {
  const unit = pref('tempUnit') === 'C' ? 'celsius' : 'fahrenheit';
  if (cache && cachedUnit === unit && Date.now() - cachedAt < 20 * 60000) return cache;
  try {
    const loc = await (await fetch('http://ip-api.com/json/?fields=lat,lon,city')).json();
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat + '&longitude=' + loc.lon +
      '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=' + unit + '&timezone=auto&forecast_days=1';
    const w = await (await fetch(url)).json();
    const [label, icon] = describe(w.current.weather_code);
    cache = { temp: Math.round(w.current.temperature_2m), hi: Math.round(w.daily.temperature_2m_max[0]), lo: Math.round(w.daily.temperature_2m_min[0]), label, icon, city: loc.city };
    cachedAt = Date.now();
    cachedUnit = unit;
  } catch (e) {
    // keep the last good reading (or none)
  }
  return cache;
}

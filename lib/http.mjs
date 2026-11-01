import { saeubere } from './normalize.mjs';

// Kleiner HTTP-Helfer: JSON holen, Fehler verständlich machen, Wartezeiten einhalten.
export const UA = 'ungeloest/0.1 (+https://github.com/Stefan-Paun)';

export const schlafe = (ms) => new Promise((r) => setTimeout(r, ms));

// Fehlermeldungen tragen nie die Query: dort stehen API-Keys (Stack Apps) und Suchbegriffe.
export function ohneQuery(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return String(url).split('?')[0];
  }
}

export async function holeJson(url, { headers = {}, fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: ac.signal });
    const text = await res.text();
    if (!res.ok) {
      const kurz = saeubere(text.slice(0, 200)).replace(/\s+/g, ' ');
      const err = new Error(`HTTP ${res.status} für ${ohneQuery(url)}: ${kurz}`);
      err.status = res.status;
      err.headers = res.headers;
      throw err;
    }
    try {
      return { daten: JSON.parse(text), headers: res.headers };
    } catch {
      throw new Error(`Keine JSON-Antwort von ${ohneQuery(url)}: ${saeubere(text.slice(0, 120))}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// Ruft `fn` mit mindestens `abstandMs` Pause zwischen zwei Aufrufen auf.
export function mitAbstand(abstandMs) {
  let zuletzt = 0;
  return async (fn) => {
    const warte = zuletzt + abstandMs - Date.now();
    if (warte > 0) await schlafe(warte);
    zuletzt = Date.now();
    return fn();
  };
}

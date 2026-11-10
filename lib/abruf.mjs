import { holeJson, schlafe } from './http.mjs';

// Gemeinsamer Abruf für Quellen mit Ratenlimit-Kopfzeilen (GitHub GraphQL, GitLab):
// Zeitlimit je Anfrage, Wiederholung nur bei vorübergehenden Fehlern, Warten auf das Limit bis zu einer Grenze,
// sonst sauberer Abbruch (Ratenlimit-Fehler mit `.ratenlimit = true`). Geheimnisse stehen nie in Fehlermeldungen.

export const kopf = (h, name) => {
  const v = h?.get?.(name) ?? h?.get?.(name.toLowerCase());
  return v == null || v === '' ? null : String(v);
};

export function verdecke(text, geheimnisse = []) {
  let t = String(text);
  for (const g of geheimnisse) if (g && String(g).length >= 3) t = t.split(String(g)).join('***');
  return t;
}

// Sekunden bis zum Ende der Sperre aus den Kopfzeilen, sonst null.
export function wartezeitSek(headers, jetzt = Date.now()) {
  const retry = kopf(headers, 'retry-after');
  if (retry != null) {
    const n = Number(retry);
    if (Number.isFinite(n)) return Math.max(0, n);
    const t = Date.parse(retry);
    if (Number.isFinite(t)) return Math.max(0, (t - jetzt) / 1000);
  }
  const reset = kopf(headers, 'x-ratelimit-reset') ?? kopf(headers, 'ratelimit-reset');
  if (reset != null && Number.isFinite(Number(reset))) {
    const n = Number(reset);
    return Math.max(0, n > 1e9 ? n - jetzt / 1000 : n);
  }
  return null;
}

const VORUEBERGEHEND = new Set([500, 502, 503, 504]);
const netzFehler = (e) => e.status == null && (e.name === 'AbortError' || e instanceof TypeError || /fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(e.message));
const rateAntwort = (daten) => Array.isArray(daten?.errors) && daten.errors.some((x) => x?.type === 'RATE_LIMITED' || /rate limit/i.test(String(x?.message || '')));

export function erstelleAbruf({ name, fetchImpl = fetch, headers = {}, geheimnisse = [], maxWarteSek = 60, wiederholungen = 2,
  timeoutMs = 20_000, schlaf = schlafe, uhr = Date.now, log = () => {} } = {}) {
  let sperreBis = 0;
  const fehler = (msg, extra = {}) => Object.assign(new Error(verdecke(msg, geheimnisse)), extra);
  const bremse = async (sek, grund) => {
    if (sek > maxWarteSek) throw fehler(`${name}: Ratenlimit (${grund}), Wartezeit ${Math.ceil(sek)} s über der Grenze von ${maxWarteSek} s – Rest übersprungen`, { ratenlimit: true });
    log(`${name}: Ratenlimit, warte ${Math.ceil(sek)} s`);
    await schlaf(Math.ceil(sek * 1000) + 100);
  };

  return async function abruf(url, { method, body } = {}) {
    for (let versuch = 0; ; versuch++) {
      if (sperreBis > uhr()) await bremse((sperreBis - uhr()) / 1000, 'vorab');
      let err;
      try {
        const r = await holeJson(url, { headers, fetchImpl, timeoutMs, method, body });
        const rest = kopf(r.headers, 'x-ratelimit-remaining') ?? kopf(r.headers, 'ratelimit-remaining');
        if (rateAntwort(r.daten)) {
          err = Object.assign(new Error('Ratenlimit in der Antwort'), { status: 429, headers: r.headers });
        } else {
          if (rest != null && Number(rest) <= 0) {
            const s = wartezeitSek(r.headers, uhr());
            if (s != null) sperreBis = uhr() + s * 1000;
          }
          return r;
        }
      } catch (e) {
        err = e;
      }
      const rate = err.status === 429 || (err.status === 403 && (kopf(err.headers, 'retry-after') != null || kopf(err.headers, 'x-ratelimit-remaining') === '0' || /rate limit/i.test(err.message)));
      if (rate) {
        if (versuch >= wiederholungen) throw fehler(`${name}: Ratenlimit bleibt bestehen – Rest übersprungen`, { ratenlimit: true, status: err.status });
        await bremse(wartezeitSek(err.headers, uhr()) ?? 15 * (versuch + 1), `HTTP ${err.status}`);
        continue;
      }
      if ((VORUEBERGEHEND.has(err.status) || netzFehler(err)) && versuch < wiederholungen) {
        log(`${name}: vorübergehender Fehler, neuer Versuch (${versuch + 1}/${wiederholungen})`);
        await schlaf(1000 * 2 ** versuch);
        continue;
      }
      throw fehler(`${name}: ${err.message}`, { status: err.status });
    }
  };
}

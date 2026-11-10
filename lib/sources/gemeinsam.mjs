import { saeubere } from '../normalize.mjs';

// Fremdtext begrenzen: Steuerzeichen raus, Länge gedeckelt (Titel/Labels einzeilig).
export function begrenze(text, max, { einzeilig = false } = {}) {
  let t = saeubere(typeof text === 'string' ? text : '');
  if (einzeilig) t = t.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export const MAX_TITEL = 300;
export const MAX_TEXT = 8000;
export const MAX_LABEL = 50;
export const MAX_LABELS = 10;

// Nur https-Adressen werden übernommen.
export const httpsUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null);

export const zahl = (n) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null);

export function labelListe(namen) {
  return (Array.isArray(namen) ? namen : []).filter((l) => typeof l === 'string' && l.trim()).slice(0, MAX_LABELS).map((l) => begrenze(l, MAX_LABEL, { einzeilig: true }));
}

// Suchbegriff für Query-Strings: nur harmlose Zeichen, begrenzte Länge (keine eingeschleusten Qualifier).
export function sauberBegriff(s, max = 80) {
  return String(s ?? '').replace(/[^\p{L}\p{N} ._#+-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export const REPO_MUSTER = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

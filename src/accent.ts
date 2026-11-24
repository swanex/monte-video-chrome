// @ts-nocheck
// Акцентный цвет как в интерфейсах Adobe: заливка кнопок — ровно выбранный цвет,
// текст на ней — белый или чёрный (что читается лучше), а для акцентного текста
// на тёмном фоне цвет при необходимости слегка осветляется.

const PANEL_BG = '#141414'; // типичный фон панелей
const MIN_TEXT_CONTRAST = 4.5; // WCAG AA для обычного текста

function hexToRgb(hex) {
  const c = String(hex || '').replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(c)) return { r: 211, g: 253, b: 21 };
  return { r: parseInt(c.slice(0, 2), 16), g: parseInt(c.slice(2, 4), 16), b: parseInt(c.slice(4, 6), 16) };
}

function luminance({ r, g, b }) {
  const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const la = luminance(hexToRgb(a)), lb = luminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const toHex = ({ r, g, b }) =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();

const cache = new Map();
const memo = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };

/** Цвет текста/иконок на акцентной заливке: белый, если он читается (как у Adobe), иначе чёрный. */
export function onAccent(hex) {
  return memo(`on:${hex}`, () => (contrast(hex, '#FFFFFF') >= MIN_TEXT_CONTRAST ? '#FFFFFF' : '#0B0B0B'));
}

/** Акцент для текста и тонких линий на тёмном фоне: тот же оттенок, осветлённый до читаемости. */
export function accentInk(hex) {
  return memo(`ink:${hex}`, () => {
    const base = hexToRgb(hex);
    if (contrast(hex, PANEL_BG) >= MIN_TEXT_CONTRAST) return toHex(base);
    for (let t = 0.05; t <= 1; t += 0.05) {
      const mixed = { r: base.r + (255 - base.r) * t, g: base.g + (255 - base.g) * t, b: base.b + (255 - base.b) * t };
      if (contrast(toHex(mixed), PANEL_BG) >= MIN_TEXT_CONTRAST) return toHex(mixed);
    }
    return '#FFFFFF';
  });
}

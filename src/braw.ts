// @ts-nocheck
// Парсер метаданных Blackmagic RAW из Premiere Pro → Media File Properties
// и расчёт кроп-фактора по модели камеры и области сенсора (Crop Size).

/**
 * Ширина сенсора (мм) при полной ширине в пикселях. Кроп-фактор считается
 * как 36 / (ширина используемой области сенсора). Если клип снят в окне
 * (например, 4K DCI на 6K-сенсоре), Crop Size меньше полной ширины и кроп растёт.
 * Порядок важен: более конкретные названия — выше.
 */
export const SENSORS = [
  { match: ['pocket cinema camera 6k', 'studio camera 6k', 'bmpcc 6k'], widthMm: 23.10, fullPx: 6144, label: 'Super 35' },
  { match: ['pocket cinema camera 4k', 'bmpcc 4k'], widthMm: 18.96, fullPx: 4096, label: 'MFT' },
  { match: ['studio camera 4k', 'micro studio camera 4k'], widthMm: 17.78, fullPx: 3840, label: 'MFT' },
  { match: ['ursa cine 12k', 'ursa cine 17k'], widthMm: 35.64, fullPx: 12288, label: 'Full Frame' },
  { match: ['ursa mini pro 12k'], widthMm: 27.03, fullPx: 12288, label: 'Super 35' },
  { match: ['ursa mini pro 4.6k', 'ursa mini 4.6k', 'ursa broadcast'], widthMm: 25.34, fullPx: 4608, label: 'Super 35' },
  { match: ['pyxis 6k', 'cinema camera 6k'], widthMm: 36.0, fullPx: 6048, label: 'Full Frame' }
];

const round2 = (n) => Math.round(n * 100) / 100;

function findSensor(cameraType = '') {
  const lower = cameraType.toLowerCase();
  return SENSORS.find(s => s.match.some(m => lower.includes(m))) || null;
}

/** Кроп-фактор по названию камеры и (необязательно) ширине области записи в пикселях. */
export function detectCropFactor(cameraType = '', cropWidthPx = null) {
  const sensor = findSensor(cameraType);
  if (sensor) {
    const usedPx = cropWidthPx && cropWidthPx > 0 && cropWidthPx <= sensor.fullPx ? cropWidthPx : sensor.fullPx;
    const usedMm = sensor.widthMm * (usedPx / sensor.fullPx);
    return round2(36 / usedMm);
  }
  // Запасные эвристики для камер не из таблицы
  const lower = cameraType.toLowerCase();
  if (/full\s*frame|fx3|fx6|a7|r5|pyxis/.test(lower)) return 1.0;
  if (/s35|super\s*35|ursa|fx30|komodo/.test(lower)) return 1.5;
  if (/mft|gh5|gh6|micro four/.test(lower)) return 2.0;
  return 2.0;
}

const num = (s) => parseFloat(String(s).replace(',', '.'));

/** "2130mm to 4120mm" → "2.13–4.12 м"; "3.2m" → "3.2 м"; иначе как есть. */
function formatDistance(raw) {
  const vals = [...raw.matchAll(/([\d.,]+)\s*(mm|cm|m)\b/gi)].map(m => {
    const v = num(m[1]);
    const unit = m[2].toLowerCase();
    return unit === 'mm' ? v / 1000 : unit === 'cm' ? v / 100 : v;
  });
  if (vals.length === 0) return raw;
  const f = (v) => String(round2(v));
  return vals.length >= 2 ? `${f(vals[0])}–${f(vals[1])} м` : `${f(vals[0])} м`;
}

export function parseBrawMetadata(rawText) {
  const result = {};
  const lines = rawText.split(/\r?\n/);

  const extract = (patterns) => {
    for (const line of lines) {
      for (const pat of patterns) {
        const match = line.match(pat);
        if (match && match[1] && match[1].trim()) return match[1].trim();
      }
    }
    return null;
  };

  // Область записи сенсора: сначала Crop Size, иначе Image Size
  const cropRaw = extract([/^\s*Crop\s*Size\s*[:=]\s*(\d+)\s*x\s*\d+/i, /^\s*Image\s*Size\s*[:=]\s*(\d+)\s*x\s*\d+/i]);
  const cropWidthPx = cropRaw ? parseInt(cropRaw, 10) : null;

  const cameraType = extract([/^\s*Camera\s*Type\s*[:=]\s*(.+)/i, /^\s*Camera\s*Model\s*[:=]\s*(.+)/i]);
  if (cameraType) {
    result.cameraType = cameraType;
    result.cropFactor = detectCropFactor(cameraType, cropWidthPx);
  }

  const lensType = extract([/^\s*Lens\s*Type\s*[:=]\s*(.+)/i, /^\s*Lens\s*Model\s*[:=]\s*(.+)/i]);
  if (lensType) result.lensType = lensType;

  const focalRaw = extract([/^\s*Focal\s*Length\s*[:=]\s*([\d.,]+)/i]);
  if (focalRaw) result.focalLength = num(focalRaw);

  // Сохраняем точное значение: f1.75 остаётся f1.75 (раньше округлялось до f1.8)
  const apertureRaw = extract([/^\s*Aperture\s*[:=]\s*[fF]?\/?\s*([\d.,]+)/i]);
  if (apertureRaw) result.aperture = `f${num(apertureRaw)}`;

  const wbKelvin = extract([/^\s*White\s*Balance\s*Kelvin\s*[:=]\s*(\d+)/i, /^\s*Colou?r\s*Temp(?:erature)?\s*[:=]\s*(\d+)/i]);
  if (wbKelvin) result.wbKelvin = parseInt(wbKelvin, 10);

  const wbTint = extract([/^\s*(?:White\s*Balance\s*)?Tint\s*[:=]\s*([+-]?\d+)/i]);
  if (wbTint !== null) result.wbTint = parseInt(wbTint, 10);

  const distance = extract([/^\s*(?:Focus\s*)?Distance\s*[:=]\s*(.+)/i]);
  if (distance) result.distance = formatDistance(distance);

  const iso = extract([/^\s*ISO\s*[:=]\s*(\d+)/i]);
  if (iso) result.iso = parseInt(iso, 10);

  const shutter = extract([/^\s*Shutter\s*(?:Value|Angle)\s*[:=]\s*(.+)/i]);
  if (shutter) result.shutter = shutter;

  const camNum = extract([/^\s*Camera\s*Number\s*[:=]\s*(\w+)/i]);
  if (camNum) result.cameraNumber = camNum;

  const colorSpace = extract([/^\s*Colou?r\s*Space\s*[:=]\s*(.+)/i]);
  if (colorSpace) result.colorSpace = colorSpace;

  return result;
}

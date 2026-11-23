// @ts-nocheck
// Простой кеинг зелёнки в браузере и сборка превью «фон + настоящий спикер».
// Задача — честная проверка ракурса, масштаба и света. Чистовой кеинг делается в Premiere.

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось открыть изображение'));
    img.src = src;
  });
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Рисует картинку в прямоугольник W×H по правилу «cover» (заполнить, обрезав края). */
function drawCover(ctx, img, W, H) {
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

/**
 * «Зелёность» пикселя: насколько зелёный канал выше остальных, относительно яркости.
 * Очень тёмные пиксели (чёрная одежда, тени в волосах) считаем не зелёными.
 */
function greenness(r, g, b) {
  const d = g - (r > b ? r : b);
  if (d <= 0) return 0;
  const dn = d / (g || 1);
  const darkGuard = clamp01((g - 20) / 30); // 0 при g<20, 1 при g>50
  return dn * darkGuard;
}

/** Определяет цвет зелёнки по краям кадра (там почти всегда фон). */
function estimateKey(data, W, H) {
  let sum = 0, n = 0;
  const bw = Math.max(2, Math.round(W * 0.04));
  const bh = Math.max(2, Math.round(H * 0.04));
  const sample = (x, y) => {
    const i = (y * W + x) * 4;
    const k = greenness(data[i], data[i + 1], data[i + 2]);
    if (k > 0.05) { sum += k; n++; }
  };
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < bw; x += 2) { sample(x, y); sample(W - 1 - x, y); }
  }
  for (let x = 0; x < W; x += 2) {
    for (let y = 0; y < bh; y += 2) sample(x, y);
  }
  return n > 50 ? sum / n : 0.3;
}

/**
 * Вырезает зелёнку из fg и кладёт результат на bg. Размер результата = размер фона.
 * Возвращает JPEG data:URL (превью, весит меньше PNG).
 */
export async function composeOverBackground(fgUrl, bgUrl, { quality = 0.92 } = {}) {
  const [fg, bg] = await Promise.all([loadImage(fgUrl), loadImage(bgUrl)]);
  const W = bg.naturalWidth;
  const H = bg.naturalHeight;

  const fgCanvas = document.createElement('canvas');
  fgCanvas.width = W;
  fgCanvas.height = H;
  const fctx = fgCanvas.getContext('2d', { willReadFrequently: true });
  drawCover(fctx, fg, W, H);
  const img = fctx.getImageData(0, 0, W, H);
  const d = img.data;

  const key = estimateKey(d, W, H);
  const lo = key * 0.3;  // ниже — полностью непрозрачно
  const hi = key * 0.7;  // выше — полностью прозрачно

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const k = greenness(r, g, b);
    const alpha = 1 - clamp01((k - lo) / (hi - lo || 1));
    if (k > 0) {
      // Подавление зелёного ореола (despill): зелёный не выше максимума из красного/синего
      const m = r > b ? r : b;
      if (g > m) d[i + 1] = m;
    }
    d[i + 3] = Math.round(alpha * 255);
  }
  fctx.putImageData(img, 0, 0);

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d');
  octx.drawImage(bg, 0, 0, W, H);
  octx.drawImage(fgCanvas, 0, 0);
  return out.toDataURL('image/jpeg', quality);
}

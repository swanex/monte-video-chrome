// @ts-nocheck
// «Мастер-локация»: одна широкая панорама комнаты, привязанная к плану студии.
// Для каждой камеры по её направлению (Yaw) и углу обзора вычисляется сектор панорамы,
// который окажется за спикером. Этот кусок вырезается геометрически и отдаётся модели
// как жёсткая подсказка — так разные камеры гарантированно видят одну и ту же комнату.
//
// Модель панорамы — цилиндрическая: горизонталь линейна по углу, снята из центра сцены (среднее положение спикеров).
// Рамка камеры = куда её лучи обзора упираются в «стены» (окружность радиуса ROOM_RADIUS_M вокруг спикеров).
// Направление «вправо» на панораме = рост угла на плане (ось Y плана смотрит вниз).

export const GENERATED_PANORAMA_HFOV = 150;
export const MIN_PANORAMA_ASPECT = 1.7; // уже 16:9 — не панорама

/** Разница углов в диапазоне −180…180. */
export const angDiff = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;

/** Средний угол (корректно через 180°/−180°). */
export function circularMeanDeg(angles) {
  if (!angles.length) return -90;
  let sx = 0, sy = 0;
  for (const a of angles) {
    sx += Math.cos((a * Math.PI) / 180);
    sy += Math.sin((a * Math.PI) / 180);
  }
  return Math.round((Math.atan2(sy, sx) * 180) / Math.PI);
}

export function activePanoramaVersion(project) {
  const p = project?.panorama;
  if (!p || !p.activeId) return null;
  return p.versions.find(v => v.id === p.activeId) || null;
}

/** Подпись состояния панорамы: если поменялась версия, поворот или охват — фоны камер устарели. */
export function panoramaSignature(project) {
  const v = activePanoramaVersion(project);
  if (!v) return null;
  return `${v.id}|${project.panorama.rotation || 0}|${v.hfov}`;
}

/** Азимут центра панорамы на плане. */
export function panoramaCenterAz(project) {
  const p = project.panorama;
  return (p.baseAz ?? -90) + (p.rotation || 0);
}

/** Радиус «стен» виртуальной комнаты вокруг спикеров, м. Фон за спикером считаем на этом расстоянии. */
export const ROOM_RADIUS_M = 6;

/** Центр сцены — среднее положение спикеров (или середина зоны хромакея, если спикеров нет). */
export function sceneCenter(project) {
  const sp = project.speakers || [];
  if (sp.length) {
    return { x: sp.reduce((a, s) => a + s.x, 0) / sp.length, y: sp.reduce((a, s) => a + s.y, 0) / sp.length };
  }
  return { x: 9.6, y: 2.4 };
}

/**
 * Азимут (от центра сцены) точки, где луч из камеры под углом rayDeg упирается в стены комнаты.
 * Комната — окружность радиуса R вокруг спикеров. Из-за этого на рамку влияет
 * и поворот камеры, и её положение на плане (параллакс).
 */
function wallAzimuth(cam, rayDeg, S, R) {
  const dx = Math.cos((rayDeg * Math.PI) / 180);
  const dy = Math.sin((rayDeg * Math.PI) / 180);
  const fx = cam.x - S.x, fy = cam.y - S.y;
  // |F + t·D|² = R²  →  t² + 2(F·D)t + |F|² − R² = 0, берём положительный корень
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - R * R;
  const disc = b * b - c;
  const t = -b + Math.sqrt(Math.max(0, disc));
  const px = fx + t * dx, py = fy + t * dy;
  return (Math.atan2(py, px) * 180) / Math.PI;
}

/**
 * Сектор камеры на панораме в долях ширины [0..1].
 * fovDeg — горизонтальный угол обзора камеры (с учётом кропа).
 */
export function cameraSector(project, camera, fovDeg) {
  const v = activePanoramaVersion(project);
  if (!v) return null;
  const S = sceneCenter(project);
  const distToScene = Math.hypot(camera.x - S.x, camera.y - S.y);
  const R = Math.max(ROOM_RADIUS_M, distToScene + 1); // камера всегда внутри «комнаты»
  const center = panoramaCenterAz(project);
  const toFrac = (az) => 0.5 + angDiff(az, center) / v.hfov;
  const azL = wallAzimuth(camera, camera.angle - fovDeg / 2, S, R);
  const azR = wallAzimuth(camera, camera.angle + fovDeg / 2, S, R);
  let left = toFrac(azL);
  let right = toFrac(azR);
  if (right < left) right += 360 / v.hfov; // сектор переходит через «шов» панорамы 360°
  const outside = v.hfov < 360 && (left < -0.001 || right > 1.001);
  return { left, right, outside };
}

/** Оценка охвата загруженной панорамы по пропорциям (вертикальный охват телефона ≈ 50–60°). */
export function estimateHfovFromAspect(aspect) {
  return Math.max(60, Math.min(360, Math.round(aspect * 52)));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось открыть изображение'));
    img.src = src;
  });
}

/** Уменьшает картинку до maxW по ширине (JPEG). Возвращает { url, width, height }. */
export async function downscaleImage(dataUrl, maxW = 8192, quality = 0.9) {
  const img = await loadImage(dataUrl);
  const s = Math.min(1, maxW / img.naturalWidth);
  const w = Math.round(img.naturalWidth * s);
  const h = Math.round(img.naturalHeight * s);
  if (s === 1 && dataUrl.startsWith('data:image/jpeg')) return { url: dataUrl, width: w, height: h };
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return { url: c.toDataURL('image/jpeg', quality), width: w, height: h };
}

export async function imageSize(dataUrl) {
  const img = await loadImage(dataUrl);
  return { width: img.naturalWidth, height: img.naturalHeight };
}

/**
 * Вырезает из панорамы кусок, который видит камера: по ширине — её угол обзора,
 * по высоте — пропорции кадра, по вертикали смещение по наклону (Tilt).
 * Для панорамы 360° края склеиваются.
 */
export async function cropCameraSector(project, camera, fovDeg, frameAspect = 16 / 9) {
  const v = activePanoramaVersion(project);
  if (!v) return null;
  const img = await loadImage(v.imageUrl);
  const W = img.naturalWidth, H = img.naturalHeight;
  const pxPerDeg = W / v.hfov;
  const sector = cameraSector(project, camera, fovDeg);

  let cropW = Math.max(16, (sector.right - sector.left) * W);
  let cropH = cropW / frameAspect;
  if (cropH > H) { cropH = H; }
  const centerX = ((sector.left + sector.right) / 2) * W;
  let centerY = H / 2 - (camera.tilt || 0) * pxPerDeg;
  centerY = Math.max(cropH / 2, Math.min(H - cropH / 2, centerY));

  const outW = Math.max(1024, Math.min(2048, Math.round(cropW)));
  const outH = Math.round(outW * (cropH / cropW));
  const c = document.createElement('canvas');
  c.width = outW; c.height = outH;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, outW, outH);
  const sx = centerX - cropW / 2;
  const sy = centerY - cropH / 2;
  const scale = outW / cropW;
  // Рисуем панораму с повтором слева/справа, чтобы сектор через край тоже вырезался
  const offsets = v.hfov >= 360 ? [-W, 0, W] : [0];
  for (const off of offsets) {
    ctx.drawImage(img, (off - sx) * scale, -sy * scale, W * scale, H * scale);
  }
  return c.toDataURL('image/jpeg', 0.92);
}

export function buildPanoramaPrompt(project, translatedNotes = '') {
  const notes = translatedNotes
    ? `Director notes: ${translatedNotes}`
    : (project.russianComment ? `Director notes (RU): ${project.russianComment}` : '');
  return [
    `TASK: Create the MASTER PANORAMA of one interior location for a multi-camera virtual production (green screen) set.`,
    `Output ONE seamless, photorealistic horizontal panorama covering about ${GENERATED_PANORAMA_HFOV}° of the room, cylindrical projection like a phone panorama. Eye level about 1.3 m, horizon exactly at the vertical middle, all vertical lines perfectly vertical, even exposure and identical lighting across the whole width.`,
    `The location is shown in the attached reference photo(s). Keep the room's architecture, materials, colors, furniture style and light direction. Where the references do not show part of the room, extend it plausibly in exactly the same style.`,
    `This panorama is what the cameras will see BEHIND the speakers. Keep the foreground empty: no people, no chairs, tables or props in the foreground (those are physical objects on the stage). Furniture standing along the walls in the background is fine.`,
    notes,
    `No text, no watermark, no visible stitching seams, no fisheye distortion.`
  ].filter(Boolean).join('\n\n');
}

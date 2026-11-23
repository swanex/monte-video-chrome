// @ts-nocheck
import React, { useState } from 'react';
import { useElapsed, formatElapsed } from './useElapsed';
import { GalleryHorizontal as Panorama, Upload, Sparkles, RotateCw, MoveHorizontal, AlertTriangle, Maximize2, Minimize2 } from 'lucide-react';
import { cameraSector, activePanoramaVersion } from './panorama';

function hexToRgba(hex, a) {
  const c = (hex || '#D9FF00').replace('#', '');
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Рамки сектора: при панораме 360° сектор через край рисуется двумя частями. */
function sectorRects(sector, wraps) {
  const { left, right } = sector;
  if (!wraps) return [{ l: Math.max(0, left), r: Math.min(1, right) }];
  const rects = [];
  const norm = (x) => ((x % 1) + 1) % 1;
  const L = norm(left), R = norm(right);
  if (right - left >= 1) return [{ l: 0, r: 1 }];
  if (L <= R) rects.push({ l: L, r: R });
  else { rects.push({ l: L, r: 1 }); rects.push({ l: 0, r: R }); }
  return rects;
}

export default function PanoramaPanel({
  project,
  activeCameraId,
  accentColor,
  fovFor,
  busy,
  generating,
  refsCount,
  hasNotes,
  onGenerate,
  onUpload,
  onSelectVersion,
  onRotation,
  onHfov,
  onSelectCamera
}) {
  const pano = project.panorama;
  const active = activePanoramaVersion(project);
  const versions = pano?.versions || [];
  const [large, setLarge] = useState(false);
  const [ratio, setRatio] = useState(21 / 9);
  const elapsed = useElapsed(generating);

  const fileInput = (
    <input
      type="file"
      accept="image/jpeg,image/png,image/webp"
      className="hidden"
      onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }}
    />
  );

  return (
    <div className="bg-[#0E0E0E] border border-[#262626] rounded-2xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-[#1E1E1E] bg-[#121212]">
        <div className="flex items-center gap-2 min-w-0">
          <Panorama className="w-4 h-4 shrink-0" style={{ color: accentColor }} />
          <span className="text-xs font-semibold tracking-wide text-white uppercase">Панорама локации</span>
          {active ? (
            <span className="text-[11px] text-neutral-400 truncate">
              · {active.source === 'uploaded' ? 'загружена' : 'сгенерирована'} · охват {active.hfov}° · v{versions.length - versions.indexOf(active)}
            </span>
          ) : (
            <span className="text-[11px] text-neutral-500">· нет — фоны генерируются без привязки к общей комнате</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {active && (
            <button
              onClick={() => setLarge(v => !v)}
              title={large ? 'Уменьшить панораму' : 'Показать панораму крупнее'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1C1C1C] hover:bg-[#262626] border border-[#333333] text-xs font-medium text-neutral-300 hover:text-white transition"
            >
              {large ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              {large ? 'Меньше' : 'Крупнее'}
            </button>
          )}
          <button
            onClick={onGenerate}
            disabled={busy}
            style={{ backgroundColor: accentColor }}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-black text-xs font-bold hover:brightness-110 disabled:opacity-50 transition"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {busy ? 'Генерируем панораму…' : '1 · Сгенерировать панораму'}
          </button>
          <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1C1C1C] hover:bg-[#262626] border border-[#333333] text-xs font-medium text-white cursor-pointer transition">
            <Upload className="w-3.5 h-3.5" style={{ color: accentColor }} />
            Загрузить свою
            {fileInput}
          </label>
        </div>
      </div>

      <div className="relative">
      {generating && (
        <div className="absolute inset-0 z-20 min-h-[180px] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="w-10 h-10 shrink-0 rounded-full border-2 border-[#262626] animate-spin" style={{ borderTopColor: accentColor }} />
          <div className="text-sm font-semibold text-white">
            Генерируем панораму локации <span className="font-mono" style={{ color: accentColor }}>{formatElapsed(elapsed)}</span>
          </div>
          <div className="text-xs text-neutral-400 max-w-lg leading-relaxed">
            Отправили модели: {[refsCount > 0 ? `фото локации (${refsCount})` : null, hasNotes ? 'комментарий оператора' : null].filter(Boolean).join(' и ') || 'только задание'}.
            Задание: одна широкая панорама 21:9 с охватом около 150°, горизонт посередине, без людей и без мебели на переднем плане.
            <br />Обычно это 20–60 секунд. Потом на панораме появятся рамки камер.
          </div>
        </div>
      )}
      {!active ? (
        <div className={`px-4 py-5 text-[11px] text-neutral-500 leading-relaxed ${generating ? 'min-h-[180px]' : ''}`}>
          Панорама — одна широкая картинка комнаты, общая для всех камер. По плану приложение вычисляет, какой её кусок
          окажется за спикером у каждой камеры, поэтому камеры с разных сторон видят одну и ту же комнату.
          Сгенерируйте панораму по фото локации или загрузите свою: панораму с телефона или широкий кадр (не уже 16:9).
        </div>
      ) : (
        <div className="p-3 space-y-3">
          {/* Панорама с рамками камер */}
          <div className="flex justify-center bg-black rounded-lg">
          {/* Панорама вписывается в ширину полосы, но не выше 42% (или 80%) экрана; рамки камер привязаны к самой картинке */}
          <div
            className="relative rounded-lg overflow-hidden select-none"
            style={{ width: `min(100%, calc(${large ? 80 : 42}vh * ${ratio}))`, aspectRatio: String(ratio) }}
          >
            <img
              src={active.imageUrl}
              alt="Панорама локации"
              className="block w-full h-full"
              draggable={false}
              onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setRatio(i.naturalWidth / i.naturalHeight); }}
            />
            {project.cameras.map(cam => {
              const sector = cameraSector(project, cam, fovFor(cam));
              if (!sector) return null;
              const isActive = cam.id === activeCameraId;
              const color = isActive ? accentColor : '#A3A3A3';
              return sectorRects(sector, active.hfov >= 360).map((r, i) => (
                <button
                  key={`${cam.id}_${i}`}
                  onClick={() => onSelectCamera(cam.id)}
                  title={`${cam.name}: этот кусок комнаты будет за спикером`}
                  className="absolute top-0 bottom-0 border-2 rounded-md transition"
                  style={{
                    left: `${r.l * 100}%`,
                    width: `${Math.max(0.5, (r.r - r.l) * 100)}%`,
                    borderColor: color,
                    backgroundColor: isActive ? hexToRgba(accentColor, 0.12) : 'rgba(0,0,0,0.15)',
                    zIndex: isActive ? 2 : 1
                  }}
                >
                  {i === 0 && (
                    <span
                      className="absolute left-1 top-1 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap"
                      style={{ backgroundColor: isActive ? accentColor : 'rgba(0,0,0,0.75)', color: isActive ? '#0B0B0B' : '#FFFFFF' }}
                    >
                      {cam.name} · {Math.round(fovFor(cam))}°
                    </span>
                  )}
                  {i === 0 && sector.outside && (
                    <span className="absolute left-1 bottom-1 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-400 text-black whitespace-nowrap">
                      <AlertTriangle className="w-3 h-3" /> за краем панорамы
                    </span>
                  )}
                </button>
              ));
            })}
          </div>
          </div>

          {/* Настройки привязки */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="flex justify-between text-[11px] text-neutral-400 mb-1">
                <span className="flex items-center gap-1.5"><RotateCw className="w-3 h-3" /> Поворот комнаты относительно студии</span>
                <span className="font-mono text-white">{pano.rotation || 0}°</span>
              </div>
              <input
                type="range" min="-180" max="180" step="1"
                value={pano.rotation || 0}
                onChange={(e) => onRotation(parseInt(e.target.value, 10))}
                style={{ accentColor }}
                className="w-full cursor-pointer h-1.5 bg-[#262626] rounded-lg"
              />
            </div>
            <div>
              <div className="flex justify-between text-[11px] text-neutral-400 mb-1">
                <span className="flex items-center gap-1.5"><MoveHorizontal className="w-3 h-3" /> Охват панорамы</span>
                <span className="font-mono text-white">{active.hfov}°</span>
              </div>
              <input
                type="range" min="60" max="360" step="5"
                value={active.hfov}
                onChange={(e) => onHfov(parseInt(e.target.value, 10))}
                style={{ accentColor }}
                className="w-full cursor-pointer h-1.5 bg-[#262626] rounded-lg"
              />
            </div>
          </div>

          {/* Версии панорамы */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500 whitespace-nowrap">Версии ({versions.length})</span>
            <div className="flex gap-1.5 overflow-x-auto">
              {[...versions].reverse().map((v, i) => {
                const isSel = v.id === active.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => onSelectVersion(v.id)}
                    title={`${v.source === 'uploaded' ? 'Загружена' : 'Сгенерирована'} · ${v.timestamp}`}
                    className="relative shrink-0 h-10 aspect-[21/9] rounded-md overflow-hidden border-2 transition"
                    style={{ borderColor: isSel ? accentColor : '#262626' }}
                  >
                    <img src={v.imageUrl} alt="" className="w-full h-full object-cover" />
                    <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[9px] font-mono text-white text-center leading-tight whitespace-nowrap">
                      v{i + 1} · {v.source === 'uploaded' ? 'своя' : v.timestamp}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

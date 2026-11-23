// @ts-nocheck
// Перенесено из Gemini Canvas (итерация 2) без изменений логики.
// Типизация и разбиение на модули — следующий этап (см. HANDOFF.md, раздел 7).
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Camera,
  Plus,
  Trash2,
  Copy,
  Download,
  Upload,
  Settings,
  History,
  Layers,
  Film,
  Sparkles,
  Users,
  Armchair,
  ChevronDown,
  ChevronRight,
  X,
  FileText,
  FolderOpen,
  Play,
  Pause,
  Wand2,
  AlertCircle,
  CheckCircle2,
  Image as ImageIcon,
  Compass,
  Code,
  RotateCcw,
  Columns,
  Maximize2,
  SlidersHorizontal,
  Palette,
  Sprout,
  Disc
} from 'lucide-react';
import { parseBrawMetadata, detectCropFactor } from './braw';
import { composeOverBackground } from './chromakey';
import { loadProjects, saveProjects, requestPersistentStorage, cleanupUnusedImages, getStorageEstimate } from './storage';

// ============================================================================
// CONSTANTS & GEOMETRY (12m x 9m Studio, Fixed Corner Chroma Key)
// ============================================================================

const STUDIO_W = 12.0; // meters
const STUDIO_H = 9.0;  // meters

// Fixed 5-vertex corner chroma key polygon in top-right corner of 12m x 9m room:
// - Top wall: 6.3m  -> (5.7, 0) to (12.0, 0)
// - Right wall: 5.1m -> (12.0, 0) to (12.0, 5.1)
// - Bottom edge: 3.0m -> (12.0, 5.1) to (9.0, 5.1)
// - Left short edge: 1.25m -> (5.7, 0) to (5.7, 1.25)
// - Slanted diagonal connecting (5.7, 1.25) to (9.0, 5.1)
const CHROMA_POLY = [
  { x: 5.7, y: 0.0 },
  { x: 12.0, y: 0.0 },
  { x: 12.0, y: 5.1 },
  { x: 9.0, y: 5.1 },
  { x: 5.7, y: 1.25 }
];

const STORAGE_KEY_PROJECTS = 'mv_chrome_projects_v1';
const STORAGE_KEY_API = 'mv_chrome_api_key_v1';
const STORAGE_KEY_ACCENT = 'mv_chrome_accent_v1';
const DEFAULT_ACCENT = '#D9FF00';
const HISTORY_LIMIT = 16;

const SAFE_ACCENT_PRESETS = [
  { name: 'Кислотный лайм', hex: '#D9FF00' },
  { name: 'Неон-циан', hex: '#00E5FF' },
  { name: 'Солнечный янтарь', hex: '#FFB800' },
  { name: 'Коралловый', hex: '#FF6B6B' },
  { name: 'Лавандовый', hex: '#C084FC' },
  { name: 'Мятный', hex: '#34D399' },
  { name: 'Чистый белый', hex: '#F5F5F5' }
];

const SAMPLE_BRAW_METADATA = `File Path: D:\\MONTE_VIDEO\\SHOOT_01\\A001_05141230_C001.braw
Type: Blackmagic RAW
Image Size: 3840 x 2160
Frame Rate: 25.00
Camera Type: Blackmagic Studio Camera 4K Pro
Camera Number: 1
Lens Type: OLYMPUS M.40-150mm F2.8
Focal Length: 55mm
Aperture: f4.0
Distance: 3.2m
ISO: 400
Shutter Value: 180.0°
White Balance Kelvin: 4000K
White Balance Tint: 0
Color Space: Blackmagic Design Film Gen 5`;

// Catalog of individual furniture / decor items
const FURNITURE_CATALOG = {
  table: {
    type: 'table',
    label: 'Стол',
    w: 1.6,
    d: 0.8,
    heightCm: 75,
    minH: 40,
    maxH: 120,
    rotatable: true
  },
  chair: {
    type: 'chair',
    label: 'Кресло',
    w: 0.8,
    d: 0.8,
    heightCm: 45,
    minH: 30,
    maxH: 90,
    rotatable: true
  },
  sofa: {
    type: 'sofa',
    label: 'Диван',
    w: 2.2,
    d: 0.9,
    heightCm: 44,
    minH: 30,
    maxH: 90,
    rotatable: true
  },
  bar_stool: {
    type: 'bar_stool',
    label: 'Барный стул',
    w: 0.46,
    d: 0.46,
    heightCm: 75,
    minH: 55,
    maxH: 105,
    rotatable: false
  },
  plant: {
    type: 'plant',
    label: 'Напольное растение',
    w: 0.56,
    d: 0.56,
    heightCm: 140,
    minH: 40,
    maxH: 250,
    rotatable: false
  }
};

const FURNITURE_PRESETS = {
  none: { label: 'Нет мебели (стоя)', items: [] },
  table: {
    label: 'Стол',
    items: [
      { id: 'f1', type: 'table', name: 'Стол спикера', x: 9.3, y: 2.3, w: 1.6, d: 0.8, heightCm: 75, rotation: -35, rotatable: true }
    ]
  },
  two_chairs: {
    label: 'Два кресла',
    items: [
      { id: 'f1', type: 'chair', name: 'Кресло 1', x: 8.4, y: 1.8, w: 0.8, d: 0.8, heightCm: 45, rotation: -20, rotatable: true },
      { id: 'f2', type: 'chair', name: 'Кресло 2', x: 10.2, y: 2.9, w: 0.8, d: 0.8, heightCm: 45, rotation: -55, rotatable: true }
    ]
  },
  sofa: {
    label: 'Диван',
    items: [
      { id: 'f1', type: 'sofa', name: 'Диван', x: 9.5, y: 2.2, w: 2.2, d: 0.9, heightCm: 44, rotation: -38, rotatable: true }
    ]
  },
  custom: {
    label: 'Свободная расстановка',
    items: [
      { id: 'f1', type: 'table', name: 'Журнальный столик', x: 8.8, y: 2.8, w: 1.1, d: 0.6, heightCm: 48, rotation: -35, rotatable: true },
      { id: 'f2', type: 'chair', name: 'Кресло', x: 9.6, y: 1.8, w: 0.8, d: 0.8, heightCm: 45, rotation: -35, rotatable: true },
      { id: 'f3', type: 'plant', name: 'Напольное растение', x: 11.1, y: 1.1, w: 0.56, d: 0.56, heightCm: 150, rotation: 0, rotatable: false }
    ]
  }
};

const MOTION_PRESETS = [
  { id: 'static', label: 'Статика' },
  { id: 'push_in', label: 'Медленный наезд (Push-In)' },
  { id: 'pull_out', label: 'Плавный отъезд (Pull-Out)' },
  { id: 'pan_left', label: 'Панорама влево (Pan Left)' },
  { id: 'pan_right', label: 'Панорама вправо (Pan Right)' }
];

// ============================================================================
// SAFE ACCENT COLOR HELPERS (Guarantees high contrast on #0B0B0B & black text)
// ============================================================================

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function hexToRgb(hex) {
  const clean = (hex || '').replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return { r: 217, g: 255, b: 0 };
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function rgbToHex(r, g, b) {
  const toHex = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function relativeLuminance(r, g, b) {
  const toLin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

function rgbToHsl(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      case bn: h = (rn - gn) / d + 4; break;
      default: break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  };
}

/**
 * Ensures any chosen accent color stays in the "safe" high-contrast zone:
 * relative luminance >= 0.42 so both black text on accent pills and
 * accent text on dark (#0B0B0B) backgrounds remain effortlessly legible.
 */
function enforceSafeAccentColor(hex) {
  let { r, g, b } = hexToRgb(hex);
  if (relativeLuminance(r, g, b) >= 0.42) {
    return rgbToHex(r, g, b);
  }
  const hsl = rgbToHsl(r, g, b);
  let l = Math.max(hsl.l, 0.56);
  for (let i = 0; i < 20; i++) {
    const candidate = hslToRgb(hsl.h, hsl.s, l);
    if (relativeLuminance(candidate.r, candidate.g, candidate.b) >= 0.44 || l >= 0.92) {
      return rgbToHex(candidate.r, candidate.g, candidate.b);
    }
    l = Math.min(0.92, l + 0.03);
  }
  return DEFAULT_ACCENT;
}

function accentAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ============================================================================
// GEOMETRY & COLLISION GUARD HELPERS
// ============================================================================

function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function closestPointOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = clamp(t, 0, 1);
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * Collision Guard: ensures cameras NEVER enter the green chroma zone.
 */
function enforceCameraCollisionGuard(x, y) {
  const cx = clamp(x, 0.3, STUDIO_W - 0.3);
  const cy = clamp(y, 0.3, STUDIO_H - 0.3);

  if (!pointInPolygon({ x: cx, y: cy }, CHROMA_POLY)) {
    return { x: Number(cx.toFixed(2)), y: Number(cy.toFixed(2)) };
  }

  const interiorEdges = [
    [CHROMA_POLY[0], CHROMA_POLY[4]],
    [CHROMA_POLY[4], CHROMA_POLY[3]],
    [CHROMA_POLY[3], CHROMA_POLY[2]]
  ];

  let bestPt = { x: 5.5, y: 5.3 };
  let minDist = Infinity;

  for (const [a, b] of interiorEdges) {
    const candidate = closestPointOnSegment({ x: cx, y: cy }, a, b);
    const dist = Math.hypot(candidate.x - cx, candidate.y - cy);
    if (dist < minDist) {
      minDist = dist;
      bestPt = candidate;
    }
  }

  const outX = bestPt.x - 9.5;
  const outY = bestPt.y - 2.0;
  const outLen = Math.hypot(outX, outY) || 1;
  const safeX = clamp(bestPt.x + (outX / outLen) * 0.12, 0.3, STUDIO_W - 0.3);
  const safeY = clamp(bestPt.y + (outY / outLen) * 0.12, 0.3, STUDIO_H - 0.3);

  return { x: Number(safeX.toFixed(2)), y: Number(safeY.toFixed(2)) };
}

function calcHorizontalFovDeg(focalLengthMm, cropFactor = 2.0) {
  const fl = Math.max(8, Number(focalLengthMm) || 50);
  const cf = Math.max(0.5, Number(cropFactor) || 1.0);
  const eqFl = fl * cf;
  const fovRad = 2 * Math.atan(36 / (2 * eqFl));
  return clamp((fovRad * 180) / Math.PI, 8, 120);
}

// ============================================================================
// DEFAULT PROJECT FACTORY
// ============================================================================

function createDefaultCamera(index) {
  const presets = [
    { x: 4.4, y: 5.8, angle: -42, height: 1.45, tilt: -4, focalLength: 35 },
    { x: 2.8, y: 3.4, angle: -12, height: 1.4, tilt: -2, focalLength: 55 },
    { x: 6.5, y: 6.8, angle: -65, height: 1.5, tilt: -5, focalLength: 50 },
    { x: 3.6, y: 7.2, angle: -48, height: 1.8, tilt: -10, focalLength: 24 },
    { x: 8.2, y: 6.6, angle: -82, height: 1.35, tilt: 0, focalLength: 75 }
  ];
  const p = presets[index % presets.length];
  return {
    id: `cam_${Date.now()}_${index}`,
    name: `CAM ${index + 1}`,
    x: p.x,
    y: p.y,
    angle: p.angle,
    height: p.height,
    tilt: p.tilt,
    cameraType: 'Blackmagic Studio Camera 4K Pro',
    cropFactor: 2.0,
    lensType: 'OLYMPUS M.40-150mm F2.8',
    focalLength: p.focalLength,
    aperture: 'f4.0',
    wbKelvin: 4000,
    wbTint: 0,
    distance: '3.4m',
    iso: 400,
    shutter: '180.0°',
    cameraNumber: String(index + 1),
    colorSpace: 'Blackmagic Design Film Gen 5',
    inputImage: null,
    previewImage: null,
    cleanPlateImage: null,
    history: [],
    timelineClip: {
      startSec: 0,
      endSec: 12,
      motion: 'static'
    }
  };
}

function createDefaultProject(name = 'Интервью — Студия А') {
  return {
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    updatedAt: new Date().toISOString(),
    resolution: '1080p',
    aspectRatio: '16:9',
    cameras: [createDefaultCamera(0), createDefaultCamera(1)],
    speakers: [
      { id: 'spk_1', name: 'Спикер 1', x: 8.6, y: 2.2, pose: 'sitting' },
      { id: 'spk_2', name: 'Спикер 2', x: 10.1, y: 3.1, pose: 'sitting' }
    ],
    furniturePreset: 'two_chairs',
    furniture: JSON.parse(JSON.stringify(FURNITURE_PRESETS.two_chairs.items)),
    locationRefs: [],
    russianComment: 'Современная светлая лофт-студия с тёплым архитектурным светом, мягким боке на заднем плане и аккуратным декором.',
    customPromptOverride: ''
  };
}

// ============================================================================
// PROMPT BUILDER & OFF-SCREEN TOP-VIEW SNAPSHOT RENDERER
// ============================================================================

function buildAutoPrompt(project, camera, stage = 'A', translatedComment = '') {
  const eqFocal = Math.round((camera.focalLength || 50) * (camera.cropFactor || 1.0));
  const fov = Math.round(calcHorizontalFovDeg(camera.focalLength, camera.cropFactor));

  const speakersDesc = project.speakers.length > 0
    ? project.speakers.map((s, idx) => {
        const dist = Math.hypot(s.x - camera.x, s.y - camera.y).toFixed(1);
        return `Speaker ${idx + 1} (${s.pose === 'sitting' ? 'sitting, eye-level ~1.18m' : 'standing, eye-level ~1.65m'}) at studio coords (${s.x.toFixed(1)}m, ${s.y.toFixed(1)}m), distance ${dist}m from camera`;
      }).join('; ')
    : 'No speakers on set';

  const typeEnMap = {
    table: 'Table',
    chair: 'Armchair',
    sofa: 'Sofa',
    bar_stool: 'Bar stool',
    plant: 'Floor potted plant'
  };

  const furnitureDesc = project.furniture.length > 0
    ? project.furniture.map(f => {
        const enType = typeEnMap[f.type] || f.name;
        return `${enType} (${f.name}, height ${f.heightCm}cm) at (${f.x.toFixed(1)}m, ${f.y.toFixed(1)}m)`;
      }).join('; ')
    : 'No furniture (standing setup)';

  const commentSection = translatedComment
    ? `Director/Operator notes: ${translatedComment}`
    : (project.russianComment ? `Director/Operator notes (RU): ${project.russianComment}` : '');

  const opticsBlock = [
    `Camera: ${camera.cameraType} (Crop factor ${camera.cropFactor}x), Lens: ${camera.lensType}.`,
    `Optics: ${camera.focalLength}mm native (~${eqFocal}mm full-frame equivalent, horizontal FOV ~${fov}°), Aperture ${camera.aperture} for physically accurate depth-of-field and background bokeh.`,
    `Lighting & Color Temp: Match White Balance ${camera.wbKelvin}K (Tint ${camera.wbTint >= 0 ? '+' : ''}${camera.wbTint}), ISO ${camera.iso}, Shutter ${camera.shutter}.`,
    `Camera Position & Z-Axis: Top-view coords (X=${camera.x.toFixed(2)}m, Y=${camera.y.toFixed(2)}m), Yaw=${Math.round(camera.angle)}°, Camera Height=${camera.height.toFixed(2)}m above floor, Vertical Tilt=${camera.tilt >= 0 ? '+' : ''}${camera.tilt}°.`,
    `Target Format: ${project.aspectRatio} aspect ratio, ${project.resolution} cinema quality.`
  ].join(' ');

  if (stage === 'BG') {
    const propsLine = project.furniture.length > 0
      ? `The on-set props standing on the green screen (${furnitureDesc}) are physical objects that come with the keyed footage — do NOT draw them.`
      : '';
    return [
      `TASK: Generate the EMPTY background plate for a green-screen shot (virtual production). Output only the room — no people.`,
      `IMAGE 1 is the real camera frame shot on a green screen. Use it ONLY as a camera reference: read its exact framing, lens perspective, horizon line, camera height and tilt, where the floor is, and the direction, softness and color of the light falling on the speaker. Do NOT copy the speaker or anything green.`,
      `The following image(s) show the location. Recreate THIS room as seen through exactly the same camera as IMAGE 1, as if the green screen and everyone on it were not there.`,
      `The real speaker will be keyed out of IMAGE 1 and composited back on top at exactly the same pixel position and scale. Therefore the floor plane, horizon and vanishing points must line up with IMAGE 1 pixel-for-pixel, and the background directly behind the speaker's position must make physical sense at that distance and scale.`,
      `The last image is a top-view plan of the studio: the active camera ${camera.name} is highlighted in lime; its cone shows the viewing direction.`,
      propsLine,
      opticsBlock,
      commentSection,
      `Output: a photorealistic, completely empty background plate — zero people, zero silhouettes, zero green, zero on-set props, same aspect ratio and framing as IMAGE 1, depth of field and bokeh matching aperture ${camera.aperture}.`
    ].filter(Boolean).join('\n\n');
  }

  if (stage === 'A') {
    return [
      `TASK: Photorealistic virtual production chroma-key background replacement (Stage A — Preview with Speakers).`,
      `Replace the green screen background from the provided camera stop-frame with the interior environment shown in the location reference image(s), strictly respecting the exact 3D perspective and camera angle highlighted in the attached Top-View Studio Plan (${camera.name} in bright acid lime).`,
      `PRESERVE SUBJECTS: Keep the exact speakers, clothing, faces, hair, poses, and key lighting from the input frame intact without altering their identity.`,
      opticsBlock,
      `On-Set Blocking: ${speakersDesc}. Furniture & Props: ${furnitureDesc}.`,
      commentSection,
      `Ensure realistic perspective lines matching camera height (${camera.height.toFixed(2)}m) and tilt (${camera.tilt}°), natural light wrap, zero green spill, cinema broadcast realism.`
    ].filter(Boolean).join('\n\n');
  }

  const onSetProps = project.furniture.length > 0
    ? `Also remove ALL on-set foreground furniture and props that the speakers use or that stand in the chroma-key zone: ${furnitureDesc}. These are physical objects on the green-screen stage; they will be composited back from the keyed camera footage, so they must NOT appear in the background plate. Remove their shadows and contact shadows on the floor as well.`
    : '';

  return [
    `TASK: Photorealistic empty background plate (Stage B — empty location for compositing).`,
    `Using the attached Stage A preview image as the exact spatial and lighting reference, produce the SAME location completely empty: remove every person (speakers, silhouettes, reflections of people).`,
    onSetProps,
    `Reconstruct the floor, walls and background that were hidden behind the removed people and objects, continuing the existing textures, lines and lighting naturally.`,
    `KEEP: the location's own architecture and background decor that is part of the room itself (walls, windows, shelves, lamps, distant furniture far behind the set) exactly as in the Stage A image.`,
    `CRITICAL CONSISTENCY: Keep the exact camera perspective, framing, horizon, wall geometry, depth of field, bokeh, and ${camera.wbKelvin}K lighting 100% identical to the Stage A image so the keyed speaker footage composites seamlessly on top in Adobe Premiere Pro.`,
    opticsBlock,
    `Output: a clean, empty background plate with zero people, zero on-set furniture, zero silhouettes, zero artifacts.`
  ].filter(Boolean).join('\n\n');
}

function renderTopViewSnapshotBase64(project, activeCameraId) {
  const canvas = document.createElement('canvas');
  const W = 720;
  const H = 540;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const sx = (mx) => (mx / STUDIO_W) * W;
  const sy = (my) => (my / STUDIO_H) * H;

  ctx.fillStyle = '#0E0E0E';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = '#222222';
  ctx.lineWidth = 1;
  for (let x = 0; x <= STUDIO_W; x++) {
    ctx.beginPath();
    ctx.moveTo(sx(x), 0);
    ctx.lineTo(sx(x), H);
    ctx.stroke();
  }
  for (let y = 0; y <= STUDIO_H; y++) {
    ctx.beginPath();
    ctx.moveTo(0, sy(y));
    ctx.lineTo(W, sy(y));
    ctx.stroke();
  }

  // Chroma polygon
  ctx.beginPath();
  CHROMA_POLY.forEach((p, i) => {
    if (i === 0) ctx.moveTo(sx(p.x), sy(p.y));
    else ctx.lineTo(sx(p.x), sy(p.y));
  });
  ctx.closePath();
  ctx.fillStyle = 'rgba(22, 163, 74, 0.28)';
  ctx.fill();
  ctx.strokeStyle = '#22C55E';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Furniture & Decor
  project.furniture.forEach(f => {
    ctx.save();
    ctx.translate(sx(f.x), sy(f.y));
    if (f.type === 'plant') {
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(16, 185, 129, 0.4)';
      ctx.fill();
      ctx.strokeStyle = '#34D399';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (f.type === 'bar_stool') {
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fillStyle = '#3F3F46';
      ctx.fill();
      ctx.strokeStyle = '#D4D4D8';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.rotate(((f.rotation || 0) * Math.PI) / 180);
      ctx.fillStyle = '#3F3F46';
      ctx.strokeStyle = '#A1A1AA';
      ctx.lineWidth = 1.5;
      const rw = (f.w / STUDIO_W) * W;
      const rd = (f.d / STUDIO_H) * H;
      ctx.fillRect(-rw / 2, -rd / 2, rw, rd);
      ctx.strokeRect(-rw / 2, -rd / 2, rw, rd);
    }
    ctx.restore();
  });

  // Speakers
  project.speakers.forEach((s, idx) => {
    ctx.beginPath();
    ctx.arc(sx(s.x), sy(s.y), 12, 0, Math.PI * 2);
    ctx.fillStyle = s.pose === 'sitting' ? '#38BDF8' : '#F59E0B';
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`S${idx + 1}`, sx(s.x), sy(s.y));
  });

  // Cameras + FOV cones (always bright lime in AI snapshot to match prompt)
  project.cameras.forEach((c) => {
    const isActive = c.id === activeCameraId;
    const cx = sx(c.x);
    const cy = sy(c.y);
    const fov = calcHorizontalFovDeg(c.focalLength, c.cropFactor);
    const radAngle = (c.angle * Math.PI) / 180;
    const halfFov = ((fov / 2) * Math.PI) / 180;
    const coneLen = 280;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(radAngle - halfFov) * coneLen, cy + Math.sin(radAngle - halfFov) * coneLen);
    ctx.lineTo(cx + Math.cos(radAngle + halfFov) * coneLen, cy + Math.sin(radAngle + halfFov) * coneLen);
    ctx.closePath();
    ctx.fillStyle = isActive ? 'rgba(217, 255, 0, 0.25)' : 'rgba(255, 255, 255, 0.06)';
    ctx.fill();
    ctx.strokeStyle = isActive ? '#D9FF00' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = isActive ? 2 : 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, isActive ? 14 : 10, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? '#D9FF00' : '#262626';
    ctx.fill();
    ctx.strokeStyle = isActive ? '#0B0B0B' : '#A1A1AA';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = isActive ? '#0B0B0B' : '#FFFFFF';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.name.replace('CAM ', 'C'), cx, cy);
  });

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('MONTE VIDEO — TOP-VIEW STUDIO PLAN (12m x 9m) — ACTIVE CAMERA IN LIME', 16, H - 16);

  return canvas.toDataURL('image/png').split(',')[1];
}

// ============================================================================
// GEMINI API HELPERS (Exponential Backoff, Translation + Nano Banana 2)
// ============================================================================

async function fetchWithBackoff(url, options, maxRetries = 3) {
  let delay = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429 || response.status >= 500) {
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, delay));
          delay *= 2;
          continue;
        }
      }
      return response;
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      throw err;
    }
  }
}

function splitDataUrl(dataUrl) {
  if (!dataUrl || !dataUrl.includes(',')) return null;
  const [meta, data] = dataUrl.split(',');
  const mimeMatch = meta.match(/data:([^;]+);/);
  return {
    mimeType: mimeMatch ? mimeMatch[1] : 'image/png',
    data
  };
}

async function translateRussianNotesToEnglish(ruText, apiKey) {
  if (!ruText || !ruText.trim()) return '';
  try {
    const key = apiKey || '';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`;
    const payload = {
      contents: [{ parts: [{ text: ruText }] }],
      systemInstruction: {
        parts: [{
          text: 'You are a virtual production cinematographer translator. Translate the following Russian studio set & lighting notes into concise, accurate English suitable for an image generation prompt. Return ONLY the translated English text.'
        }]
      }
    };
    const res = await fetchWithBackoff(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) return ruText;
    const json = await res.json();
    return json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ruText;
  } catch {
    return ruText;
  }
}

async function generateImageWithGemini({ prompt, images = [], aspectRatio = '16:9', apiKey = '' }) {
  const key = apiKey || '';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=${key}`;

  const parts = [{ text: prompt }];
  for (const img of images) {
    if (img && img.data && img.mimeType) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.data
        }
      });
    }
  }

  const payload = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: aspectRatio === '9:16' ? '9:16' : '16:9'
      }
    }
  };

  const res = await fetchWithBackoff(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();
  if (!res.ok) {
    const msg = result?.error?.message || `API HTTP ${res.status}`;
    throw new Error(msg);
  }

  const candidateParts = result?.candidates?.[0]?.content?.parts || [];
  const imgPart = candidateParts.find(p => p.inlineData?.data);
  if (!imgPart) {
    const textReply = candidateParts.find(p => p.text)?.text;
    throw new Error(textReply || 'Модель не вернула изображение. Попробуйте уточнить промпт или референсы.');
  }

  return `data:${imgPart.inlineData.mimeType || 'image/png'};base64,${imgPart.inlineData.data}`;
}

function downloadImageAtResolution(dataUrl, filename, resolution = '1080p', aspectRatio = '16:9') {
  const dims = {
    '1080p': aspectRatio === '9:16' ? [1080, 1920] : [1920, 1080],
    '2K': aspectRatio === '9:16' ? [1440, 2560] : [2560, 1440],
    '4K': aspectRatio === '9:16' ? [2160, 3840] : [3840, 2160]
  }[resolution] || [1920, 1080];

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = dims[0];
    canvas.height = dims[1];
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, dims[0], dims[1]);
    const outUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = outUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  img.src = dataUrl;
}

// ============================================================================
// BRAND LOGO SVG (MONTE VIDEO)
// ============================================================================

function MonteVideoLogo() {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <svg width="26" height="26" viewBox="1008.8 197.22 85.04 85.04" fill="#FFFFFF" xmlns="http://www.w3.org/2000/svg" className="shrink-0" aria-label="MONTE VIDEO">
        <polygon points="1050.96 248.52 1040.77 210.75 1035.12 210.75 1035.12 259.21 1040.77 259.21 1040.77 231.98 1048.22 259.21 1053.77 259.21 1060.87 232.54 1060.87 268.73 1066.52 268.73 1066.52 210.75 1060.87 210.75 1050.96 248.52" />
        <path d="M1051.32,197.22c-23.45,0-42.52,19.07-42.52,42.52s19.07,42.52,42.52,42.52,42.52-19.07,42.52-42.52-19.07-42.52-42.52-42.52ZM1051.32,277.42c-20.78,0-37.68-16.9-37.68-37.68s16.9-37.68,37.68-37.68,37.68,16.9,37.68,37.68-16.9,37.68-37.68,37.68Z" />
      </svg>
      <div className="flex flex-col leading-none">
        <span className="text-white font-bold tracking-[0.14em] text-sm">MONTE VIDEO</span>
        <span className="text-[10px] tracking-[0.18em] text-neutral-500 uppercase mt-0.5">Проект Хром</span>
      </div>
    </div>
  );
}

// ============================================================================
// MINI SIDE-VIEW ELEVATION WIDGET (Z-Axis Height & Tilt)
// ============================================================================

function SideViewElevation({ camera, speakers, furniture, accentColor, onChange }) {
  const maxHeightM = 3.0;
  const W = 280;
  const H = 128;
  const floorY = H - 18;
  const scaleY = (H - 34) / maxHeightM;

  const camX = 48;
  const camY = floorY - clamp(camera.height, 0.3, 2.8) * scaleY;

  const primarySpeaker = speakers[0];
  const isSitting = !primarySpeaker || primarySpeaker.pose === 'sitting';
  const spkX = 215;
  const spkEyeHeight = isSitting ? 1.18 : 1.65;
  const spkEyeY = floorY - spkEyeHeight * scaleY;

  const tiltRad = (-camera.tilt * Math.PI) / 180;
  const rayLen = 195;
  const rayEndX = camX + Math.cos(tiltRad) * rayLen;
  const rayEndY = camY + Math.sin(tiltRad) * rayLen;

  const mainFurn = furniture.find(f => f.type === 'table' || f.type === 'bar_stool') || furniture.find(f => f.type !== 'plant');
  const plantItem = furniture.find(f => f.type === 'plant');
  const furnHeightM = mainFurn ? mainFurn.heightCm / 100 : 0;
  const plantHeightM = plantItem ? clamp(plantItem.heightCm / 100, 0.4, 2.6) : 0;

  return (
    <div className="bg-[#0E0E0E] border border-[#262626] rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
          Вертикальный профиль (Ось Z)
        </span>
        <span className="text-[11px] font-mono" style={{ color: accentColor }}>
          H: {camera.height.toFixed(2)}m · {camera.tilt > 0 ? `+${camera.tilt}°` : `${camera.tilt}°`}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28 rounded-lg bg-[#090909] border border-[#1E1E1E]">
        {[1, 2].map(m => (
          <g key={m}>
            <line
              x1="0"
              y1={floorY - m * scaleY}
              x2={W}
              y2={floorY - m * scaleY}
              stroke="#1A1A1A"
              strokeDasharray="3 3"
            />
            <text x="6" y={floorY - m * scaleY - 3} fill="#525252" fontSize="8" fontFamily="monospace">
              {m}.0m
            </text>
          </g>
        ))}

        <line x1="0" y1={floorY} x2={W} y2={floorY} stroke="#333333" strokeWidth="1.5" />

        <line x1="30" y1={spkEyeY} x2={W - 10} y2={spkEyeY} stroke="#38BDF8" strokeOpacity="0.25" strokeDasharray="4 4" />
        <text x={W - 8} y={spkEyeY - 4} fill="#38BDF8" fontSize="8" textAnchor="end" fontFamily="monospace">
          Глаза {spkEyeHeight.toFixed(2)}m ({isSitting ? 'сидя' : 'стоя'})
        </text>

        {/* Plant silhouette if present */}
        {plantHeightM > 0 && (
          <g>
            <rect
              x={spkX + 26}
              y={floorY - Math.min(12, plantHeightM * scaleY * 0.25)}
              width="12"
              height={Math.min(12, plantHeightM * scaleY * 0.25)}
              fill="#3F3F46"
              rx="1.5"
            />
            <line
              x1={spkX + 32}
              y1={floorY - Math.min(12, plantHeightM * scaleY * 0.25)}
              x2={spkX + 32}
              y2={floorY - plantHeightM * scaleY + 6}
              stroke="#10B981"
              strokeWidth="2"
            />
            <circle
              cx={spkX + 32}
              cy={floorY - plantHeightM * scaleY + 8}
              r="7"
              fill="#10B981"
              fillOpacity="0.35"
              stroke="#34D399"
              strokeWidth="1"
            />
            <text x={spkX + 32} y={floorY - plantHeightM * scaleY - 2} fill="#34D399" fontSize="7" textAnchor="middle" fontFamily="monospace">
              {plantItem.heightCm}см
            </text>
          </g>
        )}

        {/* Furniture reference block */}
        {furnHeightM > 0 && (
          <g>
            <rect
              x={spkX - 42}
              y={floorY - furnHeightM * scaleY}
              width="28"
              height={furnHeightM * scaleY}
              fill="#27272A"
              stroke="#52525B"
              rx="2"
            />
            <text x={spkX - 28} y={floorY - furnHeightM * scaleY - 3} fill="#71717A" fontSize="7" textAnchor="middle" fontFamily="monospace">
              {mainFurn.heightCm}см
            </text>
          </g>
        )}

        {/* Speaker silhouette */}
        <g transform={`translate(${spkX}, ${floorY})`}>
          {isSitting ? (
            <>
              <path d="M -8 0 L -8 -16 L 10 -16 L 10 0 M 10 -16 L 12 -32" stroke="#52525B" strokeWidth="2" fill="none" />
              <circle cx="0" cy={-spkEyeHeight * scaleY} r="6.5" fill="#38BDF8" fillOpacity="0.85" />
              <path d={`M 0 ${-spkEyeHeight * scaleY + 7} L 2 -16 L -12 -16 L -12 0`} stroke="#38BDF8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </>
          ) : (
            <>
              <circle cx="0" cy={-spkEyeHeight * scaleY} r="6.5" fill="#F59E0B" fillOpacity="0.85" />
              <line x1="0" y1={-spkEyeHeight * scaleY + 7} x2="0" y2="-22" stroke="#F59E0B" strokeWidth="4.5" strokeLinecap="round" />
              <line x1="0" y1="-22" x2="-6" y2="0" stroke="#F59E0B" strokeWidth="3.5" strokeLinecap="round" />
              <line x1="0" y1="-22" x2="6" y2="0" stroke="#F59E0B" strokeWidth="3.5" strokeLinecap="round" />
            </>
          )}
        </g>

        {/* Camera optical axis & cone */}
        <line x1={camX} y1={camY} x2={rayEndX} y2={rayEndY} stroke={accentColor} strokeWidth="1.5" strokeDasharray="4 3" />
        <polygon
          points={`${camX},${camY} ${camX + Math.cos(tiltRad - 0.16) * rayLen},${camY + Math.sin(tiltRad - 0.16) * rayLen} ${camX + Math.cos(tiltRad + 0.16) * rayLen},${camY + Math.sin(tiltRad + 0.16) * rayLen}`}
          fill={accentColor}
          fillOpacity="0.09"
        />

        {/* Tripod legs */}
        <line x1={camX} y1={camY} x2={camX - 11} y2={floorY} stroke="#525252" strokeWidth="1.5" />
        <line x1={camX} y1={camY} x2={camX + 11} y2={floorY} stroke="#525252" strokeWidth="1.5" />
        <line x1={camX} y1={camY} x2={camX} y2={floorY} stroke="#404040" strokeWidth="1.5" />

        {/* Camera body */}
        <g transform={`translate(${camX}, ${camY}) rotate(${-camera.tilt})`}>
          <rect x="-10" y="-6" width="16" height="12" rx="2.5" fill={accentColor} />
          <polygon points="6,-4 12,-7 12,7 6,4" fill={accentColor} />
        </g>
      </svg>

      {/* Sliders */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div>
          <div className="flex justify-between text-[11px] text-neutral-400 mb-1">
            <span>Высота</span>
            <span className="font-mono text-white">{Math.round(camera.height * 100)} см</span>
          </div>
          <input
            type="range"
            min="0.4"
            max="2.6"
            step="0.05"
            value={camera.height}
            onChange={(e) => onChange({ height: parseFloat(e.target.value) })}
            style={{ accentColor }}
            className="w-full cursor-pointer h-1.5 bg-[#262626] rounded-lg"
          />
        </div>
        <div>
          <div className="flex justify-between text-[11px] text-neutral-400 mb-1">
            <span>Наклон (Tilt)</span>
            <span className="font-mono text-white">{camera.tilt > 0 ? `+${camera.tilt}°` : `${camera.tilt}°`}</span>
          </div>
          <input
            type="range"
            min="-30"
            max="30"
            step="1"
            value={camera.tilt}
            onChange={(e) => onChange({ tilt: parseInt(e.target.value, 10) })}
            style={{ accentColor }}
            className="w-full cursor-pointer h-1.5 bg-[#262626] rounded-lg"
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// INTERACTIVE TOP-VIEW STUDIO CANVAS (12m x 9m)
// ============================================================================

function StudioTopViewCanvas({
  project,
  activeCameraId,
  accentColor,
  onSelectCamera,
  onUpdateCamera,
  onUpdateSpeaker,
  onUpdateFurniture
}) {
  const svgRef = useRef(null);
  const [dragging, setDragging] = useState(null);
  const [collisionFlash, setCollisionFlash] = useState(false);

  const PAD_LEFT = 32;
  const PAD_TOP = 26;
  const PAD_RIGHT = 16;
  const PAD_BOTTOM = 16;
  const VB_W = 800;
  const VB_H = 600;
  const INNER_W = VB_W - PAD_LEFT - PAD_RIGHT;
  const INNER_H = VB_H - PAD_TOP - PAD_BOTTOM;

  const toPxX = (m) => PAD_LEFT + (m / STUDIO_W) * INNER_W;
  const toPxY = (m) => PAD_TOP + (m / STUDIO_H) * INNER_H;

  const clientToMeters = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const vbX = ((clientX - rect.left) / rect.width) * VB_W;
    const vbY = ((clientY - rect.top) / rect.height) * VB_H;
    const mx = ((vbX - PAD_LEFT) / INNER_W) * STUDIO_W;
    const my = ((vbY - PAD_TOP) / INNER_H) * STUDIO_H;
    return { x: mx, y: my };
  }, [INNER_W, INNER_H]);

  const handlePointerMove = useCallback((e) => {
    if (!dragging) return;
    const pt = e.touches ? e.touches[0] : e;
    const { x, y } = clientToMeters(pt.clientX, pt.clientY);

    if (dragging.type === 'cam') {
      const rawInChroma = pointInPolygon({ x, y }, CHROMA_POLY);
      setCollisionFlash(rawInChroma);
      const safe = enforceCameraCollisionGuard(x, y);
      onUpdateCamera(dragging.id, { x: safe.x, y: safe.y });
    } else if (dragging.type === 'camAim') {
      const cam = project.cameras.find(c => c.id === dragging.id);
      if (cam) {
        const angleDeg = Math.round((Math.atan2(y - cam.y, x - cam.x) * 180) / Math.PI);
        onUpdateCamera(dragging.id, { angle: angleDeg });
      }
    } else if (dragging.type === 'speaker') {
      onUpdateSpeaker(dragging.id, {
        x: Number(clamp(x, 0.4, STUDIO_W - 0.4).toFixed(2)),
        y: Number(clamp(y, 0.4, STUDIO_H - 0.4).toFixed(2))
      });
    } else if (dragging.type === 'furniture') {
      onUpdateFurniture(dragging.id, {
        x: Number(clamp(x, 0.4, STUDIO_W - 0.4).toFixed(2)),
        y: Number(clamp(y, 0.4, STUDIO_H - 0.4).toFixed(2))
      });
    }
  }, [dragging, clientToMeters, project.cameras, onUpdateCamera, onUpdateSpeaker, onUpdateFurniture]);

  const handlePointerUp = useCallback(() => {
    setDragging(null);
    setCollisionFlash(false);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [dragging, handlePointerMove, handlePointerUp]);

  const chromaPointsStr = CHROMA_POLY.map(p => `${toPxX(p.x)},${toPxY(p.y)}`).join(' ');

  return (
    <div className="relative w-full bg-[#0E0E0E] border border-[#262626] rounded-2xl overflow-hidden select-none">
      {/* Top Overlay Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1E1E1E] bg-[#121212]">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4" style={{ color: accentColor }} />
          <span className="text-xs font-semibold tracking-wide text-white uppercase">
            План студии 12 м × 9 м (Top-View)
          </span>
          <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono bg-[#1C1C1C] text-neutral-400 border border-[#262626]">
            Сетка: 1м / 10см
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-neutral-400">
          {collisionFlash ? (
            <span className="text-emerald-400 font-medium flex items-center gap-1 animate-pulse">
              <AlertCircle className="w-3.5 h-3.5" /> Collision Guard: граница хромакея
            </span>
          ) : (
            <span className="hidden md:inline text-neutral-500">
              Перетаскивайте камеры, маркер направления, спикеров и мебель
            </span>
          )}
        </div>
      </div>

      {/* SVG Studio Floor */}
      <div className="w-full aspect-[4/3] bg-[#0B0B0B]">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className="w-full h-full touch-none"
        >
          <defs>
            <pattern
              id="subgrid10cm"
              width={INNER_W / (STUDIO_W * 10)}
              height={INNER_H / (STUDIO_H * 10)}
              patternUnits="userSpaceOnUse"
              x={PAD_LEFT}
              y={PAD_TOP}
            >
              <path
                d={`M ${INNER_W / (STUDIO_W * 10)} 0 L 0 0 0 ${INNER_H / (STUDIO_H * 10)}`}
                fill="none"
                stroke="#161616"
                strokeWidth="0.6"
              />
            </pattern>
            <pattern
              id="grid1m"
              width={INNER_W / STUDIO_W}
              height={INNER_H / STUDIO_H}
              patternUnits="userSpaceOnUse"
              x={PAD_LEFT}
              y={PAD_TOP}
            >
              <rect width={INNER_W / STUDIO_W} height={INNER_H / STUDIO_H} fill="url(#subgrid10cm)" />
              <path
                d={`M ${INNER_W / STUDIO_W} 0 L 0 0 0 ${INNER_H / STUDIO_H}`}
                fill="none"
                stroke="#262626"
                strokeWidth="1"
              />
            </pattern>
            <pattern id="chromaHatch" width="12" height="12" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="12" stroke="#22C55E" strokeOpacity="0.18" strokeWidth="2" />
            </pattern>
          </defs>

          {/* Floor & Grids */}
          <rect
            x={PAD_LEFT}
            y={PAD_TOP}
            width={INNER_W}
            height={INNER_H}
            fill="url(#grid1m)"
            stroke="#333333"
            strokeWidth="1.5"
          />

          {/* Top Meter Ruler (0m..12m) */}
          {Array.from({ length: 13 }).map((_, m) => (
            <text
              key={`rx_${m}`}
              x={toPxX(m)}
              y={PAD_TOP - 8}
              fill="#666666"
              fontSize="10"
              fontFamily="monospace"
              textAnchor="middle"
            >
              {m}m
            </text>
          ))}

          {/* Left Meter Ruler (0m..9m) */}
          {Array.from({ length: 10 }).map((_, m) => (
            <text
              key={`ry_${m}`}
              x={PAD_LEFT - 8}
              y={toPxY(m) + 3}
              fill="#666666"
              fontSize="10"
              fontFamily="monospace"
              textAnchor="end"
            >
              {m}m
            </text>
          ))}

          {/* Fixed Corner Chroma Key Zone */}
          <g>
            <polygon points={chromaPointsStr} fill="rgba(22, 163, 74, 0.16)" />
            <polygon
              points={chromaPointsStr}
              fill="url(#chromaHatch)"
              stroke={collisionFlash ? '#4ADE80' : '#22C55E'}
              strokeWidth={collisionFlash ? '3' : '2'}
            />
            <text x={toPxX(8.85)} y={toPxY(0) + 14} fill="#4ADE80" fontSize="10" fontFamily="monospace" textAnchor="middle" fontWeight="bold">
              6.3 м
            </text>
            <text x={toPxX(12) - 8} y={toPxY(2.55)} fill="#4ADE80" fontSize="10" fontFamily="monospace" textAnchor="end" fontWeight="bold">
              5.1 м
            </text>
            <text x={toPxX(10.5)} y={toPxY(5.1) - 7} fill="#4ADE80" fontSize="10" fontFamily="monospace" textAnchor="middle" fontWeight="bold">
              3.0 м
            </text>
            <text x={toPxX(5.7) + 6} y={toPxY(0.68)} fill="#4ADE80" fontSize="9.5" fontFamily="monospace" textAnchor="start" fontWeight="bold">
              1.25 м
            </text>
            <text x={toPxX(9.7)} y={toPxY(1.2)} fill="#22C55E" fillOpacity="0.65" fontSize="11" fontWeight="bold" letterSpacing="2" textAnchor="middle">
              CHROMA KEY ZONE
            </text>
          </g>

          {/* Furniture & Decor Items */}
          {project.furniture.map((f) => {
            const fx = toPxX(f.x);
            const fy = toPxY(f.y);
            const rw = (f.w / STUDIO_W) * INNER_W;
            const rd = (f.d / STUDIO_H) * INNER_H;

            if (f.type === 'plant') {
              const r = Math.max(15, rw / 2);
              return (
                <g
                  key={f.id}
                  transform={`translate(${fx}, ${fy})`}
                  onMouseDown={(e) => { e.stopPropagation(); setDragging({ type: 'furniture', id: f.id }); }}
                  onTouchStart={(e) => { e.stopPropagation(); setDragging({ type: 'furniture', id: f.id }); }}
                  className="cursor-grab active:cursor-grabbing"
                >
                  {/* Stylized potted plant leaves */}
                  <circle r={r} fill="rgba(16, 185, 129, 0.2)" stroke="#34D399" strokeWidth="1.5" strokeDasharray="3 2" />
                  {[0, 60, 120, 180, 240, 300].map(deg => (
                    <ellipse
                      key={deg}
                      cx="0"
                      cy={-r * 0.45}
                      rx={r * 0.28}
                      ry={r * 0.48}
                      fill="#10B981"
                      fillOpacity="0.45"
                      transform={`rotate(${deg})`}
                    />
                  ))}
                  <circle r={r * 0.36} fill="#18181B" stroke="#34D399" strokeWidth="1.2" />
                  <text y={r + 11} fill="#6EE7B7" fontSize="8.5" fontFamily="monospace" textAnchor="middle">
                    🌿 {f.heightCm}см
                  </text>
                </g>
              );
            }

            if (f.type === 'bar_stool') {
              const r = Math.max(13, rw / 2);
              return (
                <g
                  key={f.id}
                  transform={`translate(${fx}, ${fy})`}
                  onMouseDown={(e) => { e.stopPropagation(); setDragging({ type: 'furniture', id: f.id }); }}
                  onTouchStart={(e) => { e.stopPropagation(); setDragging({ type: 'furniture', id: f.id }); }}
                  className="cursor-grab active:cursor-grabbing"
                >
                  <circle r={r} fill="#27272A" fillOpacity="0.92" stroke="#A1A1AA" strokeWidth="1.5" />
                  <circle r={r * 0.65} fill="none" stroke="#52525B" strokeWidth="1" strokeDasharray="2 2" />
                  <text y="3" fill="#E4E4E7" fontSize="8" fontFamily="monospace" textAnchor="middle">
                    {f.heightCm}
                  </text>
                  <text y={r + 10} fill="#A1A1AA" fontSize="8" fontFamily="monospace" textAnchor="middle">
                    Стул
                  </text>
                </g>
              );
            }

            return (
              <g
                key={f.id}
                transform={`translate(${fx}, ${fy}) rotate(${f.rotation || 0})`}
                onMouseDown={(e) => { e.stopPropagation(); setDragging({ type: 'furniture', id: f.id }); }}
                onTouchStart={(e) => { e.stopPropagation(); setDragging({ type: 'furniture', id: f.id }); }}
                className="cursor-grab active:cursor-grabbing"
              >
                <rect
                  x={-rw / 2}
                  y={-rd / 2}
                  width={rw}
                  height={rd}
                  rx="5"
                  fill="#27272A"
                  fillOpacity="0.88"
                  stroke="#71717A"
                  strokeWidth="1.5"
                />
                <text
                  x="0"
                  y="3"
                  fill="#D4D4D8"
                  fontSize="9"
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  {f.heightCm}см
                </text>
              </g>
            );
          })}

          {/* Speakers (1-5) */}
          {project.speakers.map((s, idx) => {
            const sx = toPxX(s.x);
            const sy = toPxY(s.y);
            const isSitting = s.pose === 'sitting';
            const color = isSitting ? '#38BDF8' : '#F59E0B';
            return (
              <g
                key={s.id}
                transform={`translate(${sx}, ${sy})`}
                onMouseDown={(e) => { e.stopPropagation(); setDragging({ type: 'speaker', id: s.id }); }}
                onTouchStart={(e) => { e.stopPropagation(); setDragging({ type: 'speaker', id: s.id }); }}
                className="cursor-grab active:cursor-grabbing"
              >
                <circle r="15" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="2" />
                {isSitting ? (
                  <rect x="-6" y="-6" width="12" height="12" rx="3" fill={color} />
                ) : (
                  <circle r="7" fill={color} />
                )}
                <text y="3" fill="#0B0B0B" fontSize="9" fontWeight="bold" textAnchor="middle">
                  S{idx + 1}
                </text>
                <text y="26" fill={color} fontSize="9.5" fontFamily="monospace" textAnchor="middle">
                  {isSitting ? 'Сидит' : 'Стоит'}
                </text>
              </g>
            );
          })}

          {/* Cameras (1-5) + FOV Cones + Aim Handles */}
          {project.cameras.map((cam) => {
            const isActive = cam.id === activeCameraId;
            const cx = toPxX(cam.x);
            const cy = toPxY(cam.y);
            const fov = calcHorizontalFovDeg(cam.focalLength, cam.cropFactor);
            const rad = (cam.angle * Math.PI) / 180;
            const halfFov = ((fov / 2) * Math.PI) / 180;
            const coneLen = 280;
            const aimHandleDist = 66;

            const leftX = cx + Math.cos(rad - halfFov) * coneLen;
            const leftY = cy + Math.sin(rad - halfFov) * coneLen;
            const rightX = cx + Math.cos(rad + halfFov) * coneLen;
            const rightY = cy + Math.sin(rad + halfFov) * coneLen;

            const aimX = cx + Math.cos(rad) * aimHandleDist;
            const aimY = cy + Math.sin(rad) * aimHandleDist;

            return (
              <g key={cam.id}>
                <polygon
                  points={`${cx},${cy} ${leftX},${leftY} ${rightX},${rightY}`}
                  fill={isActive ? accentColor : '#FFFFFF'}
                  fillOpacity={isActive ? '0.13' : '0.04'}
                  stroke={isActive ? accentColor : '#525252'}
                  strokeOpacity={isActive ? '0.65' : '0.35'}
                  strokeWidth={isActive ? '1.5' : '1'}
                  strokeDasharray={isActive ? 'none' : '4 4'}
                  pointerEvents="none"
                />

                <line
                  x1={cx}
                  y1={cy}
                  x2={aimX}
                  y2={aimY}
                  stroke={isActive ? accentColor : '#737373'}
                  strokeWidth={isActive ? '2' : '1'}
                  strokeDasharray="3 3"
                  pointerEvents="none"
                />

                <g
                  transform={`translate(${aimX}, ${aimY})`}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onSelectCamera(cam.id);
                    setDragging({ type: 'camAim', id: cam.id });
                  }}
                  onTouchStart={(e) => {
                    e.stopPropagation();
                    onSelectCamera(cam.id);
                    setDragging({ type: 'camAim', id: cam.id });
                  }}
                  className="cursor-crosshair"
                >
                  <circle
                    r={isActive ? '8' : '6'}
                    fill={isActive ? '#0B0B0B' : '#171717'}
                    stroke={isActive ? accentColor : '#737373'}
                    strokeWidth="2"
                  />
                  <circle r="2.5" fill={isActive ? accentColor : '#A3A3A3'} />
                </g>

                <g
                  transform={`translate(${cx}, ${cy})`}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onSelectCamera(cam.id);
                    setDragging({ type: 'cam', id: cam.id });
                  }}
                  onTouchStart={(e) => {
                    e.stopPropagation();
                    onSelectCamera(cam.id);
                    setDragging({ type: 'cam', id: cam.id });
                  }}
                  className="cursor-grab active:cursor-grabbing"
                >
                  <circle
                    r={isActive ? '18' : '15'}
                    fill={isActive ? accentColor : '#1F1F1F'}
                    stroke={isActive ? '#0B0B0B' : '#737373'}
                    strokeWidth="2"
                  />
                  <text
                    y="4"
                    fill={isActive ? '#0B0B0B' : '#FFFFFF'}
                    fontSize="10"
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    {cam.name.replace('CAM ', 'C')}
                  </text>

                  <g transform="translate(0, 26)">
                    <rect
                      x="-44"
                      y="-9"
                      width="88"
                      height="17"
                      rx="8"
                      fill="#111111"
                      fillOpacity="0.92"
                      stroke={isActive ? accentColor : '#333333'}
                      strokeWidth="1"
                    />
                    <text
                      y="3"
                      fill={isActive ? accentColor : '#A3A3A3'}
                      fontSize="9"
                      fontFamily="monospace"
                      textAnchor="middle"
                    >
                      H:{cam.height.toFixed(1)}m · {cam.tilt > 0 ? `+${cam.tilt}°` : `${cam.tilt}°`}
                    </text>
                  </g>
                </g>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ============================================================================
// BEFORE / AFTER COMPARISON VIEWER (Higgsfield INPUT / FINAL / CLEAN Style)
// ============================================================================

function BeforeAfterViewer({
  camera,
  aspectRatio,
  accentColor,
  viewMode,
  setViewMode,
  isGeneratingStageA,
  isGeneratingStageB,
  onUploadInput,
  onSelectVersion
}) {
  const [sliderPos, setSliderPos] = useState(50);
  const containerRef = useRef(null);
  const [isSliding, setIsSliding] = useState(false);

  const updateSlider = useCallback((clientX) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
    setSliderPos(pct);
  }, []);

  useEffect(() => {
    if (!isSliding) return;
    const onMove = (e) => {
      const pt = e.touches ? e.touches[0] : e;
      updateSlider(pt.clientX);
    };
    const onUp = () => setIsSliding(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [isSliding, updateSlider]);

  const hasInput = !!camera.inputImage;
  const hasPreview = !!camera.previewImage;
  const hasClean = !!camera.cleanPlateImage;
  const isBusy = isGeneratingStageA || isGeneratingStageB;

  return (
    <div className="bg-[#0E0E0E] border border-[#262626] rounded-2xl overflow-hidden flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-[#1E1E1E] bg-[#121212]">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold text-black" style={{ backgroundColor: accentColor }}>
            {camera.name}
          </span>
          <span className="text-xs text-neutral-400 font-mono">
            {camera.focalLength}mm ({Math.round(camera.focalLength * camera.cropFactor)}mm eq.) · {camera.aperture} · {camera.wbKelvin}K
          </span>
        </div>

        <div className="flex items-center gap-1 bg-[#0B0B0B] p-1 rounded-full border border-[#262626]">
          {[
            { id: 'compare', label: 'Сравнение' },
            { id: 'input', label: 'Исходник' },
            { id: 'preview', label: 'Превью' },
            { id: 'clean', label: 'Фон' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setViewMode(tab.id)}
              style={viewMode === tab.id ? { backgroundColor: accentColor, color: '#0B0B0B' } : undefined}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition ${
                viewMode === tab.id ? 'font-semibold' : 'text-neutral-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={containerRef}
        className={`relative w-full bg-[#070707] flex items-center justify-center overflow-hidden ${
          aspectRatio === '9:16' ? 'aspect-[9/16] max-h-[520px] mx-auto' : 'aspect-video'
        }`}
      >
        {isBusy && (
          <div className="absolute inset-0 z-30 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 p-6 text-center">
            <div
              className="w-10 h-10 rounded-full border-2 border-[#262626] animate-spin"
              style={{ borderTopColor: accentColor }}
            />
            <div className="text-sm font-semibold text-white">
              {isGeneratingStageA ? 'Генерируем фон и собираем превью…' : 'Генерируем фон…'}
            </div>
            <div className="text-xs text-neutral-400 max-w-xs">
              Учитываем геометрию плана 12×9м, оптику {camera.focalLength}mm ({camera.aperture}) и баланс белого {camera.wbKelvin}K
            </div>
          </div>
        )}

        {!hasInput && !hasPreview && !hasClean && (
          <label className="flex flex-col items-center justify-center gap-3 p-8 text-center cursor-pointer group">
            <div className="w-14 h-14 rounded-2xl bg-[#141414] border border-[#262626] group-hover:border-[var(--accent)] flex items-center justify-center transition">
              <Upload className="w-6 h-6 text-neutral-400 group-hover:text-[var(--accent)] transition" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Загрузите стоп-кадр с {camera.name}</p>
              <p className="text-xs text-neutral-500 mt-1">Лёгкий JPG / PNG с хромакея (исходники .braw не требуются)</p>
            </div>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onUploadInput} />
          </label>
        )}

        {viewMode === 'compare' && (hasInput || hasPreview) && (
          <>
            {hasPreview ? (
              <img src={camera.previewImage} alt="Final Preview" className="w-full h-full object-contain" />
            ) : (
              <img src={camera.inputImage} alt="Input Frame" className="w-full h-full object-contain opacity-85" />
            )}

            {hasInput && hasPreview && (
              <>
                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
                >
                  <img src={camera.inputImage} alt="Input Green Screen" className="w-full h-full object-contain" />
                </div>

                <div
                  className="absolute top-0 bottom-0 z-20 w-0.5 cursor-ew-resize"
                  style={{ left: `${sliderPos}%`, backgroundColor: accentColor }}
                  onMouseDown={() => setIsSliding(true)}
                  onTouchStart={() => setIsSliding(true)}
                >
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full text-black shadow-lg flex items-center justify-center"
                    style={{ backgroundColor: accentColor }}
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                  </div>
                </div>

                <span className="absolute top-3 left-3 z-10 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider bg-black/75 text-emerald-400 border border-emerald-500/30">
                  ИСХОДНИК
                </span>
                <span
                  className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider bg-black/75 border"
                  style={{ color: accentColor, borderColor: accentAlpha(accentColor, 0.35) }}
                >
                  ПРЕВЬЮ
                </span>
              </>
            )}

            {hasInput && !hasPreview && (
              <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider bg-black/75 text-emerald-400 border border-emerald-500/30">
                ИСХОДНИК · ГОТОВ К ГЕНЕРАЦИИ
              </span>
            )}
          </>
        )}

        {viewMode === 'input' && (
          hasInput ? (
            <img src={camera.inputImage} alt="Input" className="w-full h-full object-contain" />
          ) : (
            <div className="text-xs text-neutral-500">Стоп-кадр не загружен</div>
          )
        )}

        {viewMode === 'preview' && (
          hasPreview ? (
            <img src={camera.previewImage} alt="Final Preview" className="w-full h-full object-contain" />
          ) : (
            <div className="text-xs text-neutral-500">Нажмите «Генерация фона» — здесь появится фон с настоящим спикером поверх</div>
          )
        )}

        {viewMode === 'clean' && (
          hasClean ? (
            <div className="relative w-full h-full flex items-center justify-center">
              <img src={camera.cleanPlateImage} alt="Фон" className="w-full h-full object-contain" />
              <span
                className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider text-black"
                style={{ backgroundColor: accentColor }}
              >
                ФОН ГОТОВ
              </span>
            </div>
          ) : (
            <div className="text-xs text-neutral-500 text-center px-6">
              Фона ещё нет. Нажмите «Генерация фона».
            </div>
          )
        )}
      </div>

      {/* Лента версий: превью камеры и фоны, сделанные из текущего превью */}
      {(() => {
        const hist = camera.history || [];
        const previews = hist.filter(h => h.stage === 'A');
        const backgrounds = hist.filter(h => h.stage === 'B' && h.fromPreviewId && h.fromPreviewId === camera.previewId);
        if (previews.length === 0) return null;
        // Каждая генерация даёт пару «фон + превью», поэтому достаточно одной строки версий.
        // Вторая строка нужна только для старых проектов, где из одного превью делали несколько фонов.
        const rows = [
          { key: 'A', title: 'Версии', items: previews, activeUrl: camera.previewImage, mode: 'compare' },
          ...(backgrounds.length > 1
            ? [{ key: 'B', title: 'Фоны из этого превью', items: backgrounds, activeUrl: camera.cleanPlateImage, mode: 'clean' }]
            : [])
        ];
        return (
          <div className="border-t border-[#1E1E1E] bg-[#0B0B0B] px-3 py-2 grid grid-cols-[minmax(0,13rem)_1fr] items-center gap-x-3 gap-y-1.5">
            {rows.map(row => (
              <React.Fragment key={row.key}>
                <span className="text-[10px] uppercase tracking-wider text-neutral-500 whitespace-nowrap truncate leading-none">
                  {row.title} ({row.items.length})
                </span>
                <div className="min-w-0 h-10 flex items-center">
                {row.items.length === 0 ? (
                  <span className="text-[11px] text-neutral-600 whitespace-nowrap truncate">пока нет</span>
                ) : (
                  <div className="flex gap-1.5 overflow-x-auto">
                    {[...row.items].reverse().map((entry, i) => {
                      const active = entry.imageUrl === row.activeUrl;
                      return (
                        <button
                          key={entry.id}
                          onClick={() => { onSelectVersion(entry); setViewMode(row.mode); }}
                          title={`Версия ${i + 1} · ${entry.timestamp}`}
                          className="relative shrink-0 w-16 aspect-video rounded-md overflow-hidden border-2 transition"
                          style={{ borderColor: active ? accentColor : '#262626' }}
                        >
                          <img src={entry.imageUrl} alt="" className="w-full h-full object-cover" />
                          <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[9px] font-mono text-white text-center leading-tight whitespace-nowrap">
                            v{i + 1} · {entry.timestamp}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                </div>
              </React.Fragment>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// ============================================================================
// MODULE 2: CAMERA TIMELINE (v1 UI Foundation — Dynamic Tracks 1..5)
// ============================================================================

function TimelineModule({ project, accentColor, onUpdateCamera, onGoToStudio }) {
  const [selectedCamId, setSelectedCamId] = useState(project.cameras[0]?.id || null);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const totalDuration = 30;

  const activeCam = project.cameras.find(c => c.id === selectedCamId) || project.cameras[0];

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setPlayheadSec(prev => (prev >= totalDuration ? 0 : Number((prev + 0.1).toFixed(1))));
    }, 100);
    return () => clearInterval(interval);
  }, [isPlaying]);

  const getSimulatedTransform = (cam) => {
    if (!cam?.timelineClip) return 'scale(1)';
    const { startSec, endSec, motion } = cam.timelineClip;
    if (playheadSec < startSec || playheadSec > endSec || motion === 'static') return 'scale(1)';
    const progress = clamp((playheadSec - startSec) / Math.max(0.5, endSec - startSec), 0, 1);
    if (motion === 'push_in') return `scale(${1 + progress * 0.14})`;
    if (motion === 'pull_out') return `scale(${1.14 - progress * 0.14})`;
    if (motion === 'pan_left') return `scale(1.1) translateX(${(0.5 - progress) * 6}%)`;
    if (motion === 'pan_right') return `scale(1.1) translateX(${(progress - 0.5) * 6}%)`;
    return 'scale(1)';
  };

  return (
    <div className="flex-1 flex flex-col gap-4 p-4 lg:p-6 max-w-[1600px] w-full mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8 bg-[#141414] border border-[#262626] rounded-2xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#262626]">
            <div className="flex items-center gap-2">
              <Film className="w-4 h-4" style={{ color: accentColor }} />
              <span className="text-xs font-semibold uppercase tracking-wider text-white">
                Монитор таймлайна · {activeCam?.name || 'CAM 1'}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[#1E1E1E] text-neutral-400 border border-[#2A2A2A]">
                v1 Разметка (Kling Video API в v2)
              </span>
            </div>
            <div className="text-xs font-mono" style={{ color: accentColor }}>
              00:{String(Math.floor(playheadSec)).padStart(2, '0')}:{String(Math.floor((playheadSec % 1) * 25)).padStart(2, '0')} / 00:{totalDuration}:00
            </div>
          </div>

          <div className="relative aspect-video bg-[#080808] overflow-hidden flex items-center justify-center">
            {activeCam && (activeCam.cleanPlateImage || activeCam.previewImage || activeCam.inputImage) ? (
              <img
                src={activeCam.cleanPlateImage || activeCam.previewImage || activeCam.inputImage}
                alt={activeCam.name}
                className="w-full h-full object-contain transition-transform duration-100 ease-linear"
                style={{ transform: getSimulatedTransform(activeCam) }}
              />
            ) : (
              <div className="text-center p-6">
                <p className="text-sm text-neutral-400">Для {activeCam?.name} ещё нет готового фона</p>
                <button
                  onClick={onGoToStudio}
                  style={{ backgroundColor: accentColor }}
                  className="mt-3 px-4 py-1.5 rounded-full text-black text-xs font-semibold hover:brightness-110 transition"
                >
                  Перейти в Модуль 1: Студия
                </button>
              </div>
            )}

            {activeCam && (
              <div className="absolute bottom-3 left-3 px-3 py-1 rounded-full bg-black/75 border border-[#262626] text-[11px] font-mono text-white">
                {activeCam.cleanPlateImage ? 'ФОН' : activeCam.previewImage ? 'ПРЕВЬЮ' : 'ИСХОДНИК'} · {
                  MOTION_PRESETS.find(m => m.id === activeCam.timelineClip?.motion)?.label || 'Статика'
                }
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-4 py-2.5 bg-[#101010] border-t border-[#262626]">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                style={{ backgroundColor: accentColor }}
                className="w-9 h-9 rounded-full text-black flex items-center justify-center hover:brightness-110 transition"
                title={isPlaying ? 'Пауза' : 'Воспроизвести предпросмотр движения'}
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
              </button>
              <button
                onClick={() => { setIsPlaying(false); setPlayheadSec(0); }}
                className="px-3 py-1.5 rounded-full bg-[#1C1C1C] border border-[#262626] text-xs text-neutral-300 hover:text-white transition"
              >
                В начало
              </button>
            </div>
            <div className="text-xs text-neutral-500">
              Дорожек синхронизировано с Модулем 1: <span className="text-white font-mono">{project.cameras.length}</span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 bg-[#141414] border border-[#262626] rounded-2xl p-4 flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
              Параметры отрезка · {activeCam?.name}
            </h3>

            {activeCam && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-neutral-400 mb-1.5">Тип движения / зума камеры</label>
                  <div className="grid grid-cols-1 gap-1.5">
                    {MOTION_PRESETS.map(preset => {
                      const active = activeCam.timelineClip?.motion === preset.id;
                      return (
                        <button
                          key={preset.id}
                          onClick={() => onUpdateCamera(activeCam.id, {
                            timelineClip: { ...activeCam.timelineClip, motion: preset.id }
                          })}
                          style={active ? {
                            backgroundColor: accentAlpha(accentColor, 0.12),
                            borderColor: accentColor,
                            color: accentColor
                          } : undefined}
                          className={`px-3 py-2 rounded-xl text-left text-xs font-medium border transition ${
                            active ? '' : 'bg-[#0E0E0E] border-[#262626] text-neutral-300 hover:border-neutral-600'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-neutral-400 mb-1">Start (сек)</label>
                    <input
                      type="number"
                      min="0"
                      max={Math.max(0, (activeCam.timelineClip?.endSec || 12) - 1)}
                      value={activeCam.timelineClip?.startSec ?? 0}
                      onChange={(e) => onUpdateCamera(activeCam.id, {
                        timelineClip: { ...activeCam.timelineClip, startSec: clamp(Number(e.target.value), 0, totalDuration - 1) }
                      })}
                      className="w-full bg-[#0B0B0B] border border-[#262626] rounded-lg px-3 py-1.5 text-sm font-mono text-white focus:border-[var(--accent)] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-neutral-400 mb-1">End (сек)</label>
                    <input
                      type="number"
                      min={(activeCam.timelineClip?.startSec ?? 0) + 1}
                      max={totalDuration}
                      value={activeCam.timelineClip?.endSec ?? 12}
                      onChange={(e) => onUpdateCamera(activeCam.id, {
                        timelineClip: { ...activeCam.timelineClip, endSec: clamp(Number(e.target.value), 1, totalDuration) }
                      })}
                      className="w-full bg-[#0B0B0B] border border-[#262626] rounded-lg px-3 py-1.5 text-sm font-mono text-white focus:border-[var(--accent)] outline-none"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 p-3 rounded-xl bg-[#0E0E0E] border border-[#262626] text-[11px] text-neutral-400 leading-relaxed">
            В версии v1 таймлайн сохраняет разметку отрезков <span className="text-white">Start / End</span> и готовые фоны для каждой камеры проекта. Подключение видео-генерации (Kling API) запланировано в v2.
          </div>
        </div>
      </div>

      {/* Multi-Track Timeline Board */}
      <div className="bg-[#141414] border border-[#262626] rounded-2xl overflow-hidden">
        <div className="flex border-b border-[#262626] bg-[#101010]">
          <div className="w-40 shrink-0 px-4 py-2 text-[11px] font-semibold uppercase text-neutral-500 border-r border-[#262626]">
            Камеры ({project.cameras.length})
          </div>
          <div
            className="flex-1 relative h-8 cursor-pointer select-none"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const sec = clamp(((e.clientX - rect.left) / rect.width) * totalDuration, 0, totalDuration);
              setPlayheadSec(Number(sec.toFixed(1)));
            }}
          >
            {[0, 5, 10, 15, 20, 25, 30].map(sec => (
              <div
                key={sec}
                className="absolute top-0 bottom-0 border-l border-[#262626] pl-1.5 pt-1 text-[10px] font-mono text-neutral-500"
                style={{ left: `${(sec / totalDuration) * 100}%` }}
              >
                00:{String(sec).padStart(2, '0')}
              </div>
            ))}
            <div
              className="absolute top-0 bottom-0 w-0.5 z-20 pointer-events-none"
              style={{ left: `${(playheadSec / totalDuration) * 100}%`, backgroundColor: accentColor }}
            >
              <div className="w-2.5 h-2.5 rotate-45 -translate-x-[4px] -translate-y-0.5" style={{ backgroundColor: accentColor }} />
            </div>
          </div>
        </div>

        <div className="divide-y divide-[#222222]">
          {project.cameras.map((cam) => {
            const isSelected = cam.id === activeCam?.id;
            const clip = cam.timelineClip || { startSec: 0, endSec: 12, motion: 'static' };
            const leftPct = (clip.startSec / totalDuration) * 100;
            const widthPct = Math.max(4, ((clip.endSec - clip.startSec) / totalDuration) * 100);
            const thumb = cam.cleanPlateImage || cam.previewImage || cam.inputImage;

            return (
              <div
                key={cam.id}
                onClick={() => setSelectedCamId(cam.id)}
                className={`flex items-stretch cursor-pointer transition ${
                  isSelected ? 'bg-[#1A1A1A]' : 'bg-[#121212] hover:bg-[#161616]'
                }`}
              >
                <div className="w-40 shrink-0 px-4 py-3 border-r border-[#262626] flex flex-col justify-center">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: cam.cleanPlateImage ? accentColor : '#525252' }}
                    />
                    <span className="text-xs font-bold" style={{ color: isSelected ? accentColor : '#FFFFFF' }}>
                      {cam.name}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-neutral-500 mt-0.5 truncate">
                    {cam.focalLength}mm · {cam.wbKelvin}K
                  </span>
                </div>

                <div className="flex-1 relative py-2.5 px-1 min-h-[64px]">
                  <div
                    className="absolute top-0 bottom-0 w-0.5 z-20 pointer-events-none"
                    style={{ left: `${(playheadSec / totalDuration) * 100}%`, backgroundColor: accentAlpha(accentColor, 0.7) }}
                  />

                  <div
                    className="absolute top-2 bottom-2 rounded-xl border overflow-hidden flex items-center gap-2 px-2.5 transition"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      backgroundColor: isSelected ? accentAlpha(accentColor, 0.14) : '#1F1F1F',
                      borderColor: isSelected ? accentColor : '#333333'
                    }}
                  >
                    {thumb && (
                      <img src={thumb} alt="" className="h-8 w-14 object-cover rounded border border-white/10 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-white truncate">
                        {cam.cleanPlateImage ? `${cam.name}_clean.png` : `${cam.name} (нет фона)`}
                      </div>
                      <div className="text-[10px] font-mono text-neutral-400 truncate">
                        {clip.startSec}s → {clip.endSec}s · {clip.motion}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN APPLICATION
// ============================================================================

function Studio({ initialProjects }) {
  // ---- Accent Color (persisted locally to this computer) ----
  const [accentColor, setAccentColor] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ACCENT);
      return saved ? enforceSafeAccentColor(saved) : DEFAULT_ACCENT;
    } catch {
      return DEFAULT_ACCENT;
    }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_ACCENT, accentColor); } catch {}
  }, [accentColor]);

  // ---- Projects State (хранятся в IndexedDB, загружаются в <App> до рендера) ----
  const [projects, setProjects] = useState(() => {
    try {
      {
        const parsed = initialProjects;
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Миграция: фон, у которого неизвестно, из какого превью он сделан,
          // считаем устаревшим и убираем с экрана.
          return parsed.map(p => ({
            ...p,
            cameras: (p.cameras || []).map(c =>
              c.cleanPlateImage && c.cleanPlateFromId === undefined
                ? { ...c, cleanPlateImage: null, cleanPlateFromId: null }
                : c
            )
          }));
        }
      }
    } catch {
      // Fallback to default
    }
    return [createDefaultProject('Интервью — Студия А')];
  });

  const [activeProjectId, setActiveProjectId] = useState(() => projects[0].id);
  const activeProject = useMemo(
    () => projects.find(p => p.id === activeProjectId) || projects[0],
    [projects, activeProjectId]
  );

  const [activeCameraId, setActiveCameraId] = useState(() => activeProject.cameras[0]?.id);
  const activeCamera = useMemo(
    () => activeProject.cameras.find(c => c.id === activeCameraId) || activeProject.cameras[0],
    [activeProject, activeCameraId]
  );

  // ---- UI Navigation & Panels ----
  const [activeModule, setActiveModule] = useState('studio');
  const [leftTab, setLeftTab] = useState('cameras');
  const [workspaceLayout, setWorkspaceLayout] = useState('split');
  const [viewerMode, setViewerMode] = useState('compare');
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  // ---- Modals & Drawers ----
  const [showBrawModal, setShowBrawModal] = useState(false);
  const [brawInputText, setBrawInputText] = useState('');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showAssetsModal, setShowAssetsModal] = useState(false);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [newProjectModal, setNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  // ---- API Key & Generation States ----
  const [apiKey, setApiKey] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY_API) || ''; } catch { return ''; }
  });
  const [generatingCamA, setGeneratingCamA] = useState(null);
  const [generatingCamB, setGeneratingCamB] = useState(null);
  const [batchProgress, setBatchProgress] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((text, type = 'info') => {
    setToast({ text, type });
    setTimeout(() => setToast(prev => (prev?.text === text ? null : prev)), 4200);
  }, []);

  // Автосохранение в IndexedDB с небольшой задержкой (чтобы не писать на каждое движение мыши)
  const saveErrorShownRef = useRef(false);
  const latestProjectsRef = useRef(projects);
  latestProjectsRef.current = projects;
  useEffect(() => {
    const t = setTimeout(() => {
      saveProjects(projects)
        .then(() => { saveErrorShownRef.current = false; })
        .catch(err => {
          console.error('Save failed', err);
          if (!saveErrorShownRef.current) {
            saveErrorShownRef.current = true;
            showToast('Не удалось сохранить проект в браузере. Скачайте фоны и сделайте «Экспорт .json».', 'error');
          }
        });
    }, 300);
    return () => clearTimeout(t);
  }, [projects, showToast]);

  // При закрытии вкладки — сохранить немедленно последнее состояние
  useEffect(() => {
    const flush = () => { saveProjects(latestProjectsRef.current).catch(() => {}); };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  // Сколько места занимают проекты (показываем в «Установках»)
  const [storageInfo, setStorageInfo] = useState(null);
  useEffect(() => {
    if (!showSettingsModal) return;
    getStorageEstimate().then(setStorageInfo);
  }, [showSettingsModal]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_API, apiKey); } catch {}
  }, [apiKey]);

  useEffect(() => {
    if (!activeProject.cameras.some(c => c.id === activeCameraId)) {
      setActiveCameraId(activeProject.cameras[0]?.id);
    }
  }, [activeProject, activeCameraId]);

  // ---- Project Mutators ----
  const updateProject = useCallback((updater) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== activeProject.id) return p;
      const next = typeof updater === 'function' ? updater(p) : { ...p, ...updater };
      return { ...next, updatedAt: new Date().toISOString() };
    }));
  }, [activeProject.id]);

  const updateCamera = useCallback((camId, patch) => {
    updateProject(p => ({
      ...p,
      cameras: p.cameras.map(c => (c.id === camId ? { ...c, ...patch } : c))
    }));
  }, [updateProject]);

  const updateSpeaker = useCallback((spkId, patch) => {
    updateProject(p => ({
      ...p,
      speakers: p.speakers.map(s => (s.id === spkId ? { ...s, ...patch } : s))
    }));
  }, [updateProject]);

  const updateFurniture = useCallback((furnId, patch) => {
    updateProject(p => ({
      ...p,
      furniture: p.furniture.map(f => (f.id === furnId ? { ...f, ...patch } : f))
    }));
  }, [updateProject]);

  // ---- Project Actions ----
  const handleCreateProject = () => {
    const title = newProjectName.trim() || `Проект ${projects.length + 1}`;
    const np = createDefaultProject(title);
    setProjects(prev => [np, ...prev]);
    setActiveProjectId(np.id);
    setActiveCameraId(np.cameras[0].id);
    setNewProjectName('');
    setNewProjectModal(false);
    setShowProjectMenu(false);
    showToast(`Создан проект «${title}»`, 'success');
  };

  const handleDuplicateProject = () => {
    const clone = JSON.parse(JSON.stringify(activeProject));
    clone.id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    clone.name = `${activeProject.name} (Копия)`;
    clone.updatedAt = new Date().toISOString();
    setProjects(prev => [clone, ...prev]);
    setActiveProjectId(clone.id);
    setActiveCameraId(clone.cameras[0]?.id);
    setShowProjectMenu(false);
    showToast(`Проект продублирован: «${clone.name}»`, 'success');
  };

  const handleDeleteProject = () => {
    if (projects.length <= 1) {
      showToast('Нельзя удалить единственный проект', 'error');
      setConfirmDeleteProject(false);
      return;
    }
    const remaining = projects.filter(p => p.id !== activeProject.id);
    setProjects(remaining);
    setActiveProjectId(remaining[0].id);
    setConfirmDeleteProject(false);
    setShowProjectMenu(false);
    showToast('Проект удалён', 'info');
  };

  const handleExportProjectJson = () => {
    const blob = new Blob([JSON.stringify(activeProject, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeProject.name.replace(/\s+/g, '_')}_monte_video.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowProjectMenu(false);
    showToast('Проект экспортирован в .json', 'success');
  };

  const handleImportProjectJson = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!imported.cameras || !Array.isArray(imported.cameras)) {
          throw new Error('Неверный формат файла проекта');
        }
        imported.id = `proj_${Date.now()}`;
        setProjects(prev => [imported, ...prev]);
        setActiveProjectId(imported.id);
        setActiveCameraId(imported.cameras[0]?.id);
        setShowProjectMenu(false);
        showToast(`Импортирован проект «${imported.name}»`, 'success');
      } catch (err) {
        showToast(err.message || 'Ошибка чтения JSON', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ---- Cameras, Speakers & Furniture CRUD ----
  const handleAddCamera = () => {
    if (activeProject.cameras.length >= 5) {
      showToast('Максимум 5 камер в одном проекте', 'info');
      return;
    }
    const newCam = createDefaultCamera(activeProject.cameras.length);
    updateProject(p => ({ ...p, cameras: [...p.cameras, newCam] }));
    setActiveCameraId(newCam.id);
  };

  const handleRemoveCamera = (camId) => {
    if (activeProject.cameras.length <= 1) {
      showToast('В проекте должна остаться хотя бы 1 камера', 'info');
      return;
    }
    const filtered = activeProject.cameras.filter(c => c.id !== camId);
    const renamed = filtered.map((c, i) => ({ ...c, name: `CAM ${i + 1}`, cameraNumber: String(i + 1) }));
    updateProject(p => ({ ...p, cameras: renamed }));
    if (activeCameraId === camId) setActiveCameraId(renamed[0].id);
  };

  const handleAddSpeaker = () => {
    if (activeProject.speakers.length >= 5) {
      showToast('Максимум 5 спикеров в кадре', 'info');
      return;
    }
    const idx = activeProject.speakers.length + 1;
    const newSpk = {
      id: `spk_${Date.now()}`,
      name: `Спикер ${idx}`,
      x: Number(clamp(7.8 + idx * 0.55, 6.4, 11.3).toFixed(2)),
      y: Number(clamp(1.2 + idx * 0.45, 0.8, 4.4).toFixed(2)),
      pose: 'sitting'
    };
    updateProject(p => ({ ...p, speakers: [...p.speakers, newSpk] }));
  };

  const handleRemoveSpeaker = (spkId) => {
    updateProject(p => ({ ...p, speakers: p.speakers.filter(s => s.id !== spkId) }));
  };

  const handleSelectFurniturePreset = (presetKey) => {
    const preset = FURNITURE_PRESETS[presetKey];
    if (!preset) return;
    updateProject(p => ({
      ...p,
      furniturePreset: presetKey,
      furniture: JSON.parse(JSON.stringify(preset.items))
    }));
  };

  const handleAddFurnitureItem = (typeKey) => {
    const spec = FURNITURE_CATALOG[typeKey];
    if (!spec) return;
    const sameTypeCount = activeProject.furniture.filter(f => f.type === typeKey).length;
    const offset = (activeProject.furniture.length % 5) * 0.45;
    const newItem = {
      id: `furn_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      type: spec.type,
      name: sameTypeCount > 0 ? `${spec.label} ${sameTypeCount + 1}` : spec.label,
      x: Number(clamp(8.5 + offset, 6.6, 11.4).toFixed(2)),
      y: Number(clamp(1.6 + offset * 0.7, 0.8, 4.5).toFixed(2)),
      w: spec.w,
      d: spec.d,
      heightCm: spec.heightCm,
      rotation: spec.rotatable ? -30 : 0,
      rotatable: spec.rotatable
    };
    updateProject(p => ({
      ...p,
      furniturePreset: 'custom',
      furniture: [...p.furniture, newItem]
    }));
  };

  const handleRemoveFurnitureItem = (furnId) => {
    updateProject(p => {
      const nextItems = p.furniture.filter(f => f.id !== furnId);
      return {
        ...p,
        furniturePreset: nextItems.length === 0 ? 'none' : 'custom',
        furniture: nextItems
      };
    });
  };

  // ---- File Upload Handlers ----
  const handleUploadCameraInput = (e) => {
    const file = e.target.files?.[0];
    if (!file || !activeCamera) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateCamera(activeCamera.id, { inputImage: reader.result });
      setViewerMode('compare');
      showToast(`Стоп-кадр загружен для ${activeCamera.name}`, 'success');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleUploadLocationRefs = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        updateProject(p => ({
          ...p,
          locationRefs: [...p.locationRefs, { id: `ref_${Date.now()}_${Math.random()}`, name: file.name, dataUrl: reader.result }]
        }));
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
    showToast(`Добавлено референсов локации: ${files.length}`, 'success');
  };

  // ---- Apply Parsed BRAW Metadata ----
  const handleApplyBrawMetadata = () => {
    if (!brawInputText.trim() || !activeCamera) return;
    const parsed = parseBrawMetadata(brawInputText);
    const count = Object.keys(parsed).length;
    if (count === 0) {
      showToast('Не удалось распознать поля BRAW. Проверьте формат текста.', 'error');
      return;
    }
    updateCamera(activeCamera.id, parsed);
    setShowBrawModal(false);
    setBrawInputText('');
    showToast(`Распознано ${count} параметров Blackmagic RAW для ${activeCamera.name}`, 'success');
  };

  const autoPromptStageA = useMemo(() => {
    if (!activeCamera) return '';
    return activeProject.customPromptOverride || buildAutoPrompt(activeProject, activeCamera, 'BG');
  }, [activeProject, activeCamera]);

  // ---- ГЕНЕРАЦИЯ: модель рисует пустой фон, приложение кладёт поверх настоящего спикера ----
  const runBackgroundForCamera = async (cam, translatedNotes) => {
    const finalPrompt = activeProject.customPromptOverride.trim()
      ? activeProject.customPromptOverride
      : buildAutoPrompt(activeProject, cam, 'BG', translatedNotes);

    const images = [];
    const inputPart = splitDataUrl(cam.inputImage);
    if (inputPart) images.push(inputPart);
    activeProject.locationRefs.slice(0, 3).forEach(ref => {
      const refPart = splitDataUrl(ref.dataUrl);
      if (refPart) images.push(refPart);
    });
    images.push({ mimeType: 'image/png', data: renderTopViewSnapshotBase64(activeProject, cam.id) });

    const bgUrl = await generateImageWithGemini({
      prompt: finalPrompt,
      images,
      aspectRatio: activeProject.aspectRatio,
      apiKey
    });

    const previewUrl = await composeOverBackground(cam.inputImage, bgUrl);

    const now = Date.now();
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const previewEntry = { id: `hist_${now}_p`, stage: 'A', imageUrl: previewUrl, timestamp: time, prompt: finalPrompt, mode: 'bg+key' };
    const bgEntry = { id: `hist_${now}_b`, stage: 'B', imageUrl: bgUrl, fromPreviewId: previewEntry.id, timestamp: time, prompt: finalPrompt, mode: 'bg+key' };

    updateProject(p => ({
      ...p,
      cameras: p.cameras.map(c => c.id !== cam.id ? c : {
        ...c,
        previewImage: previewUrl,
        previewId: previewEntry.id,
        cleanPlateImage: bgUrl,
        cleanPlateFromId: previewEntry.id,
        history: [previewEntry, bgEntry, ...(c.history || [])].slice(0, HISTORY_LIMIT)
      })
    }));
  };

  const checkCanGenerate = () => {
    if (activeProject.locationRefs.length === 0 && !activeProject.russianComment.trim()) {
      showToast('Загрузите хотя бы 1 референс локации или опишите её в комментарии', 'error');
      setLeftTab('location');
      return false;
    }
    return true;
  };

  const translateNotes = () => activeProject.russianComment.trim()
    ? translateRussianNotesToEnglish(activeProject.russianComment, apiKey)
    : Promise.resolve('');

  const handleGenerateBackground = async () => {
    if (!activeCamera) return;
    if (!activeCamera.inputImage) {
      showToast(`Сначала загрузите исходник (JPG/PNG) для ${activeCamera.name}`, 'error');
      return;
    }
    if (!checkCanGenerate()) return;
    setGeneratingCamA(activeCamera.id);
    try {
      await runBackgroundForCamera(activeCamera, await translateNotes());
      setViewerMode('compare');
      showToast(`Фон ${activeCamera.name} готов — проверьте превью`, 'success');
    } catch (err) {
      showToast(`Ошибка генерации: ${err.message}`, 'error');
    } finally {
      setGeneratingCamA(null);
    }
  };

  // ---- Выбор версии из ленты ----
  const handleSelectVersion = (camId, entry) => {
    updateProject(p => ({
      ...p,
      cameras: p.cameras.map(c => {
        if (c.id !== camId) return c;
        const hist = c.history || [];
        if (entry.stage === 'A') {
          const bg = hist.find(h => h.stage === 'B' && h.fromPreviewId === entry.id);
          return {
            ...c,
            previewImage: entry.imageUrl,
            previewId: entry.id,
            cleanPlateImage: bg ? bg.imageUrl : null,
            cleanPlateFromId: bg ? entry.id : null
          };
        }
        return { ...c, cleanPlateImage: entry.imageUrl, cleanPlateFromId: entry.fromPreviewId || null };
      })
    }));
  };

  const handleGenerateAllBackgrounds = async () => {
    const eligible = activeProject.cameras.filter(c => !!c.inputImage);
    if (eligible.length === 0) {
      showToast('Ни у одной камеры нет исходника', 'error');
      return;
    }
    if (!checkCanGenerate()) return;
    setBatchProgress({ current: 0, total: eligible.length, camName: eligible[0].name });
    let successCount = 0;
    const notes = await translateNotes();
    for (let i = 0; i < eligible.length; i++) {
      const cam = eligible[i];
      setBatchProgress({ current: i + 1, total: eligible.length, camName: cam.name });
      setGeneratingCamA(cam.id);
      try {
        await runBackgroundForCamera(cam, notes);
        successCount++;
      } catch (err) {
        showToast(`Ошибка на ${cam.name}: ${err.message}`, 'error');
      }
    }
    setGeneratingCamA(null);
    setBatchProgress(null);
    setViewerMode('compare');
    showToast(`Готово фонов: ${successCount} из ${eligible.length}`, 'success');
  };

  const handleDownloadAllCleanPlates = () => {
    const ready = activeProject.cameras.filter(c => !!c.cleanPlateImage);
    if (ready.length === 0) {
      showToast('Пока нет готовых фонов для скачивания', 'info');
      return;
    }
    ready.forEach((cam, idx) => {
      setTimeout(() => {
        const cleanName = `${cam.name.replace(/\s+/g, '_')}_clean.png`;
        downloadImageAtResolution(cam.cleanPlateImage, cleanName, activeProject.resolution, activeProject.aspectRatio);
      }, idx * 350);
    });
    showToast(`Запущена выгрузка ${ready.length} файлов (${activeProject.resolution})`, 'success');
  };

  const cleanPlatesCount = activeProject.cameras.filter(c => !!c.cleanPlateImage).length;

  const getFurnitureIcon = (type) => {
    if (type === 'plant') return <Sprout className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    if (type === 'bar_stool') return <Disc className="w-3.5 h-3.5 text-neutral-300 shrink-0" />;
    return <Armchair className="w-3.5 h-3.5 text-neutral-400 shrink-0" />;
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div
      style={{ '--accent': accentColor }}
      className="min-h-screen bg-[#0B0B0B] text-white font-sans flex flex-col"
    >
      {/* ==================== TOP NAVIGATION HEADER ==================== */}
      <header className="sticky top-0 z-40 h-14 bg-[#0E0E0E]/95 backdrop-blur-md border-b border-[#262626] px-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-4 min-w-0">
          <MonteVideoLogo />

          <div className="h-5 w-px bg-[#262626] hidden sm:block" />

          {/* Project Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowProjectMenu(!showProjectMenu)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141414] hover:bg-[#1C1C1C] border border-[#262626] text-xs font-medium text-white transition max-w-[200px] sm:max-w-[240px]"
            >
              <FolderOpen className="w-3.5 h-3.5 shrink-0" style={{ color: accentColor }} />
              <span className="truncate">{activeProject.name}</span>
              <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            </button>

            {showProjectMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowProjectMenu(false)} />
                <div className="absolute left-0 mt-2 w-72 bg-[#141414] border border-[#262626] rounded-2xl shadow-2xl z-40 overflow-hidden">
                  <div className="p-2 border-b border-[#222222] max-h-52 overflow-y-auto">
                    <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                      Проекты ({projects.length})
                    </div>
                    {projects.map(p => {
                      const isCur = p.id === activeProject.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => {
                            setActiveProjectId(p.id);
                            setShowProjectMenu(false);
                          }}
                          style={isCur ? { backgroundColor: accentAlpha(accentColor, 0.12), color: accentColor } : undefined}
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-left text-xs transition ${
                            isCur ? 'font-semibold' : 'text-neutral-300 hover:bg-[#1E1E1E]'
                          }`}
                        >
                          <span className="truncate">{p.name}</span>
                          <span className="text-[10px] font-mono text-neutral-500 ml-2 shrink-0">
                            {p.cameras.length} cam
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="p-2 space-y-1 bg-[#101010]">
                    <button
                      onClick={() => { setShowProjectMenu(false); setNewProjectModal(true); }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-white hover:bg-[#1E1E1E] transition"
                    >
                      <Plus className="w-3.5 h-3.5" style={{ color: accentColor }} /> Создать новый проект
                    </button>
                    <button
                      onClick={handleDuplicateProject}
                      style={{ color: accentColor }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs hover:bg-[#1E1E1E] font-medium transition"
                    >
                      <Copy className="w-3.5 h-3.5" /> Дублировать проект (1 клик)
                    </button>
                    <div className="grid grid-cols-2 gap-1 pt-1 border-t border-[#222222]">
                      <button
                        onClick={handleExportProjectJson}
                        className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] text-neutral-300 hover:bg-[#1E1E1E]"
                      >
                        <Download className="w-3 h-3" /> Экспорт .json
                      </button>
                      <label className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] text-neutral-300 hover:bg-[#1E1E1E] cursor-pointer">
                        <Upload className="w-3 h-3" /> Импорт .json
                        <input type="file" accept=".json" className="hidden" onChange={handleImportProjectJson} />
                      </label>
                    </div>
                    <button
                      onClick={() => { setShowProjectMenu(false); setConfirmDeleteProject(true); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs text-red-400 hover:bg-red-500/10 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Удалить текущий проект
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Center: Module Switcher */}
        <div className="hidden md:flex items-center bg-[#141414] border border-[#262626] p-1 rounded-full">
          <button
            onClick={() => setActiveModule('studio')}
            style={activeModule === 'studio' ? { backgroundColor: accentColor, color: '#0B0B0B' } : undefined}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition ${
              activeModule === 'studio' ? '' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> Модуль 1: Студия и Генерация
          </button>
          <button
            onClick={() => setActiveModule('timeline')}
            style={activeModule === 'timeline' ? { backgroundColor: accentColor, color: '#0B0B0B' } : undefined}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition ${
              activeModule === 'timeline' ? '' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Film className="w-3.5 h-3.5" /> Модуль 2: Таймлайн
          </button>
        </div>

        {/* Right: Format Pills + Assets + Setup/Settings */}
        <div className="flex items-center gap-2">
          <div className="hidden xl:flex items-center bg-[#141414] border border-[#262626] p-0.5 rounded-full">
            {['1080p', '2K', '4K'].map(res => (
              <button
                key={res}
                onClick={() => updateProject({ resolution: res })}
                style={activeProject.resolution === res ? { color: accentColor } : undefined}
                className={`px-2.5 py-1 rounded-full text-[11px] font-mono transition ${
                  activeProject.resolution === res ? 'bg-[#262626] font-bold' : 'text-neutral-500 hover:text-white'
                }`}
              >
                {res}
              </button>
            ))}
          </div>

          <div className="hidden xl:flex items-center bg-[#141414] border border-[#262626] p-0.5 rounded-full">
            {['16:9', '9:16'].map(ar => (
              <button
                key={ar}
                onClick={() => updateProject({ aspectRatio: ar })}
                style={activeProject.aspectRatio === ar ? { color: accentColor } : undefined}
                className={`px-2.5 py-1 rounded-full text-[11px] font-mono transition ${
                  activeProject.aspectRatio === ar ? 'bg-[#262626] font-bold' : 'text-neutral-500 hover:text-white'
                }`}
              >
                {ar}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowAssetsModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#141414] hover:bg-[#1C1C1C] border border-[#262626] text-xs font-medium text-white transition"
          >
            <History className="w-3.5 h-3.5" style={{ color: accentColor }} />
            <span className="hidden sm:inline">Ассеты</span>
            {cleanPlatesCount > 0 && (
              <span
                className="px-1.5 py-0.2 rounded-full text-[10px] font-bold text-black"
                style={{ backgroundColor: accentColor }}
              >
                {cleanPlatesCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setShowSettingsModal(true)}
            className="flex items-center gap-1.5 p-2 sm:px-3 sm:py-1.5 rounded-full bg-[#141414] hover:bg-[#1C1C1C] border border-[#262626] text-neutral-300 hover:text-white text-xs font-medium transition"
            title="Установки: API-ключ и акцентный цвет"
          >
            <Settings className="w-4 h-4" />
            <span className="hidden lg:inline">Установки</span>
          </button>
        </div>
      </header>

      {/* Mobile Module Switcher */}
      <div className="flex md:hidden items-center justify-center gap-2 p-2 border-b border-[#262626] bg-[#101010]">
        <button
          onClick={() => setActiveModule('studio')}
          style={activeModule === 'studio' ? { backgroundColor: accentColor, color: '#0B0B0B' } : undefined}
          className={`flex-1 py-1.5 rounded-full text-xs font-semibold ${
            activeModule === 'studio' ? '' : 'bg-[#181818] text-neutral-400'
          }`}
        >
          Студия и Генерация
        </button>
        <button
          onClick={() => setActiveModule('timeline')}
          style={activeModule === 'timeline' ? { backgroundColor: accentColor, color: '#0B0B0B' } : undefined}
          className={`flex-1 py-1.5 rounded-full text-xs font-semibold ${
            activeModule === 'timeline' ? '' : 'bg-[#181818] text-neutral-400'
          }`}
        >
          Таймлайн ({activeProject.cameras.length})
        </button>
      </div>

      {/* ==================== MAIN CONTENT ==================== */}
      {activeModule === 'timeline' ? (
        <TimelineModule
          project={activeProject}
          accentColor={accentColor}
          onUpdateCamera={updateCamera}
          onGoToStudio={() => setActiveModule('studio')}
        />
      ) : (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0">
          {/* ==================== LEFT INSPECTOR PANEL ==================== */}
          <aside className="lg:col-span-4 xl:col-span-3 border-b lg:border-b-0 lg:border-r border-[#262626] bg-[#111111] flex flex-col overflow-y-auto lg:max-h-[calc(100vh-56px)]">
            <div className="grid grid-cols-3 gap-1 p-2.5 border-b border-[#222222] bg-[#0E0E0E] sticky top-0 z-10">
              {[
                { id: 'cameras', label: 'Камеры', icon: Camera },
                { id: 'scene', label: 'Сцена', icon: Users },
                { id: 'location', label: 'Локация', icon: ImageIcon }
              ].map(t => {
                const Icon = t.icon;
                const active = leftTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setLeftTab(t.id)}
                    style={active ? { backgroundColor: accentColor, color: '#0B0B0B' } : undefined}
                    className={`flex items-center justify-center gap-1.5 py-2 rounded-full text-xs font-semibold transition ${
                      active ? '' : 'bg-[#161616] text-neutral-400 hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" /> {t.label}
                  </button>
                );
              })}
            </div>

            <div className="p-3.5 space-y-4 flex-1">
              {/* -------- TAB 1: CAMERAS (1..5), BRAW PARSER & Z-AXIS -------- */}
              {leftTab === 'cameras' && activeCamera && (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                        Камеры ({activeProject.cameras.length}/5)
                      </span>
                      <button
                        onClick={handleAddCamera}
                        disabled={activeProject.cameras.length >= 5}
                        style={{ color: accentColor }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#1C1C1C] hover:bg-[#262626] disabled:opacity-40 text-[11px] font-medium border border-[#2A2A2A] transition"
                      >
                        <Plus className="w-3 h-3" /> Добавить
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {activeProject.cameras.map(cam => {
                        const isActive = cam.id === activeCamera.id;
                        return (
                          <button
                            key={cam.id}
                            onClick={() => setActiveCameraId(cam.id)}
                            style={isActive ? { backgroundColor: accentColor, borderColor: accentColor, color: '#0B0B0B' } : undefined}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                              isActive ? '' : 'bg-[#161616] text-neutral-300 border-[#262626] hover:border-neutral-500'
                            }`}
                          >
                            {cam.name}
                            {cam.cleanPlateImage && (
                              <span
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ backgroundColor: isActive ? '#0B0B0B' : accentColor }}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Stop-Frame Upload + Delete Camera */}
                  <div className="bg-[#0E0E0E] border border-[#262626] rounded-xl p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">Исходный стоп-кадр ({activeCamera.name})</span>
                      {activeProject.cameras.length > 1 && (
                        <button
                          onClick={() => handleRemoveCamera(activeCamera.id)}
                          className="text-neutral-500 hover:text-red-400 transition p-1"
                          title="Удалить камеру"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <label className="flex items-center gap-3 p-2 rounded-xl bg-[#141414] hover:bg-[#1A1A1A] border border-dashed border-[#333333] hover:border-[var(--accent)] cursor-pointer transition">
                      {activeCamera.inputImage ? (
                        <img src={activeCamera.inputImage} alt="" className="w-16 h-10 object-cover rounded-lg border border-[#262626]" />
                      ) : (
                        <div className="w-16 h-10 rounded-lg bg-[#0B0B0B] flex items-center justify-center border border-[#262626]">
                          <Upload className="w-4 h-4 text-neutral-500" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-white truncate">
                          {activeCamera.inputImage ? 'Заменить стоп-кадр' : 'Загрузить JPG / PNG'}
                        </div>
                        <div className="text-[10px] text-neutral-500">Кадр с хромакея (без .braw)</div>
                      </div>
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleUploadCameraInput} />
                    </label>

                    <button
                      onClick={() => setShowBrawModal(true)}
                      className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-full bg-[#1C1C1C] hover:bg-[#242424] border border-[#333333] text-xs font-medium text-white transition"
                    >
                      <FileText className="w-3.5 h-3.5" style={{ color: accentColor }} />
                      Вставить метаданные из Premiere (BRAW)
                    </button>
                  </div>

                  {/* Parsed BRAW Optics & Lighting Specs */}
                  <div className="bg-[#0E0E0E] border border-[#262626] rounded-xl p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                        Оптика и свет (BRAW)
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#1A1A1A]" style={{ color: accentColor }}>
                        ≈ {Math.round(activeCamera.focalLength * activeCamera.cropFactor)}mm FF eq.
                      </span>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <label className="block text-[10px] text-neutral-500 mb-0.5">Камера (Camera Type)</label>
                        <input
                          type="text"
                          value={activeCamera.cameraType}
                          onChange={(e) => updateCamera(activeCamera.id, {
                            cameraType: e.target.value,
                            cropFactor: detectCropFactor(e.target.value)
                          })}
                          className="w-full bg-[#141414] border border-[#262626] rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-[var(--accent)] outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-neutral-500 mb-0.5">Объектив (Lens Type)</label>
                        <input
                          type="text"
                          value={activeCamera.lensType}
                          onChange={(e) => updateCamera(activeCamera.id, { lensType: e.target.value })}
                          className="w-full bg-[#141414] border border-[#262626] rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-[var(--accent)] outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] text-neutral-500 mb-0.5">Фокус (мм)</label>
                          <input
                            type="number"
                            min="10"
                            max="300"
                            value={activeCamera.focalLength}
                            onChange={(e) => updateCamera(activeCamera.id, { focalLength: Number(e.target.value) || 24 })}
                            className="w-full bg-[#141414] border border-[#262626] rounded-lg px-2 py-1.5 text-xs font-mono text-white focus:border-[var(--accent)] outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-neutral-500 mb-0.5">Кроп (x)</label>
                          <input
                            type="number"
                            step="0.1"
                            min="0.8"
                            max="3.0"
                            value={activeCamera.cropFactor}
                            onChange={(e) => updateCamera(activeCamera.id, { cropFactor: parseFloat(e.target.value) || 1.0 })}
                            className="w-full bg-[#141414] border border-[#262626] rounded-lg px-2 py-1.5 text-xs font-mono text-white focus:border-[var(--accent)] outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-neutral-500 mb-0.5">Диафрагма</label>
                          <input
                            type="text"
                            value={activeCamera.aperture}
                            onChange={(e) => updateCamera(activeCamera.id, { aperture: e.target.value })}
                            className="w-full bg-[#141414] border border-[#262626] rounded-lg px-2 py-1.5 text-xs font-mono text-white focus:border-[var(--accent)] outline-none"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] text-neutral-500 mb-0.5">WB (Kelvin)</label>
                          <input
                            type="number"
                            step="100"
                            min="2000"
                            max="10000"
                            value={activeCamera.wbKelvin}
                            onChange={(e) => updateCamera(activeCamera.id, { wbKelvin: parseInt(e.target.value, 10) || 4000 })}
                            className="w-full bg-[#141414] border border-[#262626] rounded-lg px-2 py-1.5 text-xs font-mono text-white focus:border-[var(--accent)] outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-neutral-500 mb-0.5">Tint</label>
                          <input
                            type="number"
                            value={activeCamera.wbTint}
                            onChange={(e) => updateCamera(activeCamera.id, { wbTint: parseInt(e.target.value, 10) || 0 })}
                            className="w-full bg-[#141414] border border-[#262626] rounded-lg px-2 py-1.5 text-xs font-mono text-white focus:border-[var(--accent)] outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-neutral-500 mb-0.5">ISO</label>
                          <input
                            type="number"
                            value={activeCamera.iso}
                            onChange={(e) => updateCamera(activeCamera.id, { iso: parseInt(e.target.value, 10) || 400 })}
                            className="w-full bg-[#141414] border border-[#262626] rounded-lg px-2 py-1.5 text-xs font-mono text-white focus:border-[var(--accent)] outline-none"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1 text-[10px] font-mono text-neutral-500">
                        <span>X: {activeCamera.x.toFixed(2)}m · Y: {activeCamera.y.toFixed(2)}m</span>
                        <span>FOV: {Math.round(calcHorizontalFovDeg(activeCamera.focalLength, activeCamera.cropFactor))}°</span>
                      </div>
                    </div>
                  </div>

                  {/* Mini Side-View Elevation Widget */}
                  <SideViewElevation
                    camera={activeCamera}
                    speakers={activeProject.speakers}
                    furniture={activeProject.furniture}
                    accentColor={accentColor}
                    onChange={(patch) => updateCamera(activeCamera.id, patch)}
                  />
                </>
              )}

              {/* -------- TAB 2: SPEAKERS (1..5) & FURNITURE / DECOR -------- */}
              {leftTab === 'scene' && (
                <>
                  {/* Speakers Block */}
                  <div className="bg-[#0E0E0E] border border-[#262626] rounded-xl p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                        Спикеры в кадре ({activeProject.speakers.length}/5)
                      </span>
                      <button
                        onClick={handleAddSpeaker}
                        disabled={activeProject.speakers.length >= 5}
                        style={{ color: accentColor }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#1C1C1C] hover:bg-[#262626] disabled:opacity-40 text-[11px] border border-[#2A2A2A]"
                      >
                        <Plus className="w-3 h-3" /> Добавить
                      </button>
                    </div>

                    <div className="space-y-2">
                      {activeProject.speakers.map((spk, idx) => (
                        <div key={spk.id} className="p-2.5 rounded-xl bg-[#141414] border border-[#242424] flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full ${spk.pose === 'sitting' ? 'bg-sky-400' : 'bg-amber-400'}`} />
                              <span className="text-xs font-semibold text-white">S{idx + 1} · {spk.name}</span>
                            </div>
                            <div className="text-[10px] font-mono text-neutral-500 mt-0.5">
                              X:{spk.x.toFixed(1)}m · Y:{spk.y.toFixed(1)}m
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <div className="flex bg-[#0B0B0B] p-0.5 rounded-full border border-[#262626]">
                              <button
                                onClick={() => updateSpeaker(spk.id, { pose: 'sitting' })}
                                className={`px-2 py-1 rounded-full text-[10px] font-semibold transition ${
                                  spk.pose === 'sitting' ? 'bg-sky-400 text-black' : 'text-neutral-400'
                                }`}
                              >
                                Сидит
                              </button>
                              <button
                                onClick={() => updateSpeaker(spk.id, { pose: 'standing' })}
                                className={`px-2 py-1 rounded-full text-[10px] font-semibold transition ${
                                  spk.pose === 'standing' ? 'bg-amber-400 text-black' : 'text-neutral-400'
                                }`}
                              >
                                Стоит
                              </button>
                            </div>
                            <button
                              onClick={() => handleRemoveSpeaker(spk.id)}
                              className="p-1 text-neutral-500 hover:text-red-400 transition"
                              title="Удалить спикера"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Furniture & Props Block (Presets + Individual Add / Delete) */}
                  <div className="bg-[#0E0E0E] border border-[#262626] rounded-xl p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                        Мебель и рассадка ({activeProject.furniture.length})
                      </span>
                    </div>

                    {/* Quick Presets */}
                    <div>
                      <div className="text-[10px] text-neutral-500 mb-1.5">Быстрые пресеты:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(FURNITURE_PRESETS).map(([key, preset]) => {
                          const active = activeProject.furniturePreset === key;
                          return (
                            <button
                              key={key}
                              onClick={() => handleSelectFurniturePreset(key)}
                              style={active ? { backgroundColor: accentColor, borderColor: accentColor, color: '#0B0B0B' } : undefined}
                              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition ${
                                active ? 'font-semibold' : 'bg-[#141414] text-neutral-300 border-[#262626] hover:border-neutral-500'
                              }`}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Add Individual Item Buttons */}
                    <div className="pt-2 border-t border-[#1E1E1E]">
                      <div className="text-[10px] text-neutral-500 mb-1.5">Добавить отдельный предмет:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(FURNITURE_CATALOG).map(([key, spec]) => (
                          <button
                            key={key}
                            onClick={() => handleAddFurnitureItem(key)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#181818] hover:bg-[#242424] border border-[#2C2C2C] hover:border-[var(--accent)] text-[11px] text-white transition"
                          >
                            <Plus className="w-3 h-3" style={{ color: accentColor }} />
                            {spec.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Active Furniture List with Height, Optional Rotation, and Delete */}
                    {activeProject.furniture.length > 0 ? (
                      <div className="space-y-2 pt-1">
                        {activeProject.furniture.map(item => {
                          const spec = FURNITURE_CATALOG[item.type] || { minH: 30, maxH: 150, rotatable: true };
                          const isRotatable = item.rotatable !== undefined ? item.rotatable : spec.rotatable;
                          return (
                            <div key={item.id} className="p-2.5 rounded-xl bg-[#141414] border border-[#242424] space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-white flex items-center gap-1.5 truncate">
                                  {getFurnitureIcon(item.type)}
                                  <span className="truncate">{item.name}</span>
                                </span>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-xs font-mono" style={{ color: accentColor }}>
                                    {item.heightCm} см
                                  </span>
                                  <button
                                    onClick={() => handleRemoveFurnitureItem(item.id)}
                                    className="p-1 text-neutral-500 hover:text-red-400 transition"
                                    title="Удалить предмет"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              <div>
                                <div className="flex justify-between text-[10px] text-neutral-500 mb-0.5">
                                  <span>Высота</span>
                                  <span className="font-mono">X:{item.x.toFixed(1)}m · Y:{item.y.toFixed(1)}m</span>
                                </div>
                                <input
                                  type="range"
                                  min={spec.minH}
                                  max={spec.maxH}
                                  step="1"
                                  value={item.heightCm}
                                  onChange={(e) => updateFurniture(item.id, { heightCm: parseInt(e.target.value, 10) })}
                                  style={{ accentColor }}
                                  className="w-full h-1.5 bg-[#262626] rounded-lg cursor-pointer"
                                />
                              </div>

                              {isRotatable && (
                                <div className="flex items-center justify-between text-[10px] text-neutral-500">
                                  <span>Поворот: {item.rotation || 0}°</span>
                                  <input
                                    type="range"
                                    min="-180"
                                    max="180"
                                    step="5"
                                    value={item.rotation || 0}
                                    onChange={(e) => updateFurniture(item.id, { rotation: parseInt(e.target.value, 10) })}
                                    className="w-28 accent-neutral-400 h-1 bg-[#262626] rounded-lg cursor-pointer"
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-[11px] text-neutral-500 text-center py-3 border border-dashed border-[#242424] rounded-xl">
                        На сцене нет мебели — выберите пресет или добавьте отдельный предмет выше
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* -------- TAB 3: LOCATION REFS, RUSSIAN NOTES & AUTO-PROMPT -------- */}
              {leftTab === 'location' && (
                <>
                  <div className="bg-[#0E0E0E] border border-[#262626] rounded-xl p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                        Референсы локации ({activeProject.locationRefs.length})
                      </span>
                      <label
                        style={{ backgroundColor: accentColor }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-black text-[11px] font-semibold cursor-pointer hover:brightness-110 transition"
                      >
                        <Plus className="w-3 h-3" /> Фото
                        <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleUploadLocationRefs} />
                      </label>
                    </div>

                    {activeProject.locationRefs.length === 0 ? (
                      <label className="block p-5 rounded-xl border border-dashed border-[#333333] hover:border-[var(--accent)] text-center cursor-pointer transition">
                        <ImageIcon className="w-6 h-6 text-neutral-500 mx-auto mb-1.5" />
                        <div className="text-xs text-neutral-300">Загрузите 1 или несколько фото локации</div>
                        <div className="text-[10px] text-neutral-500 mt-0.5">JPG / PNG · Передаются в Nano Banana 2</div>
                        <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleUploadLocationRefs} />
                      </label>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {activeProject.locationRefs.map(ref => (
                          <div key={ref.id} className="relative group rounded-xl overflow-hidden border border-[#262626] aspect-video bg-black">
                            <img src={ref.dataUrl} alt={ref.name} className="w-full h-full object-cover" />
                            <button
                              onClick={() => updateProject(p => ({
                                ...p,
                                locationRefs: p.locationRefs.filter(r => r.id !== ref.id)
                              }))}
                              className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/75 text-white hover:bg-red-500 opacity-0 group-hover:opacity-100 transition"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-[#0E0E0E] border border-[#262626] rounded-xl p-3 space-y-2">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 block">
                      Комментарий оператора (на русском)
                    </label>
                    <textarea
                      rows={4}
                      value={activeProject.russianComment}
                      onChange={(e) => updateProject({ russianComment: e.target.value })}
                      placeholder="Опишите детали интерьера, свет, атмосферу или правки..."
                      className="w-full bg-[#141414] border border-[#262626] rounded-xl p-2.5 text-xs text-white placeholder-neutral-600 focus:border-[var(--accent)] outline-none resize-none leading-relaxed"
                    />
                    <p className="text-[10px] text-neutral-500">
                      Автоматически переводится на английский и интегрируется в промпт при генерации.
                    </p>
                  </div>

                  <div className="bg-[#0E0E0E] border border-[#262626] rounded-xl overflow-hidden">
                    <button
                      onClick={() => setShowPromptEditor(!showPromptEditor)}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium text-neutral-300 hover:text-white"
                    >
                      <span className="flex items-center gap-1.5">
                        <Code className="w-3.5 h-3.5" style={{ color: accentColor }} />
                        Авто-промпт (EN)
                      </span>
                      {showPromptEditor ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>

                    {showPromptEditor && (
                      <div className="px-3 pb-3 space-y-2 border-t border-[#1E1E1E] pt-2">
                        <textarea
                          rows={7}
                          value={autoPromptStageA}
                          onChange={(e) => updateProject({ customPromptOverride: e.target.value })}
                          className="w-full bg-[#090909] border border-[#262626] rounded-lg p-2 text-[11px] font-mono text-neutral-300 focus:border-[var(--accent)] outline-none leading-relaxed"
                        />
                        {activeProject.customPromptOverride && (
                          <button
                            onClick={() => updateProject({ customPromptOverride: '' })}
                            style={{ color: accentColor }}
                            className="flex items-center gap-1 text-[11px] hover:underline"
                          >
                            <RotateCcw className="w-3 h-3" /> Сбросить к автосборке
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </aside>

          {/* ==================== MAIN STUDIO WORKSPACE ==================== */}
          <main className="lg:col-span-8 xl:col-span-9 p-4 flex flex-col gap-4 overflow-y-auto lg:max-h-[calc(100vh-56px)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 bg-[#141414] border border-[#262626] p-1 rounded-full">
                {[
                  { id: 'split', label: 'План + Превью', icon: Columns },
                  { id: 'plan', label: 'Только План', icon: Compass },
                  { id: 'preview', label: 'Только Превью', icon: Maximize2 }
                ].map(item => {
                  const Icon = item.icon;
                  const active = workspaceLayout === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setWorkspaceLayout(item.id)}
                      style={active ? { color: accentColor } : undefined}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition ${
                        active ? 'bg-[#262626] font-semibold' : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" /> {item.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex xl:hidden items-center gap-1.5">
                <select
                  value={activeProject.resolution}
                  onChange={(e) => updateProject({ resolution: e.target.value })}
                  style={{ color: accentColor }}
                  className="bg-[#141414] border border-[#262626] rounded-full px-2.5 py-1 text-xs font-mono"
                >
                  <option value="1080p">1080p</option>
                  <option value="2K">2K</option>
                  <option value="4K">4K</option>
                </select>
                <select
                  value={activeProject.aspectRatio}
                  onChange={(e) => updateProject({ aspectRatio: e.target.value })}
                  className="bg-[#141414] border border-[#262626] rounded-full px-2.5 py-1 text-xs font-mono text-white"
                >
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </div>
            </div>

            <div className={`grid gap-4 ${workspaceLayout === 'split' ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
              {(workspaceLayout === 'split' || workspaceLayout === 'plan') && (
                <StudioTopViewCanvas
                  project={activeProject}
                  activeCameraId={activeCamera?.id}
                  accentColor={accentColor}
                  onSelectCamera={setActiveCameraId}
                  onUpdateCamera={updateCamera}
                  onUpdateSpeaker={updateSpeaker}
                  onUpdateFurniture={updateFurniture}
                />
              )}

              {(workspaceLayout === 'split' || workspaceLayout === 'preview') && activeCamera && (
                <BeforeAfterViewer
                  camera={activeCamera}
                  aspectRatio={activeProject.aspectRatio}
                  accentColor={accentColor}
                  viewMode={viewerMode}
                  setViewMode={setViewerMode}
                  isGeneratingStageA={generatingCamA === activeCamera.id}
                  isGeneratingStageB={generatingCamB === activeCamera.id}
                  onUploadInput={handleUploadCameraInput}
                  onSelectVersion={(entry) => handleSelectVersion(activeCamera.id, entry)}
                />
              )}
            </div>

            {/* ==================== GENERATION PIPELINE ACTION BAR ==================== */}
            <div className="bg-[#141414] border border-[#262626] rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  onClick={handleGenerateBackground}
                  disabled={!!generatingCamA || !!batchProgress}
                  style={{
                    backgroundColor: accentColor,
                    boxShadow: `0 0 24px ${accentAlpha(accentColor, 0.2)}`
                  }}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full hover:brightness-110 disabled:opacity-50 text-black text-xs font-bold tracking-wide transition"
                >
                  <Sparkles className="w-4 h-4" />
                  {generatingCamA && !batchProgress ? 'Генерируем фон…' : `Генерация фона ${activeCamera?.name}`}
                </button>

                <button
                  onClick={handleGenerateAllBackgrounds}
                  disabled={!!generatingCamA || !!batchProgress || !activeProject.cameras.some(c => c.inputImage)}
                  style={{
                    borderColor: accentAlpha(accentColor, 0.55),
                    color: accentColor
                  }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-transparent hover:bg-white/5 disabled:opacity-40 border text-xs font-semibold transition"
                >
                  <Layers className="w-3.5 h-3.5" />
                  {batchProgress
                    ? `Фоны: ${batchProgress.current}/${batchProgress.total} (${batchProgress.camName})`
                    : 'Генерация фона для всех камер'}
                </button>
              </div>

              <button
                onClick={handleDownloadAllCleanPlates}
                disabled={cleanPlatesCount === 0}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#1C1C1C] hover:bg-[#262626] disabled:opacity-40 border border-[#2A2A2A] text-xs font-semibold text-white transition"
              >
                <Download className="w-3.5 h-3.5" style={{ color: accentColor }} />
                Скачать фоны ({cleanPlatesCount})
              </button>
            </div>

            {/* ==================== CAMERA FILMSTRIP (1..5) ==================== */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
              {activeProject.cameras.map(cam => {
                const isActive = cam.id === activeCamera?.id;
                const thumb = cam.cleanPlateImage || cam.previewImage || cam.inputImage;
                return (
                  <button
                    key={cam.id}
                    onClick={() => setActiveCameraId(cam.id)}
                    style={isActive ? { borderColor: accentColor, boxShadow: `0 0 0 1px ${accentAlpha(accentColor, 0.35)}` } : undefined}
                    className={`group text-left rounded-xl overflow-hidden border transition bg-[#121212] ${
                      isActive ? '' : 'border-[#262626] hover:border-neutral-600'
                    }`}
                  >
                    <div className="aspect-video bg-[#080808] relative flex items-center justify-center overflow-hidden">
                      {thumb ? (
                        <img src={thumb} alt={cam.name} className="w-full h-full object-cover" />
                      ) : (
                        <Camera className="w-5 h-5 text-neutral-700" />
                      )}
                      <span
                        style={isActive ? { backgroundColor: accentColor, color: '#0B0B0B' } : undefined}
                        className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          isActive ? '' : 'bg-black/75 text-white'
                        }`}
                      >
                        {cam.name}
                      </span>
                      <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full ${cam.inputImage ? 'bg-emerald-400' : 'bg-neutral-700'}`} title="Исходник" />
                        <span className={`w-2 h-2 rounded-full ${cam.previewImage ? 'bg-sky-400' : 'bg-neutral-700'}`} title="Превью" />
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: cam.cleanPlateImage ? accentColor : '#404040' }}
                          title="Фон"
                        />
                      </div>
                    </div>
                    <div className="px-2.5 py-1.5 flex items-center justify-between text-[10px] font-mono text-neutral-400">
                      <span>{cam.focalLength}mm · {cam.aperture}</span>
                      <span>{cam.wbKelvin}K</span>
                    </div>
                  </button>
                );
              })}

              {activeProject.cameras.length < 5 && (
                <button
                  onClick={handleAddCamera}
                  className="rounded-xl border border-dashed border-[#2A2A2A] hover:border-[var(--accent)] bg-[#0F0F0F] flex flex-col items-center justify-center gap-1.5 min-h-[96px] text-neutral-500 hover:text-[var(--accent)] transition"
                >
                  <Plus className="w-5 h-5" />
                  <span className="text-[11px] font-medium">Добавить камеру</span>
                </button>
              )}
            </div>
          </main>
        </div>
      )}

      {/* ==================== MODALS ==================== */}

      {/* 1. BRAW Metadata Parser Modal */}
      {showBrawModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#141414] border border-[#262626] rounded-2xl overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#222222]">
              <div>
                <h3 className="text-sm font-bold text-white">Парсер метаданных Premiere / Blackmagic RAW</h3>
                <p className="text-xs text-neutral-400 mt-0.5">Вставьте текст из Premiere Pro → Media File Properties</p>
              </div>
              <button onClick={() => setShowBrawModal(false)} className="text-neutral-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <textarea
                rows={10}
                value={brawInputText}
                onChange={(e) => setBrawInputText(e.target.value)}
                placeholder="Camera Type: Blackmagic Studio Camera 4K Pro&#10;Lens Type: OLYMPUS M.40-150mm F2.8&#10;Focal Length: 55mm&#10;Aperture: f4.0&#10;White Balance Kelvin: 4000K..."
                className="w-full bg-[#0B0B0B] border border-[#262626] rounded-xl p-3 text-xs font-mono text-white focus:border-[var(--accent)] outline-none"
              />
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => setBrawInputText(SAMPLE_BRAW_METADATA)}
                  style={{ color: accentColor }}
                  className="text-xs hover:underline"
                >
                  Вставить тестовый пример BRAW
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowBrawModal(false)}
                    className="px-4 py-2 rounded-full bg-[#1C1C1C] text-xs font-medium text-neutral-300"
                  >
                    Отмена
                  </button>
                  <button
                    onClick={handleApplyBrawMetadata}
                    style={{ backgroundColor: accentColor }}
                    className="px-5 py-2 rounded-full text-black text-xs font-bold hover:brightness-110"
                  >
                    Распознать и заполнить
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Установки (API-ключ + акцентный цвет + хранилище) */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#141414] border border-[#262626] rounded-2xl overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#222222]">
              <h3 className="text-sm font-bold text-white">Установки</h3>
              <button onClick={() => setShowSettingsModal(false)} className="text-neutral-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Accent Color Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5" style={{ color: accentColor }} />
                    Акцентный цвет интерфейса
                  </label>
                  <button
                    onClick={() => setAccentColor(DEFAULT_ACCENT)}
                    className="text-[11px] text-neutral-400 hover:text-white flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" /> По умолчанию
                  </button>
                </div>

                {/* Safe Swatches */}
                <div className="flex flex-wrap items-center gap-2">
                  {SAFE_ACCENT_PRESETS.map(preset => {
                    const selected = accentColor.toUpperCase() === preset.hex.toUpperCase();
                    return (
                      <button
                        key={preset.hex}
                        onClick={() => setAccentColor(preset.hex)}
                        title={preset.name}
                        className="w-8 h-8 rounded-full border-2 transition flex items-center justify-center"
                        style={{
                          backgroundColor: preset.hex,
                          borderColor: selected ? '#FFFFFF' : 'transparent',
                          transform: selected ? 'scale(1.1)' : 'scale(1)'
                        }}
                      />
                    );
                  })}

                  {/* Custom Safe Color Picker */}
                  <label
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0B0B0B] border border-[#333333] hover:border-white cursor-pointer text-[11px] text-neutral-300"
                    title="Выбрать произвольный цвет (авто-коррекция яркости для читаемости)"
                  >
                    <span className="w-3.5 h-3.5 rounded-full border border-white/30" style={{ backgroundColor: accentColor }} />
                    <span className="font-mono">{accentColor}</span>
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(enforceSafeAccentColor(e.target.value))}
                      className="sr-only"
                    />
                  </label>
                </div>

                {/* Live Contrast Safety Preview */}
                <div className="p-2.5 rounded-xl bg-[#0B0B0B] border border-[#222222] flex items-center justify-between gap-2">
                  <span className="px-3 py-1 rounded-full text-[11px] font-bold text-black" style={{ backgroundColor: accentColor }}>
                    Кнопка CTA
                  </span>
                  <span className="text-[11px] font-mono" style={{ color: accentColor }}>
                    Акцент на тёмном
                  </span>
                  <span className="text-[10px] text-neutral-500">Защита контраста ✓</span>
                </div>
                <p className="text-[10px] text-neutral-500 leading-relaxed">
                  Цвет привязан локально к этому компьютеру. Слишком тёмные оттенки автоматически осветляются, чтобы тексты и кнопки всегда оставались читаемыми.
                </p>
              </div>

              <div className="h-px bg-[#222222]" />

              {/* Gemini API Key Section */}
              <div>
                <label className="block text-xs font-semibold text-white mb-1.5">
                  Google AI Studio API Key (Nano Banana 2)
                </label>
                <input
                  type="text"
                  name="gemini-api-key"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-1p-ignore="true"
                  data-lpignore="true"
                  style={{ WebkitTextSecurity: 'disc' }}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value.trim())}
                  placeholder="AIzaSy..."
                  className="w-full bg-[#0B0B0B] border border-[#262626] rounded-xl px-3.5 py-2.5 text-xs font-mono text-white focus:border-[var(--accent)] outline-none"
                />
                <p className="text-[10px] text-neutral-500 mt-2 leading-relaxed">
                  Ключ сохраняется локально в <span className="font-mono text-neutral-300">localStorage</span> вашего браузера и никогда не попадает в код репозитория.
                </p>
              </div>

              <div className="h-px bg-[#222222]" />

              {/* Хранилище */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-white">Хранилище проектов</span>
                  <span className="text-[11px] font-mono text-neutral-400">
                    {storageInfo?.usage != null
                      ? `${(storageInfo.usage / 1048576).toFixed(1)} МБ из ${Math.round((storageInfo.quota || 0) / 1073741824)} ГБ`
                      : '—'}
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 leading-relaxed">
                  Проекты и картинки хранятся в этом браузере на этом компьютере (IndexedDB) и сохраняются автоматически.
                  Если очистить данные браузера, они удалятся — для резервной копии используйте «Экспорт .json» в меню проекта.
                </p>
              </div>

              <div className="flex items-center justify-between gap-3">
                <a
                  href={`https://github.com/swanex/monte-video-chrome/commit/${__APP_COMMIT__}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] font-mono text-neutral-600 hover:text-neutral-300 transition"
                  title="Версия приложения и код коммита в GitHub"
                >
                  v{__APP_VERSION__} · {__APP_COMMIT__.slice(0, 7)} · {new Date(__APP_BUILD_DATE__).toLocaleDateString('ru-RU')}
                </a>
                <button
                  onClick={() => { setShowSettingsModal(false); showToast('Установки сохранены', 'success'); }}
                  style={{ backgroundColor: accentColor }}
                  className="px-5 py-2 rounded-full text-black text-xs font-bold hover:brightness-110 transition"
                >
                  Готово
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. History & Assets Export Modal */}
      {showAssetsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[85vh] bg-[#141414] border border-[#262626] rounded-2xl overflow-hidden shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#222222]">
              <div>
                <h3 className="text-sm font-bold text-white">История и Ассеты проекта ({activeProject.resolution} · {activeProject.aspectRatio})</h3>
                <p className="text-xs text-neutral-400 mt-0.5">Готовые фоны для монтажа в Adobe Premiere Pro</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadAllCleanPlates}
                  disabled={cleanPlatesCount === 0}
                  style={{ backgroundColor: accentColor }}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-full disabled:opacity-40 text-black text-xs font-bold"
                >
                  <Download className="w-3.5 h-3.5" /> Скачать фоны ({cleanPlatesCount})
                </button>
                <button onClick={() => setShowAssetsModal(false)} className="text-neutral-400 hover:text-white p-1">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {activeProject.cameras.map(cam => (
                <div key={cam.id} className="bg-[#0E0E0E] border border-[#262626] rounded-xl p-3.5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#262626]" style={{ color: accentColor }}>
                        {cam.name}
                      </span>
                      <span className="text-xs font-mono text-neutral-400">{cam.focalLength}mm · {cam.aperture} · {cam.wbKelvin}K</span>
                    </div>
                    {cam.cleanPlateImage && (
                      <button
                        onClick={() => downloadImageAtResolution(
                          cam.cleanPlateImage,
                          `${cam.name.replace(/\s+/g, '_')}_clean.png`,
                          activeProject.resolution,
                          activeProject.aspectRatio
                        )}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1C1C1C] hover:bg-[#262626] text-xs text-white border border-[#333333]"
                      >
                        <Download className="w-3 h-3" style={{ color: accentColor }} /> {cam.name.replace(/\s+/g, '_')}_clean.png
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2.5">
                    {[
                      { label: 'Исходник', src: cam.inputImage },
                      { label: 'Превью', src: cam.previewImage },
                      { label: 'Фон', src: cam.cleanPlateImage }
                    ].map((slot, i) => (
                      <div key={i} className="rounded-lg overflow-hidden border border-[#222222] bg-[#080808]">
                        <div className="aspect-video flex items-center justify-center">
                          {slot.src ? (
                            <img src={slot.src} alt={slot.label} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-[10px] text-neutral-600">Пусто</span>
                          )}
                        </div>
                        <div className="px-2 py-1 text-[10px] text-neutral-400 bg-[#121212]">{slot.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 4. New Project Modal */}
      {newProjectModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#141414] border border-[#262626] rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white">Новый проект</h3>
            <input
              type="text"
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
              placeholder="Например: Подкаст — Лофт B"
              className="w-full bg-[#0B0B0B] border border-[#262626] rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-[var(--accent)] outline-none"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setNewProjectModal(false)} className="px-4 py-2 rounded-full bg-[#1C1C1C] text-xs text-neutral-300">
                Отмена
              </button>
              <button
                onClick={handleCreateProject}
                style={{ backgroundColor: accentColor }}
                className="px-5 py-2 rounded-full text-black text-xs font-bold"
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Confirm Delete Project Modal */}
      {confirmDeleteProject && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#141414] border border-[#262626] rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white">Удалить проект?</h3>
            <p className="text-xs text-neutral-400">
              Проект «{activeProject.name}» и все его локальные генерации будут удалены без возможности восстановления.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDeleteProject(false)} className="px-4 py-2 rounded-full bg-[#1C1C1C] text-xs text-neutral-300">
                Отмена
              </button>
              <button onClick={handleDeleteProject} className="px-5 py-2 rounded-full bg-red-500 text-white text-xs font-bold">
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TOAST NOTIFICATION ==================== */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-[#161616] border border-[#333333] shadow-2xl text-xs font-medium text-white max-w-sm">
          {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: accentColor }} />}
          {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />}
          {toast.type === 'info' && <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />}
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}


// ============================================================================
// ROOT: загрузка проектов из IndexedDB, затем запуск студии
// ============================================================================

export default function App() {
  const [state, setState] = useState({ status: 'loading', projects: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      requestPersistentStorage();
      try {
        const projects = await loadProjects();
        if (!cancelled) setState({ status: 'ready', projects });
        cleanupUnusedImages().catch(() => {});
      } catch (err) {
        console.error('Load failed', err);
        if (!cancelled) setState({ status: 'ready', projects: null });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="min-h-screen bg-[#0B0B0B] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[#262626] border-t-[#D9FF00] animate-spin" />
          <span className="text-xs text-neutral-500">Загружаем проекты…</span>
        </div>
      </div>
    );
  }

  return <Studio initialProjects={state.projects} />;
}

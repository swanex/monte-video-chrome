// @ts-nocheck
// Хранение проектов в IndexedDB (встроенная база браузера, бесплатно, сотни МБ).
//
// Устройство:
//   - store "meta":   ключ "projects" → массив проектов, где вместо картинок стоят ссылки "idb:<ключ>"
//   - store "images": ключ "<ключ>"    → сама картинка (data:URL)
// Картинки пишутся один раз (ключ = хэш содержимого), поэтому при перетаскивании
// камер на плане сохраняется только небольшой JSON, а не мегабайты картинок.
//
// Слой специально простой: позже его можно заменить на Supabase Storage,
// не трогая остальное приложение (те же loadProjects / saveProjects).

const DB_NAME = 'monte-video-hrom';
const DB_VERSION = 1;
const LEGACY_LS_KEY = 'mv_chrome_projects_v1';
const REF_PREFIX = 'idb:';

let dbPromise = null;
const savedImageKeys = new Set();   // какие картинки уже точно лежат в базе
const keyCache = new Map();         // dataUrl → ключ (чтобы не хэшировать повторно)

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

// FNV-1a по всей строке + длина: быстрый и достаточно надёжный ключ содержимого.
function imageKey(dataUrl) {
  const cached = keyCache.get(dataUrl);
  if (cached) return cached;
  let h = 0x811c9dc5;
  for (let i = 0; i < dataUrl.length; i++) {
    h ^= dataUrl.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const key = `img_${(h >>> 0).toString(36)}_${dataUrl.length.toString(36)}`;
  keyCache.set(dataUrl, key);
  return key;
}

const isDataUrl = (v) => typeof v === 'string' && v.startsWith('data:');
const isRef = (v) => typeof v === 'string' && v.startsWith(REF_PREFIX);

// Глубокий обход: заменяет строки по правилу fn, остальное копирует как есть.
function mapStrings(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map(v => mapStrings(v, fn));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = mapStrings(value[k], fn);
    return out;
  }
  return value;
}

/** Просит браузер не удалять данные сайта при нехватке места (Chrome обычно соглашается). */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {}
  return false;
}

/** Сколько места занято/доступно (в байтах), если браузер это сообщает. */
export async function getStorageEstimate() {
  try {
    if (navigator.storage?.estimate) return await navigator.storage.estimate();
  } catch {}
  return null;
}

/** Загружает проекты. Если в IndexedDB пусто — переносит старые данные из localStorage. */
export async function loadProjects() {
  const db = await openDb();

  let meta = await reqToPromise(db.transaction('meta').objectStore('meta').get('projects'));

  if (!meta) {
    // Миграция со старой версии (localStorage)
    try {
      const legacy = localStorage.getItem(LEGACY_LS_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed) && parsed.length > 0) {
          await saveProjects(parsed);
          localStorage.removeItem(LEGACY_LS_KEY);
          return parsed;
        }
      }
    } catch {}
    return null;
  }

  // Собираем ключи картинок и достаём их одной транзакцией
  const keys = new Set();
  mapStrings(meta, s => { if (isRef(s)) keys.add(s.slice(REF_PREFIX.length)); return s; });

  const images = new Map();
  if (keys.size > 0) {
    const store = db.transaction('images').objectStore('images');
    await Promise.all([...keys].map(async k => {
      const v = await reqToPromise(store.get(k));
      if (v) {
        images.set(k, v);
        savedImageKeys.add(k);
        keyCache.set(v, k);
      }
    }));
  }

  // Подставляем картинки обратно; потерянные ссылки превращаем в null
  return mapStrings(meta, s => {
    if (!isRef(s)) return s;
    return images.get(s.slice(REF_PREFIX.length)) ?? null;
  });
}

/** Сохраняет проекты: новые картинки — в store "images", всё остальное — в "meta". */
export async function saveProjects(projects) {
  const db = await openDb();
  const newImages = new Map();

  const meta = mapStrings(projects, s => {
    if (!isDataUrl(s)) return s;
    const key = imageKey(s);
    if (!savedImageKeys.has(key)) newImages.set(key, s);
    return REF_PREFIX + key;
  });

  const tx = db.transaction(['meta', 'images'], 'readwrite');
  const imgStore = tx.objectStore('images');
  for (const [k, v] of newImages) imgStore.put(v, k);
  tx.objectStore('meta').put(meta, 'projects');
  await txDone(tx);
  for (const k of newImages.keys()) savedImageKeys.add(k);
}

/** Удаляет из базы картинки, на которые больше не ссылается ни один проект. */
export async function cleanupUnusedImages() {
  const db = await openDb();
  // Одна транзакция на оба хранилища: браузер не даст сохранению вклиниться посередине.
  const tx = db.transaction(['meta', 'images'], 'readwrite');
  const meta = await reqToPromise(tx.objectStore('meta').get('projects'));
  if (!meta) return 0;
  const used = new Set();
  mapStrings(meta, s => { if (isRef(s)) used.add(s.slice(REF_PREFIX.length)); return s; });

  const store = tx.objectStore('images');
  const allKeys = await reqToPromise(store.getAllKeys());
  let removed = 0;
  for (const k of allKeys) {
    if (!used.has(k)) {
      store.delete(k);
      savedImageKeys.delete(k);
      removed++;
    }
  }
  await txDone(tx);
  return removed;
}

// Lokale Speicherung in IndexedDB (Fallback: localStorage). Keine Netzwerkzugriffe.

const DB_NAME = 'mayleens-lauftrainer';
const STORE = 'kv';
let dbPromise = null;
let useLocalStorage = false;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('kein IndexedDB')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blockiert'));
  });
  return dbPromise;
}

async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function get(key) {
  if (!useLocalStorage) {
    try { return await idb('readonly', s => s.get(key)); }
    catch (e) { console.warn('IndexedDB nicht nutzbar, nutze localStorage', e); useLocalStorage = true; }
  }
  try { const v = localStorage.getItem('lt:' + key); return v == null ? undefined : JSON.parse(v); }
  catch { return undefined; }
}

export async function set(key, value) {
  if (!useLocalStorage) {
    try { await idb('readwrite', s => s.put(value, key)); return; }
    catch (e) { console.warn('IndexedDB-Schreiben fehlgeschlagen, nutze localStorage', e); useLocalStorage = true; }
  }
  localStorage.setItem('lt:' + key, JSON.stringify(value));
}

export async function del(key) {
  if (!useLocalStorage) {
    try { await idb('readwrite', s => s.delete(key)); return; }
    catch { useLocalStorage = true; }
  }
  localStorage.removeItem('lt:' + key);
}

export async function clearAll() {
  try { await idb('readwrite', s => s.clear()); } catch { /* ignore */ }
  try {
    Object.keys(localStorage).filter(k => k.startsWith('lt:')).forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

export function backendName() {
  return useLocalStorage ? 'localStorage' : 'IndexedDB';
}

/** Bittet den Browser, die Daten dauerhaft zu behalten. */
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* ignore */ }
  return false;
}

export async function isPersisted() {
  try {
    if (navigator.storage && navigator.storage.persisted) return await navigator.storage.persisted();
  } catch { /* ignore */ }
  return false;
}

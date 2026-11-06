// Import von Apple-Watch-Trainings, die HealthFit als FIT- oder GPX-Datei exportiert.
// Reines Einlesen im Browser – keine Datei verlässt das iPad.

const FIT_EPOCH = 631065600; // 1989-12-31T00:00:00Z in Unix-Sekunden

const SPORTS = {
  0: 'generic', 1: 'running', 2: 'cycling', 4: 'fitness', 5: 'swimming', 10: 'training',
  11: 'walking', 15: 'rowing', 17: 'hiking', 19: 'paddling',
};

export const SPORT_LABEL = {
  running: 'Laufen', walking: 'Gehen', hiking: 'Wandern', cycling: 'Radfahren', swimming: 'Schwimmen',
  training: 'Training', fitness: 'Fitness', rowing: 'Rudern', paddling: 'Paddeln', generic: 'Training', other: 'Training',
};

// ---------------------------------------------------------------- FIT
const BASE = { // id → [Größe, Lesefunktion, ungültiger Wert]
  0x00: [1, (v, o) => v.getUint8(o), 0xFF],
  0x01: [1, (v, o) => v.getInt8(o), 0x7F],
  0x02: [1, (v, o) => v.getUint8(o), 0xFF],
  0x03: [2, (v, o, le) => v.getInt16(o, le), 0x7FFF],
  0x04: [2, (v, o, le) => v.getUint16(o, le), 0xFFFF],
  0x05: [4, (v, o, le) => v.getInt32(o, le), 0x7FFFFFFF],
  0x06: [4, (v, o, le) => v.getUint32(o, le), 0xFFFFFFFF],
  0x08: [4, (v, o, le) => v.getFloat32(o, le), null],
  0x09: [8, (v, o, le) => v.getFloat64(o, le), null],
  0x0A: [1, (v, o) => v.getUint8(o), 0x00],
  0x0B: [2, (v, o, le) => v.getUint16(o, le), 0x0000],
  0x0C: [4, (v, o, le) => v.getUint32(o, le), 0x00000000],
  0x0D: [1, (v, o) => v.getUint8(o), 0xFF],
};

export function parseFit(buffer) {
  const v = new DataView(buffer);
  if (v.byteLength < 12) throw new Error('Datei zu kurz');
  const headerSize = v.getUint8(0);
  const dataSize = v.getUint32(4, true);
  const sig = String.fromCharCode(v.getUint8(8), v.getUint8(9), v.getUint8(10), v.getUint8(11));
  if (sig !== '.FIT') throw new Error('Keine FIT-Datei');
  const end = Math.min(headerSize + dataSize, v.byteLength);
  let p = headerSize;
  const defs = {};
  let lastTimestamp = 0;
  const sessions = [], records = [];
  let fileSport = null;

  while (p < end) {
    const h = v.getUint8(p++);
    if (h & 0x80) { // komprimierter Zeitstempel
      const local = (h >> 5) & 0x03;
      const offset = h & 0x1F;
      const def = defs[local];
      if (!def) throw new Error('FIT: unbekannte Definition');
      const msg = readData(v, p, def);
      p += def.size;
      let ts = (lastTimestamp & ~0x1F) + offset;
      if (offset < (lastTimestamp & 0x1F)) ts += 0x20;
      lastTimestamp = ts;
      msg[253] = ts;
      handle(def.global, msg);
      continue;
    }
    const local = h & 0x0F;
    if (h & 0x40) { // Definitionsnachricht
      const hasDev = !!(h & 0x20);
      p += 1; // reserviert
      const le = v.getUint8(p++) === 0;
      const global = v.getUint16(p, le); p += 2;
      const n = v.getUint8(p++);
      const fields = [];
      let size = 0;
      for (let i = 0; i < n; i++) {
        const num = v.getUint8(p), fsize = v.getUint8(p + 1), base = v.getUint8(p + 2) & 0x1F;
        fields.push({ num, size: fsize, base });
        size += fsize; p += 3;
      }
      if (hasDev) {
        const nd = v.getUint8(p++);
        for (let i = 0; i < nd; i++) { size += v.getUint8(p + 1); fields.push({ num: -1, size: v.getUint8(p + 1), base: 0x0D }); p += 3; }
      }
      defs[local] = { le, global, fields, size };
    } else { // Datennachricht
      const def = defs[local];
      if (!def) throw new Error('FIT: Daten ohne Definition');
      const msg = readData(v, p, def);
      p += def.size;
      if (msg[253] != null) lastTimestamp = msg[253];
      handle(def.global, msg);
    }
  }

  function handle(global, m) {
    if (global === 18) sessions.push(m);
    else if (global === 20) records.push(m);
    else if (global === 12 && m[0] != null) fileSport = m[0]; // sport-Nachricht
  }

  const acts = [];
  for (const s of sessions) {
    const start = s[2] ?? s[253];
    if (start == null) continue;
    const a = {
      start: new Date((start + FIT_EPOCH) * 1000).toISOString(),
      sport: SPORTS[s[5] ?? fileSport] || 'other',
      elapsed: s[7] != null ? s[7] / 1000 : null,
      moving: s[8] != null ? s[8] / 1000 : null,
      distance: s[9] != null ? s[9] / 100 : null,
      avgHr: s[16] ?? null,
      maxHr: s[17] ?? null,
      ascent: s[22] ?? null,
    };
    acts.push(a);
  }
  if (!acts.length && records.length) acts.push(fromRecords(records, fileSport));
  return acts.map(normalize);
}

function readData(v, p, def) {
  const m = {};
  let o = p;
  for (const f of def.fields) {
    if (f.num >= 0) {
      const b = BASE[f.base];
      if (b && f.size === b[0]) {
        const val = b[1](v, o, def.le);
        if (b[2] === null ? Number.isFinite(val) : val !== b[2]) m[f.num] = val;
      }
    }
    o += f.size;
  }
  return m;
}

function fromRecords(records, sportCode) {
  const ts = records.filter(r => r[253] != null);
  const first = ts[0], last = ts[ts.length - 1];
  const hrs = records.map(r => r[3]).filter(x => x != null && x > 0);
  const dist = records.map(r => r[5]).filter(x => x != null);
  let ascent = 0, prevAlt = null;
  for (const r of records) {
    const alt = r[2] != null ? r[2] / 5 - 500 : null;
    if (alt != null) { if (prevAlt != null && alt - prevAlt > 0) ascent += alt - prevAlt; prevAlt = alt; }
  }
  return {
    start: new Date((first[253] + FIT_EPOCH) * 1000).toISOString(),
    sport: SPORTS[sportCode] || 'other',
    elapsed: last[253] - first[253],
    moving: null,
    distance: dist.length ? dist[dist.length - 1] / 100 : null,
    avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    maxHr: hrs.length ? Math.max(...hrs) : null,
    ascent: prevAlt != null ? Math.round(ascent) : null,
  };
}

// ---------------------------------------------------------------- GPX
export function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('GPX-Datei ist fehlerhaft');
  const pts = [...doc.getElementsByTagName('trkpt')].map(el => {
    const t = el.getElementsByTagName('time')[0];
    const e = el.getElementsByTagName('ele')[0];
    const hrEl = [...el.getElementsByTagName('*')].find(x => x.localName === 'hr' || x.localName === 'heartrate');
    return {
      lat: parseFloat(el.getAttribute('lat')), lon: parseFloat(el.getAttribute('lon')),
      time: t ? Date.parse(t.textContent.trim()) : NaN,
      ele: e ? parseFloat(e.textContent) : NaN,
      hr: hrEl ? parseInt(hrEl.textContent, 10) : NaN,
    };
  }).filter(x => Number.isFinite(x.time));
  if (pts.length < 2) throw new Error('GPX enthält keine Zeitdaten');
  pts.sort((a, b) => a.time - b.time);
  let dist = 0, moving = 0, ascent = 0, lastEle = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = (Number.isFinite(a.lat) && Number.isFinite(b.lat)) ? haversine(a, b) : 0;
    const dt = (b.time - a.time) / 1000;
    dist += d;
    if (dt > 0 && dt <= 30 && d / dt >= 0.3) moving += dt;
  }
  for (const p of pts) {
    if (!Number.isFinite(p.ele)) continue;
    if (lastEle == null) { lastEle = p.ele; continue; }
    const diff = p.ele - lastEle;
    if (diff >= 2) { ascent += diff; lastEle = p.ele; } else if (diff <= -2) lastEle = p.ele;
  }
  const hrs = pts.map(p => p.hr).filter(x => Number.isFinite(x) && x > 0);
  const typeEl = doc.getElementsByTagName('type')[0];
  const typ = typeEl ? typeEl.textContent.trim().toLowerCase() : '';
  const sport = /run|lauf/.test(typ) ? 'running' : /walk|geh/.test(typ) ? 'walking' : /hik|wander/.test(typ) ? 'hiking'
    : /cycl|bik|rad/.test(typ) ? 'cycling' : 'running';
  const nameEl = doc.querySelector('trk > name') || doc.getElementsByTagName('name')[0];
  return [normalize({
    start: new Date(pts[0].time).toISOString(),
    sport,
    elapsed: (pts[pts.length - 1].time - pts[0].time) / 1000,
    moving: moving || null,
    distance: dist,
    avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    maxHr: hrs.length ? Math.max(...hrs) : null,
    ascent: lastEle != null ? Math.round(ascent) : null,
    name: nameEl ? nameEl.textContent.trim() : null,
  })];
}

function haversine(a, b) {
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ---------------------------------------------------------------- gemeinsam
function normalize(a) {
  const moving = a.moving || a.elapsed || null;
  const out = {
    start: a.start,
    date: localDate(a.start),
    sport: a.sport || 'other',
    name: a.name || null,
    distance: a.distance != null ? Math.round(a.distance) : null,
    moving: moving != null ? Math.round(moving) : null,
    elapsed: a.elapsed != null ? Math.round(a.elapsed) : null,
    ascent: a.ascent != null ? Math.round(a.ascent) : null,
    avgHr: a.avgHr || null,
    maxHr: a.maxHr || null,
  };
  out.pace = (out.distance && out.moving && out.distance > 50) ? Math.round(out.moving / (out.distance / 1000)) : null; // s/km
  out.id = 'aw-' + out.start.slice(0, 16) + '-' + (out.distance ?? 0);
  return out;
}

function localDate(isoString) {
  const d = new Date(isoString);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Liest eine Liste von File-Objekten. Gibt { activities, errors } zurück. */
export async function importFiles(files) {
  const activities = [], errors = [];
  for (const f of files) {
    const name = f.name || 'Datei';
    try {
      const lower = name.toLowerCase();
      let acts;
      if (lower.endsWith('.fit')) acts = parseFit(await f.arrayBuffer());
      else if (lower.endsWith('.gpx')) acts = parseGpx(await f.text());
      else {
        // Unbekannte Endung: am Inhalt erkennen
        const buf = await f.arrayBuffer();
        const head = new Uint8Array(buf.slice(8, 12));
        if (String.fromCharCode(...head) === '.FIT') acts = parseFit(buf);
        else acts = parseGpx(new TextDecoder().decode(buf));
      }
      acts.forEach(a => { a.file = name; activities.push(a); });
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  return { activities, errors };
}

/** Ist das ein Lauf/Gang, der zu einer Laufeinheit passt? */
export function isRunLike(a) {
  return ['running', 'walking', 'hiking', 'generic', 'other', 'training'].includes(a.sport);
}

export function fmtDistance(m) {
  if (m == null) return '–';
  return (m / 1000).toFixed(2).replace('.', ',') + ' km';
}
export function fmtDuration(s) {
  if (s == null) return '–';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')} h` : `${m}:${String(sec).padStart(2, '0')} min`;
}
export function fmtPace(s) {
  if (!s) return '–';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /km`;
}

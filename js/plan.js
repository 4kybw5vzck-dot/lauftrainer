// Trainingsplan: Erzeugung der Einheiten und vorsichtige Anpassung der Laufstufen.
import { WEEK_TEMPLATE, MAX_STAGE } from './data.js';

export const BASE_WEEKS = 10;
export const EXTEND_WEEKS = 4;
export const GAP_DAYS = 14;

// ---------- Datumshilfen (lokale Kalendertage als 'YYYY-MM-DD') ----------
export function toISO(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0); // Mittag: robust gegen Sommerzeit
}
export function addDays(iso, n) {
  const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d);
}
export function diffDays(aIso, bIso) { // a - b in Tagen
  return Math.round((fromISO(aIso) - fromISO(bIso)) / 86400000);
}
export function todayISO() { return toISO(new Date()); }
export function mondayOf(iso) {
  const d = fromISO(iso); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return toISO(d);
}
export function dowOf(iso) { return (fromISO(iso).getDay() + 6) % 7; }

const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export function weekdayLong(iso) { return WD_LONG[dowOf(iso)]; }
export function weekdayShort(iso) { return WD_SHORT[dowOf(iso)]; }
export function fmtDate(iso, withYear = false) {
  const d = fromISO(iso);
  return `${d.getDate()}. ${MONTHS[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
}
export function fmtDateShort(iso) {
  const d = fromISO(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
}

// ---------- Plan ----------
/** Geplante Grundstufe für den n-ten Lauf (0-basiert). 30 Läufe in 10 Wochen, Stufe 18 zum Schluss. */
export function plannedStage(runIndex) {
  return Math.min(MAX_STAGE, 1 + Math.floor(runIndex * (MAX_STAGE - 1) / 26));
}

/** Alle Einheiten des Plans, sortiert nach (ggf. verschobenem) Datum. */
export function buildSessions(state) {
  const p = state.profile;
  if (!p) return [];
  const out = [];
  let runIndex = 0;
  for (let w = 0; w < p.weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const type = WEEK_TEMPLATE[d];
      const id = `w${w + 1}d${d}`;
      const baseDate = addDays(p.startDate, w * 7 + d);
      const st = state.sessions[id] || {};
      const s = {
        id, week: w + 1, dow: d, type, baseDate,
        date: st.date || baseDate,
        moved: !!st.date && st.date !== baseDate,
        status: st.status || 'open',     // open | done | skipped
        feedback: st.feedback || null,   // easy | ok | hard
        note: st.note || '',
        doneAt: st.doneAt || null,
        stage: st.stage || null,
      };
      if (type === 'run') { s.runIndex = runIndex; s.planned = plannedStage(runIndex); runIndex++; }
      if (type === 'strength') s.program = (w % 2 === 0) ? 'A' : 'B';
      out.push(s);
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.dow - b.dow));
  return out;
}

/**
 * Berechnet die Laufstufe jeder Laufeinheit.
 * Regeln:
 *  - „zu anstrengend“: nächster Lauf eine Stufe leichter, folgende Läufe bleiben eine Stufe zurückhaltender.
 *  - „passend“: auf Kurs.
 *  - „leicht“ zweimal hintereinander: Plan legt eine Stufe zu.
 *  - Nächster Lauf höchstens eine Stufe schwerer als der letzte erledigte Lauf.
 *  - Mehr als 14 Tage Pause: letzte Stufe wird wiederholt.
 * Gibt { stages: Map(id → stage), offset, nextRunId } zurück.
 */
export function computeStages(sessions, today = todayISO()) {
  const runs = sessions.filter(s => s.type === 'run');
  const doneRuns = runs.filter(s => s.status === 'done').sort((a, b) => (a.doneAt || a.date).localeCompare(b.doneAt || b.date));
  let offset = 0, easyStreak = 0, lastStage = 0, lastDate = null, forceDown = false;
  for (const r of doneRuns) {
    lastStage = r.stage || r.planned;
    lastDate = (r.doneAt || r.date).slice(0, 10);
    if (r.feedback === 'hard') { offset -= 1; easyStreak = 0; forceDown = true; }
    else if (r.feedback === 'easy') {
      forceDown = false; easyStreak += 1;
      if (easyStreak >= 2) { offset += 1; easyStreak = 0; }
    } else { forceDown = false; easyStreak = 0; }
  }
  const stages = new Map();
  for (const r of doneRuns) stages.set(r.id, r.stage || r.planned);
  for (const r of runs.filter(s => s.status === 'skipped')) stages.set(r.id, r.stage || null);

  const open = runs.filter(s => s.status === 'open' && s.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const missed = runs.filter(s => s.status === 'open' && s.date < today);
  let prev = lastStage;
  let first = true;
  let nextRunId = null;
  for (const r of open) {
    let st;
    if (first) {
      if (lastStage === 0) st = 1;
      else if (forceDown) st = Math.max(1, lastStage - 1);
      else if (lastDate && diffDays(today, lastDate) > GAP_DAYS) st = lastStage;
      else st = Math.min(r.planned + offset, lastStage + 1);
      st = Math.max(st, lastStage === 0 ? 1 : Math.max(1, lastStage - 1));
      first = false;
      nextRunId = r.id;
    } else {
      st = Math.min(r.planned + offset, prev + 1);
      st = Math.max(st, Math.max(1, prev - 1), 1);
    }
    st = Math.min(Math.max(st, 1), MAX_STAGE);
    stages.set(r.id, st);
    prev = st;
  }
  // Verpasste (vergangene, offene) Läufe zeigen die Stufe, die jetzt dran wäre –
  // falls sie nachträglich als erledigt markiert werden.
  const nowStage = nextRunId ? stages.get(nextRunId)
    : (lastStage === 0 ? 1 : forceDown ? Math.max(1, lastStage - 1) : Math.min(lastStage + 1, MAX_STAGE));
  for (const r of missed) stages.set(r.id, nowStage);
  return { stages, offset, nextRunId };
}

export function currentWeek(state, today = todayISO()) {
  if (!state.profile) return 0;
  const w = Math.floor(diffDays(today, state.profile.startDate) / 7) + 1;
  return w;
}

export function progress(sessions) {
  const train = sessions.filter(s => s.type !== 'rest');
  const done = train.filter(s => s.status === 'done').length;
  const skipped = train.filter(s => s.status === 'skipped').length;
  const runsDone = sessions.filter(s => s.type === 'run' && s.status === 'done').length;
  const runsTotal = sessions.filter(s => s.type === 'run').length;
  return { total: train.length, done, skipped, runsDone, runsTotal };
}

/** Nächste offene Trainingseinheit ab heute (Ruhetage ausgenommen). */
export function nextSession(sessions, today = todayISO()) {
  return sessions.find(s => s.type !== 'rest' && s.status === 'open' && s.date >= today) || null;
}

export function sessionsOfWeek(sessions, week) {
  return sessions.filter(s => s.week === week).sort((a, b) => a.dow - b.dow);
}

/** Alle Einheiten an einem Kalendertag (nach Verschiebungen). */
export function sessionsOnDate(sessions, iso) {
  return sessions.filter(s => s.date === iso);
}

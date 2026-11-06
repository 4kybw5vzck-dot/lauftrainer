// Mayleens Lauftrainer – iPad-Web-App
import * as db from './db.js';
import {
  VERSION, TYPE_INFO, AREAS, EXERCISES, exerciseById, STRENGTH_PROGRAMS, YOGA_PROGRAM, QUOTES,
  stageLabel, stageSegments, stageTotalMin, stageRunMin, MAX_STAGE, stagePhase, stageIsGoal, LONG_RUN_DOW,
} from './data.js';
import {
  BASE_WEEKS, EXTEND_WEEKS, buildSessions, computeStages, currentWeek, progress, nextSession,
  todayISO, addDays, mondayOf, diffDays, fmtDate, fmtDateShort, weekdayLong, weekdayShort,
} from './plan.js';
import { importFiles, isRunLike, SPORT_LABEL, fmtDistance, fmtDuration, fmtPace } from './importer.js';
import { createTimer, SEG_LABEL, hasGermanVoice } from './timer.js';

const SCHEMA = 1;
const MAX_SNAPSHOTS = 10;
const $main = () => document.getElementById('main');

let state = null;      // gesamter Datenstand
let activeTimer = null;
let timerPrefs = { voice: true, sound: true };

// ------------------------------------------------------------ Hilfen
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowISO = () => new Date().toISOString();
function emptyState() {
  return { schema: SCHEMA, profile: null, sessions: {}, activities: [], videos: {}, lastBackupAt: null, lastImportAt: null };
}
async function save() { await db.set('state', state); }
function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}
function greeting() {
  const h = new Date().getHours();
  return h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : h < 22 ? 'Guten Abend' : 'Hallo';
}
function quoteOfDay() {
  const i = ((diffDays(todayISO(), '2026-01-01') % QUOTES.length) + QUOTES.length) % QUOTES.length;
  return QUOTES[i].replace('{name}', state.profile?.name || 'du');
}
function plan() {
  const sessions = buildSessions(state);
  const { stages, nextRunId } = computeStages(sessions, todayISO());
  return { sessions, stages, nextRunId };
}
function activitiesByDate() {
  const m = new Map();
  for (const a of state.activities) {
    if (!m.has(a.date)) m.set(a.date, []);
    m.get(a.date).push(a);
  }
  return m;
}
function sessionTitle(s) { return TYPE_INFO[s.type].title; }
/** Langer Lauf? (Samstag – wirkt erst in der Aufbau-Phase ab Stufe 19) */
function isLong(s) { return s.type === 'run' && s.dow === LONG_RUN_DOW; }
function phaseText(st) { const ph = stagePhase(st); return ph ? `Aufbau ${ph}` : 'Grundlagen'; }
function sessionSubtitle(s, stages) {
  if (s.type === 'run') {
    const st = stages.get(s.id);
    return st ? `Stufe ${st}: ${stageLabel(st, isLong(s))}` : 'Laufeinheit';
  }
  if (s.type === 'strength') return `ca. 20 Minuten · Programm ${s.program}`;
  if (s.type === 'yoga') return 'ca. 20 Minuten';
  return 'Erholung – optional ein lockerer Spaziergang';
}
const FEEDBACK = {
  easy: { label: 'Leicht', icon: '😊' },
  ok: { label: 'Passend', icon: '👍' },
  hard: { label: 'Zu anstrengend', icon: '😮‍💨' },
};
function statusBadge(s) {
  if (s.type === 'rest') return '';
  if (s.status === 'done') return `<span class="badge done">✓ Erledigt${s.feedback ? ' · ' + FEEDBACK[s.feedback].label : ''}</span>`;
  if (s.status === 'skipped') return '<span class="badge skipped">Übersprungen</span>';
  if (s.date < todayISO()) return '<span class="badge missed">Offen</span>';
  if (s.date === todayISO()) return '<span class="badge today">Heute</span>';
  return '';
}

// ------------------------------------------------------------ Toast & Dialog
function toast(msg, ms = 2800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function modal(html, mount) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  root.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  mount && mount(wrap.querySelector('.modal'), close);
  const first = wrap.querySelector('input, textarea, button:not([data-close])');
  if (first && first.tagName !== 'BUTTON') setTimeout(() => first.focus(), 50);
  return close;
}
function confirmDialog(title, text, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    modal(`<h2>${esc(title)}</h2><p>${text}</p>
      <div class="actions"><button class="btn ghost" data-close>Abbrechen</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" id="dlg-ok">${esc(okLabel)}</button></div>`,
      (el, close) => {
        el.querySelector('#dlg-ok').onclick = () => { close(); resolve(true); };
        el.closest('.modal-backdrop').addEventListener('click', e => {
          if (e.target.classList.contains('modal-backdrop') || e.target.closest('[data-close]')) resolve(false);
        });
      });
  });
}

// ------------------------------------------------------------ Sicherungen
function backupPayload() {
  return JSON.stringify({ app: 'mayleens-lauftrainer', version: VERSION, createdAt: nowISO(), data: state }, null, 1);
}
function backupFileName() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `Lauftrainer-Sicherung-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}.json`;
}
async function getSnapshots() { return (await db.get('snapshots')) || []; }
async function addSnapshot(reason) {
  const snaps = await getSnapshots();
  snaps.unshift({ id: 's' + Date.now(), createdAt: nowISO(), reason, data: JSON.parse(JSON.stringify(state)) });
  await db.set('snapshots', snaps.slice(0, MAX_SNAPSHOTS));
}
async function shareOrDownload(filename, text) {
  const file = new File([text], filename, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'aborted'; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
function validateBackup(obj) {
  const data = obj && obj.app === 'mayleens-lauftrainer' ? obj.data : obj;
  if (!data || typeof data !== 'object' || !('sessions' in data) || !('profile' in data)) throw new Error('Das ist keine Lauftrainer-Sicherung.');
  return { ...emptyState(), ...data, schema: SCHEMA };
}
async function restoreData(data, reason = 'Vor dem Wiederherstellen') {
  if (state.profile) await addSnapshot(reason);
  state = validateBackup(data);
  await save();
}

// ------------------------------------------------------------ Navigation
const NAV = [
  ['uebersicht', '🏠', 'Übersicht'],
  ['plan', '📅', 'Plan'],
  ['uebungen', '🤸‍♀️', 'Übungen'],
  ['verlauf', '📈', 'Verlauf'],
  ['einstellungen', '⚙️', 'Einstellungen'],
];
function renderNav(route) {
  const nav = document.getElementById('nav');
  if (!state.profile) { nav.innerHTML = ''; document.body.classList.add('no-nav'); return; }
  document.body.classList.remove('no-nav');
  const top = route.split('/')[0];
  const active = { einheit: 'plan', timer: 'plan', uebung: 'uebungen' }[top] || top;
  nav.innerHTML = `<div class="brand"><span class="brand-logo">👟</span><span>Mayleens<br><b>Lauftrainer</b><br><small class="brand-by">Stolli</small></span></div>` +
    NAV.map(([id, icon, label]) =>
      `<a href="#/${id}" class="nav-item ${active === id ? 'active' : ''}"><span class="nav-icon">${icon}</span><span class="nav-label">${label}</span></a>`).join('');
}

function route() {
  return (location.hash.replace(/^#\/?/, '') || 'uebersicht');
}

async function render() {
  if (activeTimer && !route().startsWith('timer/')) { activeTimer.stop(); activeTimer = null; }
  const r = route();
  renderNav(r);
  const main = $main();
  if (!state.profile) { main.innerHTML = viewWelcome(); bindWelcome(); return; }
  const [view, arg] = r.split('/');
  let html = '';
  switch (view) {
    case 'plan': html = viewPlan(arg); break;
    case 'einheit': html = viewSession(arg); break;
    case 'timer': html = viewTimer(arg); break;
    case 'uebungen': html = viewExercises(arg); break;
    case 'uebung': html = viewExercise(arg); break;
    case 'verlauf': html = viewHistory(); break;
    case 'einstellungen': html = await viewSettings(arg || 'profil'); break;
    default: html = viewOverview();
  }
  main.innerHTML = html;
  main.scrollTop = 0; window.scrollTo(0, 0);
  if (view === 'timer') mountTimer(arg);
  if (view === 'einstellungen') bindSettings(arg || 'profil');
}

// ------------------------------------------------------------ Willkommen
function viewWelcome() {
  const today = todayISO();
  const thisMon = mondayOf(today), nextMon = addDays(thisMon, 7);
  return `
  <section class="welcome">
    <div class="welcome-card">
      <div class="welcome-hero">👟</div>
      <p class="welcome-brand">Mayleens Lauftrainer<br><small>Stolli</small></p>
      <h1>Willkommen bei deinem Lauftrainer!</h1>
      <p class="lead">Ich bin dein freundlicher Trainer. Zusammen fangen wir ganz entspannt mit dem Laufen an – mit Gehpausen, kleinen Kraft- und Yoga-Einheiten und genug Erholung.</p>
      ${isStandalone() ? '' : `<div class="hint">📲 <b>Tipp:</b> Lege den Lauftrainer zuerst auf den Home-Bildschirm (in Safari auf <b>Teilen</b> ⬆︎ › <b>Zum Home-Bildschirm</b>) und richte ihn dann dort ein. Nur so bleiben deine Daten dauerhaft gespeichert.</div>`}
      <form id="welcome-form" class="form">
        <label>Wie heißt du?
          <input id="w-name" type="text" autocomplete="given-name" maxlength="40" required placeholder="Dein Vorname">
        </label>
        <fieldset>
          <legend>Wann möchtest du starten?</legend>
          <label class="radio"><input type="radio" name="start" value="${thisMon}" ${dowIsEarly(today) ? 'checked' : ''}> Diese Woche (ab ${fmtDate(thisMon)})</label>
          <label class="radio"><input type="radio" name="start" value="${nextMon}" ${dowIsEarly(today) ? '' : 'checked'}> Nächste Woche (ab ${fmtDate(nextMon)})</label>
          <label class="radio"><input type="radio" name="start" value="custom"> Anderes Datum: <input id="w-date" type="date" value="${nextMon}"></label>
        </fieldset>
        <p class="small muted">Der Plan beginnt immer mit dem Montag der gewählten Woche und dauert zehn Wochen.</p>
        <button class="btn primary big" type="submit">Los geht’s!</button>
      </form>
      <p class="small center"><button class="linkbtn" id="w-restore">Ich habe eine Sicherung – Daten wiederherstellen</button></p>
      <p class="small muted center">Der Lauftrainer ist kein medizinisches Produkt. Bei Schmerzen oder gesundheitlichen Fragen sprich bitte mit deiner Ärztin oder deinem Arzt.</p>
    </div>
  </section>`;
}
function dowIsEarly(iso) { const d = new Date().getDay(); return d === 1 || d === 2; } // Mo/Di: diese Woche vorschlagen
function bindWelcome() {
  const f = document.getElementById('welcome-form');
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('w-name').value.trim();
    if (!name) return;
    let start = f.querySelector('input[name=start]:checked').value;
    if (start === 'custom') start = document.getElementById('w-date').value || todayISO();
    state.profile = { name, startDate: mondayOf(start), weeks: BASE_WEEKS, createdAt: nowISO() };
    await save();
    db.requestPersist();
    location.hash = '#/uebersicht';
    render();
    toast(`Schön, dass du da bist, ${name}!`);
  });
  document.getElementById('w-restore').onclick = () => pickBackupFile();
}

// ------------------------------------------------------------ Übersicht
function viewOverview() {
  const { sessions, stages } = plan();
  const today = todayISO();
  const p = progress(sessions);
  const week = currentWeek(state, today);
  const weeks = state.profile.weeks;
  const next = nextSession(sessions, today);
  const todays = sessions.filter(s => s.date === today);
  const showWeek = Math.min(Math.max(week, 1), weeks);
  const wkStart = addDays(state.profile.startDate, (showWeek - 1) * 7);
  const wkDays = [...Array(7)].map((_, i) => addDays(wkStart, i));
  const actsByDate = activitiesByDate();
  const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
  const lastAct = [...state.activities].sort((a, b) => b.start.localeCompare(a.start))[0];
  const neverBackedUp = !state.lastBackupAt && p.done >= 3;
  const needBackup = neverBackedUp || (state.lastBackupAt && p.done > 0 && diffDays(today, state.lastBackupAt.slice(0, 10)) > 14);

  let status;
  if (week < 1) status = `Dein Plan startet am <b>${fmtDate(state.profile.startDate)}</b>. Vorfreude ist die schönste Freude!`;
  else if (week > weeks) status = `Du hast alle ${weeks} Wochen hinter dir – großartig! Unter Einstellungen kannst du den Plan verlängern oder neu starten.`;
  else status = `Woche <b>${week}</b> von ${weeks}`;

  const todayRest = todays.length && todays.every(s => s.type === 'rest');

  return `
  <header class="page-head">
    <h1>${greeting()}, ${esc(state.profile.name)}!</h1>
    <p class="muted">${weekdayLong(today)}, ${fmtDate(today, true)} · ${status}</p>
  </header>
  ${isStandalone() ? '' : `<div class="hint">📲 Für dauerhafte Speicherung: In Safari auf <b>Teilen</b> › <b>Zum Home-Bildschirm</b> und den Lauftrainer von dort öffnen.</div>`}
  ${needBackup ? `<div class="hint warn">💾 ${neverBackedUp ? 'Du hast noch keine Sicherung angelegt.' : 'Deine letzte Sicherung ist schon eine Weile her.'} <a href="#/einstellungen/daten">Jetzt sichern</a></div>` : ''}
  <div class="grid two">
    <article class="card quote">
      <div class="quote-mark">“</div>
      <p>${esc(quoteOfDay())}</p>
      <span class="small muted">Spruch des Tages von deinem Trainer</span>
    </article>
    <article class="card next">
      <h2>${todayRest ? 'Heute ist Ruhetag 🌿' : 'Deine nächste Einheit'}</h2>
      ${next ? `
        <a class="session-row big ${TYPE_INFO[next.type].css}" href="#/einheit/${next.id}">
          <span class="s-icon">${TYPE_INFO[next.type].icon}</span>
          <span class="s-main"><b>${sessionTitle(next)}</b><span class="small">${next.date === today ? 'Heute' : weekdayLong(next.date) + ', ' + fmtDate(next.date)}</span>
          <span class="small muted">${esc(sessionSubtitle(next, stages))}</span></span>
          <span class="chev">›</span>
        </a>
        ${next.type === 'run' ? `<a class="btn primary" href="#/timer/${next.id}">⏱ Intervall-Timer öffnen</a>` : ''}
      ` : `<p>Keine offenen Einheiten mehr. 🎉</p>`}
    </article>
  </div>
  <div class="grid two">
    <article class="card">
      <h2>Dein Fortschritt</h2>
      <div class="progress-ring-row">
        <div class="ring" data-pct="${pct}"><svg viewBox="0 0 36 36"><path class="ring-bg" d="M18 2.5a15.5 15.5 0 1 1 0 31a15.5 15.5 0 1 1 0-31"/><path class="ring-fg${pct === 0 ? ' zero' : ''}" stroke-dasharray="${pct}, 100" d="M18 2.5a15.5 15.5 0 1 1 0 31a15.5 15.5 0 1 1 0-31"/></svg><span>${pct}%</span></div>
        <ul class="stats">
          <li><b>${p.done}</b> von ${p.total} Einheiten erledigt</li>
          <li><b>${p.runsDone}</b> von ${p.runsTotal} Läufen</li>
          <li><b>${p.skipped}</b> übersprungen – völlig okay</li>
        </ul>
      </div>
    </article>
    <article class="card">
      <h2>Apple Watch</h2>
      ${lastAct ? `
        <p class="small muted">Zuletzt importiert:</p>
        <div class="act-row"><span class="s-icon">⌚</span><span><b>${SPORT_LABEL[lastAct.sport] || 'Training'}</b> · ${weekdayShort(lastAct.date)}, ${fmtDate(lastAct.date)}<br>
        <span class="small">${fmtDistance(lastAct.distance)} · ${fmtDuration(lastAct.moving)} · ${fmtPace(lastAct.pace)}${lastAct.avgHr ? ' · ⌀ ' + lastAct.avgHr + ' bpm' : ''}</span></span></div>`
        : `<p class="small muted">Noch keine Trainings importiert.</p>`}
      <button class="btn" data-action="import">⌚ Trainings importieren</button>
    </article>
  </div>
  ${week >= 1 && week <= weeks ? `
  <article class="card">
    <h2>Diese Woche <span class="muted small">(Woche ${showWeek})</span></h2>
    <div class="week-strip">${wkDays.map(d => dayTile(d, sessions, stages, actsByDate)).join('')}</div>
  </article>` : ''}
  `;
}
function dayTile(date, sessions, stages, actsByDate) {
  const today = todayISO();
  const list = sessions.filter(x => x.date === date);
  // Trainingseinheit vor Ruhetag anzeigen
  const s = list.find(x => x.type !== 'rest') || list[0];
  const head = `<span class="d-wd">${weekdayShort(date)}</span><span class="d-date">${fmtDateShort(date)}</span>`;
  if (!s) return `<a class="day-tile t-rest ${date === today ? 'is-today' : ''}" href="#/plan">${head}<span class="d-icon">·</span><span class="d-label">frei</span></a>`;
  const ti = TYPE_INFO[s.type];
  const watch = list.some(x => x.type === 'run') && (actsByDate.get(date) || []).some(isRunLike);
  const extra = list.filter(x => x.type !== 'rest').length - 1;
  const cls = ['day-tile', ti.css, date === today ? 'is-today' : '', s.status].join(' ');
  return `<a class="${cls}" href="#/einheit/${s.id}">${head}
    <span class="d-icon">${s.status === 'done' ? '✅' : s.status === 'skipped' ? '⏭️' : ti.icon}</span>
    <span class="d-label">${ti.short}${s.type === 'run' && stages.get(s.id) ? ' · St. ' + stages.get(s.id) : ''}${extra > 0 ? ` +${extra}` : ''}</span>
    ${watch ? '<span class="d-watch" title="Apple-Watch-Training gefunden">⌚</span>' : ''}
  </a>`;
}

// ------------------------------------------------------------ Plan
function viewPlan(arg) {
  const { sessions, stages } = plan();
  const weeks = state.profile.weeks;
  const cw = Math.min(Math.max(currentWeek(state), 1), weeks);
  const week = Math.min(Math.max(parseInt(arg, 10) || cw, 1), weeks);
  const actsByDate = activitiesByDate();
  // Woche anhand des Datums anzeigen (inkl. hineinverschobener Einheiten)
  const weekStart = addDays(state.profile.startDate, (week - 1) * 7);
  const days = [...Array(7)].map((_, i) => addDays(weekStart, i));
  return `
  <header class="page-head">
    <h1>Trainingsplan</h1>
    <p class="muted">${weeks} Wochen ab ${fmtDate(state.profile.startDate, true)} · dreimal Laufen & Gehen, Kraft, Yoga und zwei Ruhetage pro Woche</p>
  </header>
  <nav class="chips week-chips">
    ${[...Array(weeks)].map((_, i) => `<a href="#/plan/${i + 1}" class="chip ${i + 1 === week ? 'active' : ''} ${i + 1 === cw ? 'current' : ''}">W${i + 1}</a>`).join('')}
  </nav>
  <article class="card">
    <h2>Woche ${week} <span class="muted small">${fmtDate(days[0])} – ${fmtDate(days[6])}</span></h2>
    <div class="day-list">
    ${days.map(d => {
      const list = sessions.filter(s => s.date === d);
      const watch = (actsByDate.get(d) || []).filter(isRunLike);
      return `<div class="day ${d === todayISO() ? 'is-today' : ''}">
        <div class="day-head"><b>${weekdayLong(d)}</b> <span class="muted">${fmtDate(d)}</span></div>
        ${list.length ? list.map(s => `
          <a class="session-row ${TYPE_INFO[s.type].css} ${s.status}" href="#/einheit/${s.id}">
            <span class="s-icon">${TYPE_INFO[s.type].icon}</span>
            <span class="s-main"><b>${sessionTitle(s)}</b>${s.moved ? ' <span class="small muted">(verschoben)</span>' : ''}
              <span class="small muted">${esc(sessionSubtitle(s, stages))}</span></span>
            ${statusBadge(s)}
            <span class="chev">›</span>
          </a>`).join('') : '<div class="muted small pad">Keine Einheit (verschoben)</div>'}
        ${watch.length && list.some(s => s.type === 'run') ? `<div class="watch-note">⌚ Apple Watch: ${watch.map(a => `${SPORT_LABEL[a.sport] || 'Training'} ${fmtDistance(a.distance)} in ${fmtDuration(a.moving)}`).join(', ')}</div>` : ''}
      </div>`;
    }).join('')}
    </div>
  </article>`;
}

// ------------------------------------------------------------ Einheit
function findSession(id) {
  const { sessions, stages, nextRunId } = plan();
  return { s: sessions.find(x => x.id === id), sessions, stages, nextRunId };
}
function viewSession(id) {
  const { s, stages } = findSession(id);
  if (!s) return `<p>Diese Einheit gibt es nicht. <a href="#/plan">Zum Plan</a></p>`;
  const ti = TYPE_INFO[s.type];
  const watch = (activitiesByDate().get(s.date) || []);
  let body = '';
  if (s.type === 'run') {
    const st = stages.get(s.id) || s.planned;
    const lg = isLong(s);
    const segs = stageSegments(st, lg);
    const goal = stageIsGoal(st, lg);
    body = `
      <div class="run-summary">
        <div class="stage-badge">Stufe<br><b>${st}</b><span>von ${MAX_STAGE}</span></div>
        <div><p class="small muted">${phaseText(st)}</p><h3>${esc(stageLabel(st, lg))}</h3>
        <p class="muted">Insgesamt ca. ${stageTotalMin(st, lg)} Minuten, davon ${String(stageRunMin(st, lg)).replace('.', ',')} Minuten laufen.</p></div>
      </div>
      <ol class="seg-list">
        ${segs.map(g => `<li class="seg ${g.type}"><span>${SEG_LABEL[g.type]}</span><span>${String(g.min).replace('.', ',')} Min.</span></li>`).join('')}
      </ol>
      ${goal ? `<p class="hint">🎯 <b>Heute ist dein Ziellauf: ${stagePhase(st)}!</b> Die Minuten sind nur ein Richtwert – lauf ganz gemütlich, bis deine Apple Watch ${stagePhase(st)} anzeigt. Bist du schon früher dort: super, dann darfst du aufhören. Kurze Gehpausen sind völlig in Ordnung.</p>` : ''}
      <p class="small muted">Lauf so langsam, dass du dich noch unterhalten könntest. Gehpausen gehören dazu!</p>
      ${s.status === 'open' ? `<a class="btn primary big" href="#/timer/${s.id}">⏱ Intervall-Timer starten</a>` : ''}`;
  } else if (s.type === 'strength' || s.type === 'yoga') {
    const ids = s.type === 'strength' ? STRENGTH_PROGRAMS[s.program] : YOGA_PROGRAM;
    body = `
      <p class="muted">${s.type === 'strength'
        ? 'Mach die Übungen nacheinander. Wenn du magst, mach danach eine zweite Runde. Zwischen den Übungen ruhig kurz verschnaufen.'
        : 'Nimm dir Zeit, atme ruhig und geh nur so weit, wie es sich gut anfühlt.'}</p>
      <div class="ex-list">${ids.map(eid => exerciseCard(exerciseById(eid), true)).join('')}</div>`;
  } else {
    body = `<p>Heute darf sich dein Körper erholen. In der Ruhe wirst du stärker!</p>
      <p class="muted">Wenn du Lust hast: ein lockerer Spaziergang an der frischen Luft tut gut.</p>`;
  }
  return `
  <a class="back" href="#/plan/${s.week}">‹ Zurück zum Plan</a>
  <header class="page-head session-head ${ti.css}">
    <span class="s-icon big">${ti.icon}</span>
    <div><h1>${ti.title}</h1>
    <p class="muted">${weekdayLong(s.date)}, ${fmtDate(s.date, true)} · Woche ${s.week}${s.moved ? ` · verschoben vom ${fmtDate(s.baseDate)}` : ''}</p>
    ${statusBadge(s)}</div>
  </header>
  <article class="card">${body}</article>
  ${watch.length ? `<article class="card"><h2>⌚ Apple Watch an diesem Tag</h2>${watch.map(activityRow).join('')}
    ${s.status === 'open' && s.type === 'run' ? '<p class="small muted">Passt das zu dieser Einheit? Dann hak sie unten ab – das entscheidest du.</p>' : ''}</article>` : ''}
  ${s.status === 'done' ? `<article class="card"><h2>Deine Rückmeldung</h2>
     <p>${s.feedback ? FEEDBACK[s.feedback].icon + ' ' + FEEDBACK[s.feedback].label : '–'}${s.type === 'run' && s.stage ? ` · gelaufen auf Stufe ${s.stage}` : ''}</p>
     ${s.note ? `<p class="note">„${esc(s.note)}“</p>` : ''}
     <button class="btn ghost" data-action="edit-note" data-id="${s.id}">✏️ Notiz bearbeiten</button></article>` : ''}
  ${s.type !== 'rest' ? `
  <div class="action-bar">
    ${s.status === 'open' ? `
      <button class="btn primary" data-action="done" data-id="${s.id}">✓ Erledigt</button>
      <button class="btn" data-action="skip" data-id="${s.id}">Überspringen</button>
      <button class="btn" data-action="move" data-id="${s.id}">Verschieben</button>`
    : `<button class="btn ghost" data-action="reset" data-id="${s.id}">↺ Zurücksetzen</button>`}
  </div>` : `
  <div class="action-bar"><button class="btn" data-action="move" data-id="${s.id}">Ruhetag verschieben</button></div>`}
  `;
}
function exerciseCard(e, compact = false) {
  return `<a class="ex-card area-${e.area}" href="#/uebung/${e.id}">
    <span class="ex-area">${AREAS[e.area]}</span>
    <b>${esc(e.name)}</b>
    <span class="small muted">${esc(e.dose)}</span>
    ${compact ? '' : `<span class="small">${esc(e.steps[0])}</span>`}
    ${state.videos[e.id] ? '<span class="ex-video">▶︎ Video</span>' : ''}
  </a>`;
}
function activityRow(a) {
  return `<div class="act-row"><span class="s-icon">⌚</span><span>
    <b>${esc(a.name || SPORT_LABEL[a.sport] || 'Training')}</b> · ${weekdayShort(a.date)}, ${fmtDate(a.date)}, ${new Date(a.start).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr<br>
    <span class="small">${fmtDistance(a.distance)} · Bewegungszeit ${fmtDuration(a.moving)} · ${fmtPace(a.pace)}${a.ascent != null ? ' · ↑ ' + a.ascent + ' m' : ''}${a.avgHr ? ' · ⌀ ' + a.avgHr + ' bpm' : ''}${a.maxHr ? ' · max ' + a.maxHr + ' bpm' : ''}</span>
  </span></div>`;
}

async function setSession(id, patch) {
  const cur = state.sessions[id] || {};
  const next = { ...cur, ...patch };
  Object.keys(next).forEach(k => next[k] == null && delete next[k]);
  if (Object.keys(next).length) state.sessions[id] = next; else delete state.sessions[id];
  await save();
}

function feedbackDialog(id) {
  const { s, stages } = findSession(id);
  modal(`
    <h2>Wie hat es sich angefühlt?</h2>
    <p class="muted">${sessionTitle(s)} · ${weekdayLong(s.date)}, ${fmtDate(s.date)}</p>
    <div class="fb-buttons">
      ${Object.entries(FEEDBACK).map(([k, f]) => `<button class="fb-btn fb-${k}" data-fb="${k}"><span>${f.icon}</span>${f.label}</button>`).join('')}
    </div>
    <label class="mt">Notiz (optional)<textarea id="fb-note" rows="3" maxlength="500" placeholder="z. B. schöne Runde am See, Wade etwas fest …"></textarea></label>
    <div class="actions"><button class="btn ghost" data-close>Abbrechen</button></div>
  `, (el, close) => {
    el.querySelectorAll('[data-fb]').forEach(b => b.onclick = async () => {
      const today = todayISO();
      await setSession(id, {
        status: 'done', feedback: b.dataset.fb, note: el.querySelector('#fb-note').value.trim() || null,
        doneAt: s.date > today ? today : s.date,
        stage: s.type === 'run' ? (stages.get(id) || s.planned) : null,
      });
      close();
      render();
      const msg = b.dataset.fb === 'hard' ? 'Danke! Der nächste Lauf wird etwas leichter.'
        : b.dataset.fb === 'easy' ? 'Super! Bleib dran – der Plan legt bald etwas zu.' : 'Klasse gemacht! 🎉';
      toast(msg);
    });
  });
}
function moveDialog(id) {
  const { s } = findSession(id);
  const today = todayISO();
  const from = s.date < today ? today : s.date;
  const opts = [...Array(8)].map((_, i) => addDays(from, i)).filter(d => d !== s.date);
  modal(`
    <h2>Einheit verschieben</h2>
    <p class="muted">${sessionTitle(s)} – auf welchen Tag?</p>
    <div class="move-grid">${opts.slice(0, 7).map(d => `<button class="btn" data-day="${d}">${weekdayShort(d)}, ${fmtDateShort(d)}</button>`).join('')}</div>
    <label class="mt">Oder ein Datum wählen <input type="date" id="mv-date" min="${today}" value="${opts[0]}"></label>
    ${s.moved ? `<p><button class="linkbtn" data-day="${s.baseDate}">Zurück auf den ursprünglichen Tag (${fmtDate(s.baseDate)})</button></p>` : ''}
    <div class="actions"><button class="btn ghost" data-close>Abbrechen</button><button class="btn primary" id="mv-ok">Verschieben</button></div>
  `, (el, close) => {
    const go = async d => {
      if (!d) return;
      await setSession(id, { date: d === s.baseDate ? null : d });
      close(); render(); toast(`Verschoben auf ${weekdayLong(d)}, ${fmtDate(d)}.`);
    };
    el.querySelectorAll('[data-day]').forEach(b => b.onclick = () => go(b.dataset.day));
    el.querySelector('#mv-ok').onclick = () => go(el.querySelector('#mv-date').value);
  });
}
function noteDialog(id) {
  const cur = state.sessions[id]?.note || '';
  modal(`<h2>Notiz</h2><textarea id="n-text" rows="4" maxlength="500">${esc(cur)}</textarea>
    <div class="actions"><button class="btn ghost" data-close>Abbrechen</button><button class="btn primary" id="n-ok">Speichern</button></div>`,
  (el, close) => {
    el.querySelector('#n-ok').onclick = async () => {
      await setSession(id, { note: el.querySelector('#n-text').value.trim() || null });
      close(); render();
    };
  });
}

// ------------------------------------------------------------ Timer
function viewTimer(id) {
  const { s, stages } = findSession(id);
  if (!s || s.type !== 'run') return `<p>Kein Lauf gefunden. <a href="#/plan">Zum Plan</a></p>`;
  const st = stages.get(s.id) || s.planned;
  return `
  <a class="back" href="#/einheit/${s.id}">‹ Zurück zur Einheit</a>
  <section class="timer" id="timer">
    <div class="timer-top">
      <span class="muted">Stufe ${st} · ${esc(stageLabel(st, isLong(s)))}</span>
    </div>
    <div class="timer-seg" id="t-seg">Bereit?</div>
    <div class="timer-big" id="t-big">00:00</div>
    <div class="timer-next muted" id="t-next"></div>
    <div class="bar"><div class="bar-fill" id="t-bar"></div></div>
    <div class="timer-meta"><span id="t-el">0:00</span><span id="t-rem"></span></div>
    <div class="timer-controls">
      <button class="btn primary huge" id="t-start">▶︎ Start</button>
      <button class="btn huge" id="t-skip" title="Abschnitt überspringen">⏭</button>
    </div>
    <div class="timer-opts">
      <label class="switch"><input type="checkbox" id="t-voice" ${timerPrefs.voice ? 'checked' : ''}> Ansage</label>
      <label class="switch"><input type="checkbox" id="t-sound" ${timerPrefs.sound ? 'checked' : ''}> Signalton</label>
    </div>
    <p class="small muted center" id="t-hint">Der Bildschirm bleibt während des Timers an. Bitte lass die App geöffnet – wird das iPad gesperrt, pausieren Ton und Ansage.</p>
    <ol class="seg-list compact" id="t-list"></ol>
  </section>`;
}
function mountTimer(id) {
  const { s, stages } = findSession(id);
  if (!s || s.type !== 'run') return;
  const st = stages.get(s.id) || s.planned;
  const segs = stageSegments(st, isLong(s));
  const $ = sel => document.querySelector(sel);
  const list = $('#t-list');
  list.innerHTML = segs.map((g, i) => `<li class="seg ${g.type}" data-i="${i}"><span>${SEG_LABEL[g.type]}</span><span>${String(g.min).replace('.', ',')} Min.</span></li>`).join('');
  const mmss = x => { x = Math.max(0, Math.ceil(x)); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`; };
  if (!hasGermanVoice()) $('#t-hint').textContent += ' Auf diesem Gerät ist keine deutsche Stimme verfügbar – es gibt nur Signaltöne.';

  const build = () => createTimer(segs, {
    voice: timerPrefs.voice, sound: timerPrefs.sound,
    onTick(t) {
      const seg = t.seg;
      const box = $('#timer');
      if (!box) return;
      box.className = 'timer ' + (seg ? 'is-' + seg.type : 'is-done');
      $('#t-seg').textContent = seg ? SEG_LABEL[seg.type] : 'Geschafft! 🎉';
      $('#t-big').textContent = seg ? mmss(t.segRemaining) : '0:00';
      $('#t-next').textContent = seg ? (t.next ? `Danach: ${SEG_LABEL[t.next.type]} (${String(t.next.min).replace('.', ',')} Min.)` : 'Danach: geschafft!') : '';
      $('#t-bar').style.width = (t.elapsed / t.total * 100).toFixed(1) + '%';
      $('#t-el').textContent = mmss(t.elapsed) + ' vergangen';
      $('#t-rem').textContent = 'noch ' + mmss(t.remaining);
      $('#t-start').textContent = t.running ? '❚❚ Pause' : (t.elapsed > 0 && seg ? '▶︎ Weiter' : '▶︎ Start');
      list.querySelectorAll('li').forEach(li => {
        const i = +li.dataset.i;
        li.classList.toggle('current', i === t.index);
        li.classList.toggle('past', i < t.index);
      });
    },
    onDone() {
      $('#t-start').textContent = '✓ Einheit abhaken';
      $('#t-start').onclick = () => { location.hash = '#/einheit/' + id; setTimeout(() => feedbackDialog(id), 50); };
    },
  });
  activeTimer = build();
  $('#t-start').onclick = () => {
    if (!activeTimer) return;
    if (activeTimer.isFinished()) return;
    if (activeTimer.isRunning()) activeTimer.pause(); else activeTimer.start();
  };
  $('#t-skip').onclick = () => activeTimer && activeTimer.skip();
  $('#t-voice').onchange = e => { timerPrefs.voice = e.target.checked; db.set('timerPrefs', timerPrefs); toast('Wirkt ab dem nächsten Start des Timers.'); };
  $('#t-sound').onchange = e => { timerPrefs.sound = e.target.checked; db.set('timerPrefs', timerPrefs); toast('Wirkt ab dem nächsten Start des Timers.'); };
}

// ------------------------------------------------------------ Übungen
function viewExercises(filter) {
  const f = AREAS[filter] ? filter : 'alle';
  const list = EXERCISES.filter(e => f === 'alle' || e.area === f);
  return `
  <header class="page-head"><h1>Übungen</h1>
  <p class="muted">${EXERCISES.length} Übungen für Kraft, Gleichgewicht, Mobilität und Yoga – jeweils mit Anleitung, Tipp und leichterer Variante.</p></header>
  <nav class="chips">
    <a class="chip ${f === 'alle' ? 'active' : ''}" href="#/uebungen">Alle</a>
    ${Object.entries(AREAS).map(([k, v]) => `<a class="chip ${f === k ? 'active' : ''}" href="#/uebungen/${k}">${v}</a>`).join('')}
  </nav>
  <div class="ex-grid">${list.map(e => exerciseCard(e)).join('')}</div>`;
}
function viewExercise(id) {
  const e = exerciseById(id);
  if (!e) return `<p>Übung nicht gefunden. <a href="#/uebungen">Zu den Übungen</a></p>`;
  const video = state.videos[e.id];
  return `
  <a class="back" href="javascript:history.back()">‹ Zurück</a>
  <header class="page-head"><span class="ex-area area-${e.area}">${AREAS[e.area]}</span><h1>${esc(e.name)}</h1><p class="muted">${esc(e.dose)}</p></header>
  <div class="grid two">
    <article class="card"><h2>So geht’s</h2><ol class="steps">${e.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></article>
    <div>
      <article class="card tip"><h2>💡 Tipp</h2><p>${esc(e.tip)}</p></article>
      <article class="card easy"><h2>🌱 Leichter</h2><p>${esc(e.easier)}</p></article>
      <article class="card"><h2>🎬 Video</h2>
        ${video ? `<p><a class="btn primary" href="${esc(video)}" target="_blank" rel="noopener noreferrer">▶︎ Video öffnen</a></p><p class="small muted break">${esc(video)}</p>
          <button class="btn ghost" data-action="video" data-id="${e.id}">Link ändern</button> <button class="btn ghost" data-action="video-del" data-id="${e.id}">Link entfernen</button>`
        : `<p class="small muted">Der Lauftrainer bringt keine Videos mit. Du kannst einen eigenen Link speichern – z. B. von deiner Physiotherapeutin.</p>
          <button class="btn" data-action="video" data-id="${e.id}">Videolink eintragen</button>`}
      </article>
    </div>
  </div>`;
}
function videoDialog(id) {
  const cur = state.videos[id] || '';
  modal(`<h2>Videolink</h2><p class="small muted">Der Link muss mit <b>https://</b> beginnen. Er wird nur auf diesem iPad gespeichert.</p>
    <input type="url" id="v-url" value="${esc(cur)}" placeholder="https://…" inputmode="url" autocapitalize="off">
    <p class="error" id="v-err"></p>
    <div class="actions"><button class="btn ghost" data-close>Abbrechen</button><button class="btn primary" id="v-ok">Speichern</button></div>`,
  (el, close) => {
    el.querySelector('#v-ok').onclick = async () => {
      const v = el.querySelector('#v-url').value.trim();
      let ok = false;
      try { ok = new URL(v).protocol === 'https:'; } catch { ok = false; }
      if (!ok) { el.querySelector('#v-err').textContent = 'Bitte einen gültigen Link eingeben, der mit https:// beginnt.'; return; }
      state.videos[id] = v; await save(); close(); render();
    };
  });
}

// ------------------------------------------------------------ Verlauf
function viewHistory() {
  const { sessions } = plan();
  const items = [];
  sessions.filter(s => s.type !== 'rest' && s.status !== 'open').forEach(s => items.push({ kind: 'session', date: s.doneAt || s.date, s }));
  state.activities.forEach(a => items.push({ kind: 'act', date: a.date, a, t: a.start }));
  items.sort((x, y) => (y.date.localeCompare(x.date)) || ((y.t || '').localeCompare(x.t || '')));
  const runActs = state.activities.filter(a => a.sport === 'running');
  const totalKm = runActs.reduce((a, x) => a + (x.distance || 0), 0) / 1000;
  const month = todayISO().slice(0, 7);
  const monthKm = runActs.filter(a => a.date.startsWith(month)).reduce((a, x) => a + (x.distance || 0), 0) / 1000;
  return `
  <header class="page-head"><h1>Verlauf</h1><p class="muted">Deine erledigten und übersprungenen Einheiten sowie deine Apple-Watch-Trainings.</p></header>
  <div class="grid three">
    <div class="card stat"><b>${sessions.filter(s => s.status === 'done' && s.type !== 'rest').length}</b><span>Einheiten erledigt</span></div>
    <div class="card stat"><b>${monthKm.toFixed(1).replace('.', ',')} km</b><span>gelaufen diesen Monat</span></div>
    <div class="card stat"><b>${totalKm.toFixed(1).replace('.', ',')} km</b><span>gelaufen insgesamt</span></div>
  </div>
  <div class="toolbar"><button class="btn" data-action="import">⌚ Trainings importieren</button></div>
  <article class="card">
  ${items.length ? `<ul class="history">${items.map(it => it.kind === 'act'
    ? `<li>${activityRow(it.a)}</li>`
    : `<li><a class="session-row ${TYPE_INFO[it.s.type].css} ${it.s.status}" href="#/einheit/${it.s.id}">
        <span class="s-icon">${it.s.status === 'done' ? TYPE_INFO[it.s.type].icon : '⏭️'}</span>
        <span class="s-main"><b>${sessionTitle(it.s)}</b>${it.s.type === 'run' && it.s.stage ? ` · Stufe ${it.s.stage}` : ''}
          <span class="small muted">${weekdayShort(it.date)}, ${fmtDate(it.date, true)}${it.s.feedback ? ' · ' + FEEDBACK[it.s.feedback].icon + ' ' + FEEDBACK[it.s.feedback].label : ''}</span>
          ${it.s.note ? `<span class="small note">„${esc(it.s.note)}“</span>` : ''}</span>
        ${statusBadge(it.s)}
      </a></li>`).join('')}</ul>`
    : '<p class="muted">Noch nichts da – deine erste Einheit wartet schon! 💪</p>'}
  </article>`;
}

// ------------------------------------------------------------ Import
function pickFiles(accept, multiple) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.style.display = 'none';
    inp.onchange = () => { resolve([...inp.files]); inp.remove(); };
    document.body.appendChild(inp);
    inp.click();
  });
}
async function doImport() {
  // iPadOS kennt .fit nicht als Dateityp – daher keine Einschränkung, Prüfung erfolgt beim Einlesen.
  const files = await pickFiles('', true);
  if (!files.length) return;
  const { activities, errors } = await importFiles(files);
  const known = new Set(state.activities.map(a => a.id));
  const fresh = activities.filter(a => !known.has(a.id) && (known.add(a.id), true));
  state.activities.push(...fresh);
  state.lastImportAt = nowISO();
  await save();
  render();
  const dup = activities.length - fresh.length;
  modal(`<h2>Import abgeschlossen</h2>
    <p>✅ <b>${fresh.length}</b> neue${fresh.length === 1 ? 's' : ''} Training${fresh.length === 1 ? '' : 's'} übernommen.</p>
    ${dup ? `<p class="muted">${dup} war${dup === 1 ? '' : 'en'} schon vorhanden und wurde${dup === 1 ? '' : 'n'} übersprungen.</p>` : ''}
    ${errors.length ? `<p class="error">Nicht lesbar:</p><ul class="small">${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    ${fresh.length ? `<div class="mt">${fresh.slice(0, 5).map(activityRow).join('')}</div>` : ''}
    <div class="actions"><button class="btn primary" data-close>Fertig</button></div>`);
}

// ------------------------------------------------------------ Einstellungen
const TABS = [['profil', 'Profil & Plan'], ['watch', 'Apple Watch'], ['daten', 'Daten & Sicherung'], ['ueber', 'Über']];
async function viewSettings(tab) {
  let body = '';
  if (tab === 'profil') {
    const p = state.profile;
    const end = addDays(p.startDate, p.weeks * 7 - 1);
    body = `
    <article class="card"><h2>Dein Name</h2>
      <form id="f-name" class="row"><input id="s-name" type="text" maxlength="40" value="${esc(p.name)}" required><button class="btn primary">Speichern</button></form></article>
    <article class="card"><h2>Dein Plan</h2>
      <p>${p.weeks} Wochen · ${fmtDate(p.startDate, true)} bis ${fmtDate(end, true)}</p>
      <div class="row wrap">
        <button class="btn" data-action="extend">➕ Um ${EXTEND_WEEKS} Wochen verlängern</button>
        <button class="btn ghost" data-action="restart">↺ Plan neu starten …</button>
      </div>
      <p class="small muted">Beim Neustart wird vorher automatisch eine Sicherung angelegt. Apple-Watch-Trainings und Videolinks bleiben erhalten.</p>
    </article>`;
  } else if (tab === 'watch') {
    body = `
    <article class="card"><h2>⌚ Trainings von der Apple Watch</h2>
      <p>Deine Apple Watch speichert Trainings in der Health-App auf dem iPhone. Die App <b>HealthFit</b> legt jedes Training automatisch als Datei in deiner iCloud Drive ab. Von dort holst du sie hier mit einem Tipp ins Training.</p>
      <p><b>${state.activities.length}</b> Trainings gespeichert${state.lastImportAt ? ` · zuletzt importiert am ${fmtDate(state.lastImportAt.slice(0, 10))}` : ''}</p>
      <button class="btn primary" data-action="import">Trainings importieren …</button>
      <p class="small muted">Im Dateien-Fenster: <b>iCloud Drive › HealthFit</b> öffnen, oben rechts auf <b>Auswählen</b> tippen, die neuen Dateien markieren und <b>Öffnen</b> tippen. Doppelte Trainings werden automatisch erkannt.</p>
    </article>
    <article class="card"><h2>Einmalig einrichten</h2>
      <ol class="steps">
        <li>Auf dem <b>iPhone</b> die App <b>HealthFit</b> aus dem App Store laden (einmaliger Kauf, kein Abo) und den Zugriff auf Health erlauben.</li>
        <li>In HealthFit die automatische Übertragung zu <b>iCloud Drive</b> einschalten und als Format <b>FIT</b> wählen.</li>
        <li>Auf dem <b>iPad</b> unter Einstellungen › [dein Name] › iCloud › <b>iCloud Drive</b> einschalten (gleiche Apple-ID wie auf dem iPhone).</li>
        <li>Laufen mit der Trainings-App der Apple Watch – fertig. Die Datei erscheint kurz danach in iCloud Drive.</li>
      </ol>
      <p class="small muted">Gespeichert werden nur: Datum, Sportart, Distanz, Zeit, Tempo, Höhenmeter und Herzfrequenz (⌀/max). Die Strecke (GPS) wird nicht gespeichert.</p>
    </article>
    ${state.activities.length ? `<article class="card"><h2>Importierte Trainings entfernen</h2>
      <button class="btn danger ghost" data-action="del-acts">Alle ${state.activities.length} Apple-Watch-Trainings löschen</button></article>` : ''}`;
  } else if (tab === 'daten') {
    const snaps = await getSnapshots();
    const persisted = await db.isPersisted();
    body = `
    <article class="card"><h2>💾 Sichern</h2>
      <p>Deine Daten liegen nur auf diesem iPad. Sichere sie ab und zu als Datei, z. B. in <b>iCloud Drive</b> oder <b>Auf meinem iPad</b>.</p>
      <button class="btn primary" data-action="backup">Jetzt sichern …</button>
      <p class="small muted">Es öffnet sich das Teilen-Menü. Wähle <b>In Dateien sichern</b>.${state.lastBackupAt ? ` Letzte Sicherung: ${fmtDate(state.lastBackupAt.slice(0, 10), true)}.` : ''}</p>
    </article>
    <article class="card"><h2>↩︎ Wiederherstellen</h2>
      <button class="btn" data-action="restore-file">Sicherung aus Datei laden …</button>
      ${snaps.length ? `<h3 class="mt">Automatische Sicherungen in der App</h3>
      <ul class="snap-list">${snaps.map(s => `<li><span><b>${new Date(s.createdAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</b><br><span class="small muted">${esc(s.reason)}</span></span>
        <span class="row"><button class="btn small" data-action="snap-restore" data-id="${s.id}">Wiederherstellen</button>
        <button class="btn small ghost" data-action="snap-download" data-id="${s.id}">Exportieren</button></span></li>`).join('')}</ul>` : ''}
      <p class="small muted">Vor dem Wiederherstellen wird der aktuelle Stand automatisch gesichert.</p>
    </article>
    <article class="card"><h2>Speicher</h2>
      <p class="small">Speicherart: ${db.backendName()} · Dauerhaft geschützt: ${persisted ? '✅ ja' : 'nein'} · Als App geöffnet: ${isStandalone() ? '✅ ja' : 'nein (bitte über den Home-Bildschirm öffnen)'}</p>
    </article>
    <article class="card danger-zone"><h2>🗑 Löschen</h2>
      <p>Entfernt Plan, Fortschritt, Notizen, Einstellungen, Apple-Watch-Trainings und Videolinks. Optional auch alle automatischen Sicherungen.</p>
      <button class="btn danger" data-action="wipe">Alle Daten löschen …</button>
    </article>`;
  } else {
    body = `
    <article class="card"><h2>Mayleens Lauftrainer</h2>
      <p class="muted">Stolli</p>
      <p>Version ${VERSION} · iPad-Ausgabe</p>
      <p>Dein freundlicher Trainer für einen entspannten Laufeinstieg – mit Gehpausen, Kraft, Yoga und genug Erholung.</p>
    </article>
    <article class="card"><h2>Datenschutz</h2>
      <ul>
        <li>Alle Daten bleiben auf diesem iPad. Es gibt kein Benutzerkonto und keinen Server, der deine Daten speichert.</li>
        <li>Die App lädt keine fremden Schriften, Skripte oder Werbung. Ein Sicherheitsfilter verhindert solche Verbindungen technisch.</li>
        <li>Apple-Watch-Trainings werden nur gelesen, wenn du Dateien auswählst.</li>
      </ul>
    </article>
    <article class="card"><h2>Wichtiger Hinweis</h2>
      <p>Der Lauftrainer ist <b>kein medizinisches Produkt</b>. Er stellt keine Diagnosen und gibt keine medizinischen Ratschläge. Bei Schmerzen, gesundheitlichen Fragen oder Unsicherheit sprich bitte mit deiner Ärztin oder deinem Arzt.</p>
      <p class="small muted">Apple Watch und iPad sind Marken der Apple Inc. HealthFit ist eine App eines unabhängigen Entwicklers. Der Lauftrainer steht mit keinem der beiden in Verbindung.</p>
    </article>`;
  }
  return `
  <header class="page-head"><h1>Einstellungen</h1></header>
  <nav class="chips">${TABS.map(([k, v]) => `<a class="chip ${k === tab ? 'active' : ''}" href="#/einstellungen/${k}">${v}</a>`).join('')}</nav>
  ${body}`;
}
function bindSettings(tab) {
  if (tab === 'profil') {
    document.getElementById('f-name').onsubmit = async e => {
      e.preventDefault();
      const v = document.getElementById('s-name').value.trim();
      if (!v) return;
      state.profile.name = v; await save(); render(); toast('Gespeichert.');
    };
  }
}
async function pickBackupFile() {
  const [file] = await pickFiles('', false);
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    const data = validateBackup(obj);
    const ok = !state.profile || await confirmDialog('Sicherung wiederherstellen?',
      `Die Sicherung von <b>${esc(data.profile?.name || '–')}</b> ersetzt den aktuellen Stand. Der aktuelle Stand wird vorher automatisch gesichert.`, 'Wiederherstellen');
    if (!ok) return;
    await restoreData(data);
    location.hash = '#/uebersicht';
    render(); toast('Sicherung wiederhergestellt.');
  } catch (e) {
    toast(e.message && e.message.includes('Lauftrainer') ? e.message : 'Die Datei konnte nicht gelesen werden.', 4000);
  }
}

// ------------------------------------------------------------ Aktionen
const actions = {
  done: el => feedbackDialog(el.dataset.id),
  skip: async el => { await setSession(el.dataset.id, { status: 'skipped', doneAt: todayISO() }); render(); toast('Übersprungen – völlig in Ordnung. Weiter geht’s beim nächsten Mal!'); },
  move: el => moveDialog(el.dataset.id),
  reset: async el => {
    const date = state.sessions[el.dataset.id]?.date || null;
    state.sessions[el.dataset.id] = date ? { date } : undefined;
    if (!date) delete state.sessions[el.dataset.id];
    await save(); render(); toast('Zurückgesetzt.');
  },
  'edit-note': el => noteDialog(el.dataset.id),
  video: el => videoDialog(el.dataset.id),
  'video-del': async el => { delete state.videos[el.dataset.id]; await save(); render(); },
  import: () => doImport(),
  extend: async () => {
    if (!await confirmDialog('Plan verlängern?', `Dein Plan wird um ${EXTEND_WEEKS} Wochen verlängert. Danach geht es Schritt für Schritt weiter: erst bis 5 km, dann bis 10 km und schließlich bis 15 km – mit einem lockeren Lauf am Montag und Donnerstag und einem langen Lauf am Samstag.`, 'Verlängern')) return;
    state.profile.weeks += EXTEND_WEEKS; await save(); render(); toast(`Plan um ${EXTEND_WEEKS} Wochen verlängert.`);
  },
  restart: () => {
    const nextMon = addDays(mondayOf(todayISO()), 7);
    modal(`<h2>Plan neu starten</h2>
      <p>Der Plan beginnt wieder bei Woche 1. Erledigte Einheiten und Notizen des alten Plans werden zurückgesetzt – vorher wird automatisch eine Sicherung angelegt.</p>
      <label>Startwoche <input type="date" id="r-date" value="${nextMon}"></label>
      <div class="actions"><button class="btn ghost" data-close>Abbrechen</button><button class="btn primary" id="r-ok">Neu starten</button></div>`,
    (el, close) => {
      el.querySelector('#r-ok').onclick = async () => {
        await addSnapshot('Vor dem Neustart des Plans');
        state.profile.startDate = mondayOf(el.querySelector('#r-date').value || nextMon);
        state.profile.weeks = BASE_WEEKS;
        state.sessions = {};
        await save(); close(); location.hash = '#/uebersicht'; render(); toast('Neuer Plan, neues Glück! 🌱');
      };
    });
  },
  backup: async () => {
    const text = backupPayload(); // synchron erzeugen, damit das Teilen-Menü öffnen darf
    const res = await shareOrDownload(backupFileName(), text);
    if (res === 'aborted') return;
    state.lastBackupAt = nowISO();
    await save();
    await addSnapshot('Manuelle Sicherung');
    render();
    toast(res === 'shared' ? 'Sicherung erstellt.' : 'Sicherung wurde heruntergeladen (Dateien › Downloads).', 4000);
  },
  'restore-file': () => pickBackupFile(),
  'snap-restore': async el => {
    const snap = (await getSnapshots()).find(s => s.id === el.dataset.id);
    if (!snap) return;
    if (!await confirmDialog('Wiederherstellen?', `Stand vom ${new Date(snap.createdAt).toLocaleString('de-DE')} wiederherstellen? Der aktuelle Stand wird vorher gesichert.`, 'Wiederherstellen')) return;
    await restoreData(snap.data);
    render(); toast('Wiederhergestellt.');
  },
  'snap-download': async el => {
    const snap = (await getSnapshots()).find(s => s.id === el.dataset.id);
    if (!snap) return;
    const text = JSON.stringify({ app: 'mayleens-lauftrainer', version: VERSION, createdAt: snap.createdAt, data: snap.data }, null, 1);
    await shareOrDownload(`Lauftrainer-Sicherung-${snap.createdAt.slice(0, 10)}.json`, text);
  },
  'del-acts': async () => {
    if (!await confirmDialog('Trainings löschen?', 'Alle importierten Apple-Watch-Trainings werden aus dem Lauftrainer entfernt. Auf der Watch, in Health und in iCloud Drive bleiben sie erhalten.', 'Löschen', true)) return;
    state.activities = []; state.lastImportAt = null; await save(); render(); toast('Gelöscht.');
  },
  wipe: () => {
    modal(`<h2>Alle Daten löschen</h2>
      <p>Das kann nicht rückgängig gemacht werden. Tipp: vorher eine Sicherung als Datei anlegen.</p>
      <label class="radio"><input type="checkbox" id="wp-snaps"> Auch alle automatischen Sicherungen löschen</label>
      <label class="mt">Zur Bestätigung <b>LÖSCHEN</b> eintippen<input id="wp-text" type="text" autocapitalize="characters" autocomplete="off"></label>
      <div class="actions"><button class="btn ghost" data-close>Abbrechen</button><button class="btn danger" id="wp-ok">Endgültig löschen</button></div>`,
    (el, close) => {
      el.querySelector('#wp-ok').onclick = async () => {
        if (el.querySelector('#wp-text').value.trim().toUpperCase() !== 'LÖSCHEN') { toast('Bitte LÖSCHEN eintippen.'); return; }
        if (el.querySelector('#wp-snaps').checked) await db.clearAll();
        else { await addSnapshot('Vor dem Löschen aller Daten'); }
        state = emptyState(); await save(); close();
        location.hash = '#/'; render(); toast('Alle Daten wurden gelöscht.');
      };
    });
  },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});

// ------------------------------------------------------------ Service Worker & Start
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (!(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    // Beim Zurückkehren in die App nach Updates schauen (iPadOS lädt Home-Bildschirm-Apps selten neu)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          const t = document.getElementById('toast');
          t.innerHTML = 'Eine neue Version ist da. <button class="linkbtn" id="upd">Jetzt laden</button>';
          t.classList.add('show');
          document.getElementById('upd').onclick = () => location.reload();
        }
      });
    });
  }).catch(err => console.warn('Service Worker nicht registriert', err));
}

async function init() {
  try {
    const loaded = await db.get('state');
    state = loaded ? { ...emptyState(), ...loaded } : emptyState();
    timerPrefs = { ...timerPrefs, ...((await db.get('timerPrefs')) || {}) };
  } catch (e) {
    console.error(e);
    state = emptyState();
  }
  window.addEventListener('hashchange', render);
  await render();
  registerSW();
  // Tageswechsel: um Mitternacht neu zeichnen
  let day = todayISO();
  setInterval(() => { if (todayISO() !== day) { day = todayISO(); if (!activeTimer) render(); } }, 60000);
  document.documentElement.classList.add('ready');
}

// Für Tests
window.__lt = { get state() { return state; }, render, save };

init();

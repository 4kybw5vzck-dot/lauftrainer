// Intervall-Timer: zeitstempelbasiert (läuft korrekt weiter, auch wenn Safari kurz pausiert),
// Signalton per Web Audio, Ansage per Sprachausgabe, Bildschirm bleibt an (Wake Lock).

const SEG_TEXT = {
  warmup: 'Aufwärmen – zügig gehen',
  run: 'Laufen',
  walk: 'Gehen',
  cooldown: 'Ausgehen – locker gehen',
};
export const SEG_LABEL = { warmup: 'Aufwärmen', run: 'Laufen', walk: 'Gehen', cooldown: 'Ausgehen' };

let audioCtx = null;
function ctx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

export function beep(times = 1, freq = 880) {
  const c = ctx();
  if (!c) return;
  for (let i = 0; i < times; i++) {
    const t0 = c.currentTime + i * 0.28;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    o.connect(g).connect(c.destination);
    o.start(t0); o.stop(t0 + 0.25);
  }
}

let germanVoice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const vs = speechSynthesis.getVoices();
  germanVoice = vs.find(v => v.lang && v.lang.toLowerCase().startsWith('de')) || null;
  return germanVoice;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
export function hasGermanVoice() { return !!(germanVoice || pickVoice()); }

export function say(text) {
  if (!('speechSynthesis' in window)) return;
  const v = germanVoice || pickVoice();
  if (!v) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = v; u.lang = v.lang; u.rate = 1;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* nicht unterstützt */ }
}

function fmtMin(m) {
  return Number.isInteger(m) ? `${m} Minuten` : `${String(m).replace('.', ',')} Minuten`;
}

/**
 * Erstellt einen Timer für eine Segmentliste [{type, min}].
 * onTick(state) wird regelmäßig aufgerufen, onDone() am Ende.
 */
export function createTimer(segments, { onTick, onDone, voice = true, sound = true } = {}) {
  const segs = segments.map(s => ({ ...s, sec: Math.round(s.min * 60) }));
  const total = segs.reduce((a, s) => a + s.sec, 0);
  let elapsedBefore = 0;      // Sekunden vor dem letzten Start
  let startedAt = null;       // performance-unabhängig: Date.now()
  let lastIndex = -1;
  let interval = null;
  let finished = false;
  let warned = -1;

  function elapsed() {
    return elapsedBefore + (startedAt ? (Date.now() - startedAt) / 1000 : 0);
  }
  function locate(el) {
    let acc = 0;
    for (let i = 0; i < segs.length; i++) {
      if (el < acc + segs[i].sec) return { index: i, segElapsed: el - acc, segRemaining: acc + segs[i].sec - el };
      acc += segs[i].sec;
    }
    return { index: segs.length, segElapsed: 0, segRemaining: 0 };
  }
  function announce(i) {
    const s = segs[i];
    if (!s) return;
    if (sound) beep(s.type === 'run' ? 2 : 1, s.type === 'run' ? 990 : 660);
    if (voice) {
      const nr = segs.slice(0, i + 1).filter(x => x.type === 'run').length;
      const runs = segs.filter(x => x.type === 'run').length;
      let t = `${SEG_TEXT[s.type]}, ${fmtMin(s.min)}.`;
      if (s.type === 'run' && runs > 1) t = `Laufen, ${fmtMin(s.min)}. Abschnitt ${nr} von ${runs}.`;
      setTimeout(() => say(t), 650);
    }
  }
  function tick() {
    const el = Math.min(elapsed(), total);
    const loc = locate(el);
    if (loc.index !== lastIndex) {
      if (loc.index < segs.length) announce(loc.index);
      lastIndex = loc.index;
      warned = -1;
    }
    // 3-2-1 vor einem Wechsel
    const r = Math.ceil(loc.segRemaining);
    if (loc.index < segs.length && r <= 3 && r >= 1 && warned !== r && startedAt) {
      warned = r;
      if (sound) beep(1, 440);
    }
    onTick && onTick({
      running: !!startedAt, elapsed: el, total, remaining: total - el,
      index: loc.index, seg: segs[loc.index] || null, next: segs[loc.index + 1] || null,
      segRemaining: loc.segRemaining, segTotal: segs[loc.index] ? segs[loc.index].sec : 0, segments: segs,
    });
    if (el >= total && !finished) {
      finished = true;
      pause();
      if (sound) beep(3, 1046);
      if (voice) setTimeout(() => say('Geschafft! Super gemacht.'), 900);
      onDone && onDone();
    }
  }
  function start() {
    if (finished || startedAt) return;
    ctx(); // Audio im Nutzer-Klick entsperren
    if (voice && 'speechSynthesis' in window) { try { speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch { /* */ } }
    startedAt = Date.now();
    keepAwake(true);
    clearInterval(interval);
    interval = setInterval(tick, 250);
    tick();
  }
  function pause() {
    if (startedAt) { elapsedBefore += (Date.now() - startedAt) / 1000; startedAt = null; }
    clearInterval(interval); interval = null;
    keepAwake(false);
    tick();
  }
  function skip() {
    const loc = locate(elapsed());
    if (loc.index >= segs.length) return;
    elapsedBefore = segs.slice(0, loc.index + 1).reduce((a, s) => a + s.sec, 0);
    if (startedAt) startedAt = Date.now();
    tick();
  }
  function stop() {
    clearInterval(interval); interval = null; startedAt = null;
    keepAwake(false);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
  const onVis = () => { if (document.visibilityState === 'visible' && startedAt) { keepAwake(true); tick(); } };
  document.addEventListener('visibilitychange', onVis);

  tick();
  return {
    start, pause, skip,
    stop() { stop(); document.removeEventListener('visibilitychange', onVis); },
    isRunning: () => !!startedAt,
    isFinished: () => finished,
  };
}

// Mayleens Lauftrainer – feste Inhalte: Laufstufen, Übungen, Einheiten, Sprüche
// Alles lokal, nichts wird nachgeladen.

export const VERSION = '2.1.0';

// Laufstufen. Stufen 1–18 (Grundlagen, 10 Wochen): Blöcke [laufenMin, gehenMin] × Wiederholungen
// oder freie Segmentliste. Stufen ab 19 (Aufbau 5 km → 10 km → 15 km): je Woche eine Stufe mit
// lockerem Lauf (Mo/Do, `easy`) und langem Lauf (Sa, `long`), jeweils am Stück.
// Aufwärmen und Ausgehen (je 5 Min. Gehen) kommen immer dazu.
export const STAGES = [
  { n: 1,  reps: 6, run: 1,   walk: 2 },
  { n: 2,  reps: 6, run: 1.5, walk: 2 },
  { n: 3,  reps: 6, run: 2,   walk: 2 },
  { n: 4,  reps: 5, run: 3,   walk: 2 },
  { n: 5,  reps: 5, run: 3,   walk: 1.5 },
  { n: 6,  reps: 4, run: 4,   walk: 2 },
  { n: 7,  reps: 4, run: 5,   walk: 2 },
  { n: 8,  reps: 3, run: 6,   walk: 2 },
  { n: 9,  reps: 3, run: 7,   walk: 2 },
  { n: 10, reps: 3, run: 8,   walk: 2 },
  { n: 11, reps: 2, run: 10,  walk: 2.5 },
  { n: 12, reps: 2, run: 12,  walk: 2 },
  { n: 13, reps: 2, run: 14,  walk: 1.5 },
  { n: 14, custom: [['run', 18], ['walk', 2], ['run', 6]] },
  { n: 15, custom: [['run', 22]] },
  { n: 16, custom: [['run', 25]] },
  { n: 17, custom: [['run', 27]] },
  { n: 18, custom: [['run', 30]] },
  // Aufbau 1: Ziel 5 km
  { n: 19, phase: '5 km',  easy: 30, long: 33 },
  { n: 20, phase: '5 km',  easy: 30, long: 36 },
  { n: 21, phase: '5 km',  easy: 30, long: 38 },
  { n: 22, phase: '5 km',  easy: 30, long: 40, goal: true },
  // Aufbau 2: Ziel 10 km
  { n: 23, phase: '10 km', easy: 30, long: 45 },
  { n: 24, phase: '10 km', easy: 35, long: 50 },
  { n: 25, phase: '10 km', easy: 35, long: 55 },
  { n: 26, phase: '10 km', easy: 35, long: 60 },
  { n: 27, phase: '10 km', easy: 40, long: 65 },
  { n: 28, phase: '10 km', easy: 40, long: 70 },
  { n: 29, phase: '10 km', easy: 40, long: 75, goal: true },
  // Aufbau 3: Ziel 15 km
  { n: 30, phase: '15 km', easy: 40, long: 80 },
  { n: 31, phase: '15 km', easy: 45, long: 85 },
  { n: 32, phase: '15 km', easy: 45, long: 90 },
  { n: 33, phase: '15 km', easy: 45, long: 95 },
  { n: 34, phase: '15 km', easy: 45, long: 100 },
  { n: 35, phase: '15 km', easy: 50, long: 105 },
  { n: 36, phase: '15 km', easy: 50, long: 110 },
  { n: 37, phase: '15 km', easy: 50, long: 115, goal: true },
];
/** Letzte Stufe der Grundlagen-Phase (10 Wochen). */
export const BASE_STAGES = 18;
/** Wochentag des langen Laufs in der Aufbau-Phase (0 = Montag … 5 = Samstag). */
export const LONG_RUN_DOW = 5;
export const MAX_STAGE = STAGES.length;
export const WARMUP_MIN = 5;
export const COOLDOWN_MIN = 5;

function fmtMin(m) {
  return (Number.isInteger(m) ? String(m) : String(m).replace('.', ',')) + ' Min.';
}

function stageDef(n) { return STAGES[Math.min(Math.max(n, 1), MAX_STAGE) - 1]; }

/** Phase einer Stufe: null (Grundlagen) oder '5 km' | '10 km' | '15 km'. */
export function stagePhase(n) { return stageDef(n).phase || null; }
/** Ist dies die Zielstufe einer Aufbau-Phase – und zwar der lange Lauf? */
export function stageIsGoal(n, long = false) { const s = stageDef(n); return !!(s.goal && long); }

/** Kernteil einer Stufe als Segmente [{type:'run'|'walk', min}] (ohne Auf-/Abwärmen).
 *  `long` = langer Lauf am Samstag (nur in der Aufbau-Phase relevant). */
export function stageCore(n, long = false) {
  const s = stageDef(n);
  if (s.phase) return [{ type: 'run', min: long ? s.long : s.easy }];
  if (s.custom) return s.custom.map(([type, min]) => ({ type, min }));
  const out = [];
  for (let i = 0; i < s.reps; i++) {
    out.push({ type: 'run', min: s.run });
    if (i < s.reps - 1) out.push({ type: 'walk', min: s.walk }); // letzte Gehpause geht ins Ausgehen über
  }
  return out;
}

/** Komplette Einheit mit Aufwärmen und Ausgehen */
export function stageSegments(n, long = false) {
  return [
    { type: 'warmup', min: WARMUP_MIN },
    ...stageCore(n, long),
    { type: 'cooldown', min: COOLDOWN_MIN },
  ];
}

export function stageLabel(n, long = false) {
  const s = stageDef(n);
  if (s.phase) {
    if (long) return `${s.goal ? '🎯 ' : ''}Langer Lauf: ${fmtMin(s.long)} am Stück${s.goal ? ` – Ziel ${s.phase}` : ''}`;
    return `Lockerer Lauf: ${fmtMin(s.easy)} am Stück`;
  }
  if (s.custom) {
    if (s.custom.length === 1) return `${fmtMin(s.custom[0][1])} am Stück laufen`;
    return s.custom.map(([t, m]) => `${fmtMin(m)} ${t === 'run' ? 'laufen' : 'gehen'}`).join(' · ');
  }
  return `${s.reps} × (${fmtMin(s.run)} laufen + ${fmtMin(s.walk)} gehen)`;
}

export function stageTotalMin(n, long = false) {
  return stageSegments(n, long).reduce((a, s) => a + s.min, 0);
}

export function stageRunMin(n, long = false) {
  return stageCore(n, long).filter(s => s.type === 'run').reduce((a, s) => a + s.min, 0);
}

// Wochenstruktur: 0 = Montag … 6 = Sonntag
export const WEEK_TEMPLATE = ['run', 'strength', 'rest', 'run', 'yoga', 'run', 'rest'];

export const TYPE_INFO = {
  run:      { title: 'Laufen & Gehen',          short: 'Laufen',  icon: '🏃‍♀️', css: 't-run' },
  strength: { title: 'Kraft & Gleichgewicht',   short: 'Kraft',   icon: '💪',   css: 't-strength' },
  yoga:     { title: 'Yoga & Mobilität',        short: 'Yoga',    icon: '🧘‍♀️', css: 't-yoga' },
  rest:     { title: 'Ruhetag',                 short: 'Ruhe',    icon: '🌿',   css: 't-rest' },
};

export const AREAS = {
  kraft:         'Kraft',
  gleichgewicht: 'Gleichgewicht',
  mobilitaet:    'Mobilität',
  yoga:          'Yoga',
};

// 20 Übungen
export const EXERCISES = [
  // ---------- Kraft ----------
  {
    id: 'kniebeugen', area: 'kraft', name: 'Kniebeugen', dose: '2 × 10 Wiederholungen',
    steps: [
      'Stell dich hüftbreit hin, die Fußspitzen zeigen leicht nach außen.',
      'Schieb den Po nach hinten, als würdest du dich auf einen Stuhl setzen.',
      'Geh so weit runter, wie es angenehm ist – die Knie zeigen in Richtung der Zehen.',
      'Drück dich über die ganzen Füße wieder hoch.',
    ],
    tip: 'Die Fersen bleiben am Boden. Die Arme kannst du zum Ausbalancieren nach vorne strecken.',
    easier: 'Setz dich wirklich kurz auf einen Stuhl und steh wieder auf.',
  },
  {
    id: 'wandliegestuetz', area: 'kraft', name: 'Liegestütz an der Wand', dose: '2 × 10 Wiederholungen',
    steps: [
      'Stell dich etwa eine Armlänge vor eine Wand.',
      'Leg die Hände schulterbreit in Brusthöhe an die Wand.',
      'Beug die Arme und bring die Brust zur Wand, der Körper bleibt gerade.',
      'Drück dich wieder zurück.',
    ],
    tip: 'Je weiter deine Füße von der Wand weg sind, desto anstrengender wird es.',
    easier: 'Stell dich näher an die Wand.',
  },
  {
    id: 'glute-bridge', area: 'kraft', name: 'Beckenheben', dose: '2 × 12 Wiederholungen',
    steps: [
      'Leg dich auf den Rücken, die Beine angewinkelt, Füße hüftbreit am Boden.',
      'Spann den Po an und heb das Becken, bis Knie, Hüfte und Schultern eine Linie bilden.',
      'Halte kurz oben.',
      'Roll langsam wieder ab.',
    ],
    tip: 'Drück dich über die Fersen hoch – so arbeitet der Po stärker als der Rücken.',
    easier: 'Nur halb so hoch heben und dafür ruhig atmen.',
  },
  {
    id: 'ausfallschritt', area: 'kraft', name: 'Ausfallschritt zurück', dose: '2 × 8 pro Seite',
    steps: [
      'Stell dich aufrecht hin, die Hände an die Hüften.',
      'Mach einen großen Schritt nach hinten und senk das hintere Knie Richtung Boden.',
      'Das vordere Knie bleibt über dem Fuß.',
      'Drück dich mit dem vorderen Bein zurück in den Stand.',
    ],
    tip: 'Schau geradeaus, nicht auf den Boden – das hilft beim Gleichgewicht.',
    easier: 'Halt dich mit einer Hand an einer Stuhllehne fest und geh nur ein kleines Stück runter.',
  },
  {
    id: 'unterarmstuetz', area: 'kraft', name: 'Unterarmstütz', dose: '3 × 20 Sekunden',
    steps: [
      'Leg die Unterarme auf den Boden, die Ellbogen unter den Schultern.',
      'Streck die Beine nach hinten und stütz dich auf die Zehenspitzen.',
      'Halte den Körper gerade wie ein Brett.',
      'Atme ruhig weiter.',
    ],
    tip: 'Den Bauchnabel leicht nach innen ziehen – dann sackt die Hüfte nicht durch.',
    easier: 'Leg die Knie am Boden ab.',
  },
  {
    id: 'seitstuetz', area: 'kraft', name: 'Seitstütz', dose: '2 × 15 Sekunden pro Seite',
    steps: [
      'Leg dich auf die Seite, der Ellbogen liegt unter der Schulter.',
      'Heb die Hüfte, sodass der Körper eine gerade Linie bildet.',
      'Halte die Position.',
      'Wechsle die Seite.',
    ],
    tip: 'Die obere Hand kannst du an die Hüfte legen.',
    easier: 'Die Knie anwinkeln und auf dem unteren Knie abstützen.',
  },
  {
    id: 'wadenheben', area: 'kraft', name: 'Wadenheben', dose: '2 × 15 Wiederholungen',
    steps: [
      'Stell dich hüftbreit hin, halt dich leicht an einer Wand fest.',
      'Geh langsam auf die Zehenspitzen.',
      'Halte kurz oben.',
      'Senk die Fersen langsam wieder ab.',
    ],
    tip: 'Starke Waden schützen beim Laufen die Achillessehne. Langsam runter ist wichtiger als schnell hoch.',
    easier: 'Weniger Wiederholungen und nicht ganz so hoch.',
  },
  {
    id: 'clamshell', area: 'kraft', name: 'Muschel (Clamshell)', dose: '2 × 12 pro Seite',
    steps: [
      'Leg dich auf die Seite, die Knie angewinkelt, die Füße übereinander.',
      'Lass die Füße zusammen und öffne das obere Knie wie eine Muschel.',
      'Halte kurz.',
      'Schließ das Knie wieder langsam.',
    ],
    tip: 'Das Becken bleibt ruhig und kippt nicht nach hinten.',
    easier: 'Nur ein kleines Stück öffnen.',
  },
  // ---------- Gleichgewicht ----------
  {
    id: 'einbeinstand', area: 'gleichgewicht', name: 'Einbeinstand', dose: '3 × 30 Sekunden pro Bein',
    steps: [
      'Stell dich aufrecht hin, eine Wand oder Stuhllehne in der Nähe.',
      'Heb ein Bein leicht an.',
      'Halte das Gleichgewicht und atme ruhig.',
      'Wechsle das Bein.',
    ],
    tip: 'Klappt es gut? Dann schließ kurz die Augen oder steh auf einem Kissen.',
    easier: 'Mit einem Finger an der Wand abstützen.',
  },
  {
    id: 'tandemstand', area: 'gleichgewicht', name: 'Tandemstand', dose: '3 × 30 Sekunden',
    steps: [
      'Stell einen Fuß direkt vor den anderen, Ferse an Zehenspitze.',
      'Steh aufrecht, der Blick geht nach vorne.',
      'Halte die Position.',
      'Wechsle den vorderen Fuß.',
    ],
    tip: 'Ein fester Punkt an der Wand, den du anschaust, hilft enorm.',
    easier: 'Die Füße etwas versetzt nebeneinander stellen.',
  },
  {
    id: 'bird-dog', area: 'gleichgewicht', name: 'Vierfüßlerstand mit Arm und Bein', dose: '2 × 8 pro Seite',
    steps: [
      'Geh in den Vierfüßlerstand: Hände unter den Schultern, Knie unter der Hüfte.',
      'Streck den rechten Arm nach vorne und das linke Bein nach hinten.',
      'Halte zwei Atemzüge lang.',
      'Zurück in die Mitte und Seite wechseln.',
    ],
    tip: 'Stell dir vor, auf deinem Rücken steht ein Glas Wasser.',
    easier: 'Nur den Arm oder nur das Bein strecken.',
  },
  {
    id: 'standwaage', area: 'gleichgewicht', name: 'Kleine Standwaage', dose: '2 × 6 pro Bein',
    steps: [
      'Stell dich auf ein Bein, das Standknie ist leicht gebeugt.',
      'Neig den Oberkörper nach vorne und streck das freie Bein nach hinten.',
      'Geh nur so weit, wie du sicher stehst.',
      'Komm langsam zurück in den Stand.',
    ],
    tip: 'Rücken lang machen – der Kopf ist die Verlängerung der Wirbelsäule.',
    easier: 'Mit einer Hand an einer Stuhllehne festhalten.',
  },
  // ---------- Mobilität ----------
  {
    id: 'hueftkreisen', area: 'mobilitaet', name: 'Hüftkreisen', dose: '10 Kreise pro Richtung',
    steps: [
      'Stell dich hüftbreit hin, die Hände an die Hüften.',
      'Kreis das Becken langsam und groß.',
      'Nach 10 Kreisen die Richtung wechseln.',
    ],
    tip: 'Ideal zum Aufwärmen vor dem Laufen.',
    easier: 'Kleinere Kreise machen.',
  },
  {
    id: 'beinpendel', area: 'mobilitaet', name: 'Beinpendel', dose: '10 pro Bein und Richtung',
    steps: [
      'Halt dich seitlich an einer Wand fest.',
      'Schwing das äußere Bein locker vor und zurück.',
      'Danach seitlich vor dem Körper hin und her.',
      'Bein wechseln.',
    ],
    tip: 'Locker schwingen lassen, nicht mit Kraft hochreißen.',
    easier: 'Kleinere Bewegungen.',
  },
  {
    id: 'hueftbeuger-dehnung', area: 'mobilitaet', name: 'Hüftbeuger-Dehnung', dose: '2 × 30 Sekunden pro Seite',
    steps: [
      'Knie dich hin und stell ein Bein nach vorne auf (wie ein Heiratsantrag).',
      'Schieb die Hüfte sanft nach vorne.',
      'Du spürst die Dehnung vorne an der Hüfte des hinteren Beins.',
      'Seite wechseln.',
    ],
    tip: 'Leg ein Kissen unter das Knie.',
    easier: 'Im Stand: großer Schritt nach vorne, hinteres Bein lang.',
  },
  {
    id: 'waden-dehnung', area: 'mobilitaet', name: 'Waden-Dehnung an der Wand', dose: '2 × 30 Sekunden pro Seite',
    steps: [
      'Stütz dich mit beiden Händen an einer Wand ab.',
      'Stell ein Bein weit nach hinten, die Ferse bleibt am Boden.',
      'Beug das vordere Knie, bis du die Dehnung in der hinteren Wade spürst.',
      'Seite wechseln.',
    ],
    tip: 'Die hintere Fußspitze zeigt gerade nach vorne.',
    easier: 'Einen kleineren Schritt nach hinten machen.',
  },
  // ---------- Yoga ----------
  {
    id: 'katze-kuh', area: 'yoga', name: 'Katze und Kuh', dose: '8 ruhige Atemzüge',
    steps: [
      'Geh in den Vierfüßlerstand.',
      'Beim Einatmen: Bauch sinkt, Brust öffnet sich, Blick nach vorne (Kuh).',
      'Beim Ausatmen: Rücken rund machen, Kinn zur Brust (Katze).',
      'Im eigenen Atemrhythmus wiederholen.',
    ],
    tip: 'Die Bewegung folgt dem Atem – nicht umgekehrt.',
    easier: 'Im Sitzen auf einem Stuhl, die Hände auf den Knien.',
  },
  {
    id: 'herabschauender-hund', area: 'yoga', name: 'Herabschauender Hund', dose: '5 Atemzüge, 2 ×',
    steps: [
      'Aus dem Vierfüßlerstand die Zehen aufstellen.',
      'Schieb den Po nach oben und hinten, sodass ein umgedrehtes V entsteht.',
      'Die Knie dürfen gebeugt bleiben, die Fersen müssen nicht zum Boden.',
      'Ruhig atmen, dann zurück auf die Knie.',
    ],
    tip: 'Abwechselnd ein Knie beugen („Radfahren“) lockert die Waden schön.',
    easier: 'Hände auf einen Stuhl oder eine Tischkante legen.',
  },
  {
    id: 'kindhaltung', area: 'yoga', name: 'Kindhaltung', dose: '1 Minute',
    steps: [
      'Knie dich hin, die großen Zehen berühren sich.',
      'Setz dich auf die Fersen und leg den Oberkörper nach vorne ab.',
      'Die Arme liegen lang nach vorne oder neben dem Körper.',
      'Atme tief in den Rücken.',
    ],
    tip: 'Die perfekte Pause zwischendurch – immer erlaubt.',
    easier: 'Ein Kissen zwischen Po und Fersen oder unter die Stirn legen.',
  },
  {
    id: 'liegende-drehung', area: 'yoga', name: 'Liegende Drehung', dose: '45 Sekunden pro Seite',
    steps: [
      'Leg dich auf den Rücken und zieh die Knie zur Brust.',
      'Breite die Arme seitlich aus.',
      'Lass beide Knie langsam zu einer Seite sinken, der Kopf dreht zur anderen.',
      'Atmen, dann Seite wechseln.',
    ],
    tip: 'Ein schöner Abschluss – lass den Boden dich tragen.',
    easier: 'Ein Kissen unter die Knie legen.',
  },
];

export function exerciseById(id) {
  return EXERCISES.find(e => e.id === id);
}

// Einheiten-Programme. Kraft wechselt wöchentlich zwischen A und B.
export const STRENGTH_PROGRAMS = {
  A: ['hueftkreisen', 'kniebeugen', 'wandliegestuetz', 'glute-bridge', 'unterarmstuetz', 'einbeinstand', 'wadenheben'],
  B: ['beinpendel', 'ausfallschritt', 'clamshell', 'seitstuetz', 'bird-dog', 'tandemstand', 'standwaage', 'wadenheben'],
};
export const YOGA_PROGRAM = ['katze-kuh', 'herabschauender-hund', 'hueftbeuger-dehnung', 'waden-dehnung', 'beinpendel', 'kindhaltung', 'liegende-drehung'];

// Motivationssprüche (lokal). {name} wird durch den Namen ersetzt.
export const QUOTES = [
  'Jeder Schritt zählt – auch die langsamen.',
  'Heute geht es nicht um schnell, sondern ums Dranbleiben.',
  'Gehpausen sind kein Aufgeben. Sie sind Teil des Plans.',
  'Du musst nicht gut anfangen, um anzufangen.',
  '{name}, dein Körper lernt bei jeder Einheit dazu – auch wenn du es noch nicht merkst.',
  'Lieber regelmäßig ein bisschen als selten ganz viel.',
  'Ein Ruhetag ist Training für die Erholung.',
  'Das Tempo, bei dem du dich noch unterhalten kannst, ist genau richtig.',
  'Freu dich über jeden Haken im Plan.',
  'Du läufst nicht gegen andere. Nur mit dir selbst.',
  'Müde Beine heute, stärkere Beine morgen.',
  'Wer aufs Wetter wartet, verpasst die schönsten Läufe.',
  'Atme ruhig, lauf locker, lächle ab und zu.',
  'Kleine Schritte bringen dich genauso ans Ziel.',
  'Eine übersprungene Einheit ist kein Rückschritt. Morgen ist ein neuer Tag.',
  'Stolz sein ist ausdrücklich erlaubt, {name}!',
  'Dein Plan passt sich an dich an – nicht umgekehrt.',
  'Die erste Minute ist die schwerste. Danach wird es leichter.',
  'Laufschuhe an ist schon die halbe Miete.',
  'Du bist heute weiter als vor einer Woche.',
  'Langsam ist auch ein Tempo.',
  'Hör auf deinen Körper – er ist dein bester Trainer.',
  'Gute Laune ist der beste Rückenwind.',
  'Jeder Lauf ist ein Geschenk an dein zukünftiges Ich.',
  'Nicht perfekt, aber gemacht – das zählt.',
  'Frische Luft, freier Kopf.',
  'Heute ein bisschen mutiger als gestern.',
  'Pausen machen dich nicht schwächer, sondern ausdauernder.',
  'Erfolg ist die Summe kleiner Gewohnheiten.',
  '{name}, du schaffst mehr, als du denkst.',
  'Ein lockerer Lauf ist besser als gar keiner.',
  'Sei geduldig mit dir. Ausdauer wächst langsam, aber sicher.',
  'Feiere die Minute, die du heute länger läufst.',
  'Das Sofa läuft dir nicht weg – der Sonnenuntergang schon.',
  'Musik an, Kopf aus, los geht’s.',
  'Kraftübungen sind der Stoßdämpfer für deine Läufe.',
  'Du musst niemandem etwas beweisen – nur Spaß haben.',
  'Gleichgewicht trainiert man auch im Kopf.',
  'Heute zählt nur: rausgehen und zurückkommen.',
  'Dein Atem ist dein Taktgeber.',
  'Wer langsam läuft, sieht mehr von der Welt.',
  'Durchhalten heißt auch mal: kürzer machen.',
  'Ein guter Tag beginnt mit Bewegung.',
  'Jede Gehpause ist eine kleine Belohnung.',
  '{name}, dein zukünftiges Ich klatscht schon Beifall.',
  'Regen ist nur Wetter. Und du bist nicht aus Zucker.',
  'Die beste Einheit ist die, die du machst.',
  'Du wirst nicht stärker, wenn es leicht ist – aber du wirst es, wenn du dranbleibst.',
  'Lockere Schultern, weiche Knie, ruhiger Atem.',
  'Kleine Ziele, große Freude.',
  'Wer sich ausruht, kommt weiter.',
  'Vergleich dich nur mit dir von gestern.',
  'Ein Lächeln beim Laufen macht jeden Schritt leichter.',
  'Heute ist ein guter Tag für ein bisschen Bewegung.',
  'Gewohnheiten schlagen Motivation – und du baust gerade eine auf.',
  'Dehnen ist Danke sagen an deine Muskeln.',
  '{name}, du bist eine Läuferin. Punkt.',
  'Es ist okay, wenn es heute schwer war. Du hast es trotzdem gemacht.',
  'Schritt für Schritt wird aus Gehen Laufen.',
  'Bleib neugierig – auf neue Wege und auf dich selbst.',
  'Wer anfängt, hat schon gewonnen.',
  'Der Plan ist dein Freund, nicht dein Chef.',
  'Ein bisschen Bewegung ist immer besser als keine.',
  'Fühl dich frei, einfach loszulaufen.',
];

// Turns text into a composition: Morse -> rhythm -> pitches -> measures.
//
// Time is counted in "units" of one eighth note.
window.Composer = (() => {
  const { KEYS, SCALES, INSTRUMENTS, mod, posToMidi, tonicAtOrAbove } = Theory;

  // How Morse timing becomes rhythm (all lengths in eighth notes).
  const RHYTHMS = {
    musical: {
      label: 'Musical (dot = ♪, dash = ♩)',
      dot: 1, dash: 2, inner: 0, letter: 1, word: 3,
      describe: 'Dot = eighth note, dash = quarter note. Letters are separated by an eighth rest, words by a dotted-quarter rest.',
    },
    strict: {
      label: 'True Morse timing',
      dot: 1, dash: 3, inner: 1, letter: 3, word: 7,
      describe: 'One Morse unit = one eighth note. Dot = 1 unit, dash = 3 (a dotted quarter). Silences are 1 unit inside a letter, 3 between letters and 7 between words, exactly as in real Morse.',
    },
  };

  // Chord progression used by the arpeggio pattern: I – vi – IV – V.
  const PROGRESSION = [0, 5, 3, 4];
  // Where each chord's root sits relative to the melody tonic (keeps things centered).
  const MELODY_ROOT = { 0: 0, 5: -2, 3: -4, 4: -3 };
  // Chord a melody note belongs to, by scale degree (for the piano's left hand).
  const HARMONIZE = { 0: 0, 1: 4, 2: 0, 3: 3, 4: 0, 5: 5, 6: 4 };

  const PATTERNS = {
    arpeggio: {
      label: 'Chord arpeggios (I–vi–IV–V)',
      describe: 'Each letter climbs the notes of a chord, and the chords cycle I – vi – IV – V. This is the most "song-like" option.',
    },
    contour: {
      label: 'Dot steps up, dash steps down',
      describe: 'The melody walks the scale: every dot moves one step up, every dash one step down. You can see the Morse in the shape of the melody.',
    },
    runs: {
      label: 'Scale runs',
      describe: 'Each letter is a short run up the scale. Each letter starts one step higher than the one before, cycling every five letters.',
    },
    updown: {
      label: 'Up and down the scale',
      describe: 'Letters alternate: one climbs up from the tonic, the next comes down from the octave.',
    },
    letters: {
      label: 'Letter tones',
      describe: 'Every letter of the alphabet has its own note. Dots play that note, dashes play a third above it, so the same letter always sounds the same.',
    },
  };

  function parse(text) {
    const words = [];
    const skipped = new Set();
    for (const raw of text.toUpperCase().split(/\s+/)) {
      const letters = [];
      for (const ch of raw) {
        if (MORSE[ch]) letters.push({ ch, code: MORSE[ch] });
        else skipped.add(ch);
      }
      if (letters.length) words.push(letters);
    }
    return { words, skipped: [...skipped] };
  }

  function compose(text, opts) {
    const key = KEYS[opts.key];
    const inst = INSTRUMENTS[opts.instrument];
    const rhythm = RHYTHMS[opts.rhythm];
    const steps = SCALES[opts.scale][key.minor ? 'minor' : 'major'];
    const n = steps.length;
    const beats = parseInt(opts.timeSig, 10);
    const measureUnits = beats * 2;

    const { words, skipped } = parse(text);

    // Flatten letters.
    const letters = [];
    words.forEach((w, wi) =>
      w.forEach((l, i) => letters.push({ ...l, word: wi, lastInWord: i === w.length - 1 })));

    const melodyTonic = tonicAtOrAbove(key, inst.low);
    const idxToPos = idx => melodyTonic + 7 * Math.floor(idx / n) + steps[mod(idx, n)];

    // ---- 1. Rhythm: build the melody timeline. ----
    const melody = [];
    let t = 0;
    let nextId = 0;
    const addRest = len => {
      if (len <= 0) return;
      const last = melody[melody.length - 1];
      if (last && last.rest) { last.len += len; }
      else melody.push({ id: nextId++, start: t, len, rest: true });
      t += len;
    };
    letters.forEach((L, li) => {
      L.start = t;
      L.notes = [];
      [...L.code].forEach((sym, j) => {
        if (j > 0) addRest(rhythm.inner);
        const len = sym === '.' ? rhythm.dot : rhythm.dash;
        const ev = { id: nextId++, start: t, len, rest: false, sym, letterIndex: li, j };
        melody.push(ev);
        L.notes.push(ev);
        t += len;
      });
      L.end = t;
      if (li < letters.length - 1) addRest(L.lastInWord ? rhythm.word : rhythm.letter);
    });
    const total = Math.max(measureUnits, Math.ceil(t / measureUnits) * measureUnits);
    addRest(total - t);

    // ---- 2. Pitch: pick a note for every dot and dash. ----
    const lo = -Math.round(n * 0.45), hi = Math.round(n * 1.3);
    let walk = 0, first = true;
    letters.forEach((L, li) => {
      const chord = PROGRESSION[li % PROGRESSION.length];
      L.chord = chord;
      L.notes.forEach(ev => {
        let pos;
        switch (opts.pattern) {
          case 'arpeggio': {
            const tones = [0, 2, 4, 7, 9, 11, 14];
            pos = melodyTonic + MELODY_ROOT[chord] + tones[Math.min(ev.j, tones.length - 1)];
            break;
          }
          case 'contour': {
            let idx = first ? 0 : walk + (ev.sym === '.' ? 1 : -1);
            if (idx > hi) idx = walk - 1;
            if (idx < lo) idx = walk + 1;
            walk = idx;
            pos = idxToPos(idx);
            break;
          }
          case 'runs':
            pos = idxToPos((li % 5) + ev.j);
            break;
          case 'updown':
            pos = idxToPos(li % 2 === 0 ? ev.j : n - ev.j);
            break;
          case 'letters': {
            const a = /[A-Z]/.test(L.ch) ? L.ch.charCodeAt(0) - 65 : /[0-9]/.test(L.ch) ? 26 + +L.ch : 0;
            pos = idxToPos((a % n) + (ev.sym === '-' ? 2 : 0));
            break;
          }
        }
        first = false;
        ev.pos = [pos];
        ev.midi = [posToMidi(pos, key)];
      });
      if (opts.pattern !== 'arpeggio') {
        // Pick the I / IV / V / vi chord that contains the letter's first note.
        L.chord = HARMONIZE[mod(L.notes[0].pos[0] - melodyTonic, 7)];
      }
    });

    // ---- 3. Piano left hand: root + fifth held under each letter. ----
    let bass = null;
    if (opts.instrument === 'piano') {
      bass = [];
      const bassTonic = melodyTonic - 14;
      const down = bassTonic >= 21; // C3 or higher: put IV / V / vi below the tonic
      const ROOT = down ? { 0: 0, 5: -2, 3: -4, 4: -3 } : { 0: 0, 5: 5, 3: 3, 4: 4 };
      let bt = 0;
      const rest = len => {
        if (len > 0) { bass.push({ id: nextId++, start: bt, len, rest: true }); bt += len; }
      };
      letters.forEach((L, li) => {
        const next = letters[li + 1];
        let end;
        if (!next) end = total;
        else if (L.lastInWord) end = L.end;
        else end = next.start;
        rest(L.start - bt);
        const root = bassTonic + ROOT[L.chord];
        const pos = [root, root + 4];
        bass.push({ id: nextId++, start: bt, len: end - bt, rest: false, pos,
          midi: pos.map(p => posToMidi(p, key)), letterIndex: li });
        bt = end;
      });
      rest(total - bt);
    }

    const halfBarSplit = beats === 4;
    return {
      key, inst, rhythm, letters, words, skipped,
      total, measureUnits, timeSig: `${beats}/4`,
      melody, bass,
      melodyMeasures: splitIntoMeasures(melody, measureUnits, halfBarSplit, total),
      bassMeasures: bass ? splitIntoMeasures(bass, measureUnits, halfBarSplit, total) : null,
    };
  }

  // Can a note of `v` eighths be written starting `off` eighths into the bar?
  function fits(v, off) {
    if (v === 8 || v === 6) return off === 0;
    if (v === 4) return off % 4 === 0;
    if (v === 3 || v === 2) return off % 2 === 0;
    return v === 1;
  }

  // Break events into notatable pieces (8th, quarter, dotted quarter, half,
  // dotted half, whole) that never cross a bar line, tying notes as needed.
  function splitIntoMeasures(events, M, halfBarSplit, total) {
    const measures = Array.from({ length: total / M }, () => []);
    for (const ev of events) {
      const pieces = [];
      let s = ev.start, remain = ev.len;
      while (remain > 0) {
        const off = s % M;
        let boundary = M;
        if (halfBarSplit && off > 0 && off < M / 2) boundary = M / 2;
        let chunk = Math.min(remain, boundary - off);
        let o = off;
        while (chunk > 0) {
          let v = 1;
          if (o % 2 === 0) v = [8, 6, 4, 3, 2, 1].find(c => c <= chunk && fits(c, o));
          pieces.push({ ev, units: v, measure: Math.floor(s / M), offset: o });
          o += v; s += v; chunk -= v; remain -= v;
        }
      }
      pieces.forEach((p, i) => {
        p.tieNext = !ev.rest && i < pieces.length - 1;
        p.tieFromPrev = !ev.rest && i > 0;
        p.firstPiece = i === 0;
        measures[p.measure].push(p);
      });
    }
    return measures;
  }

  return { RHYTHMS, PATTERNS, compose };
})();

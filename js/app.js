(() => {
  const $ = id => document.getElementById(id);
  const { KEYS, SCALES, INSTRUMENTS, posToName } = Theory;
  const { RHYTHMS, PATTERNS } = Composer;

  const INST_TEXT = {
    flute: 'Flute reads treble clef. The melody sits around the middle of the flute\'s range (roughly G4 to G6), where it sounds sweetest.',
    cello: 'Cello reads bass clef. The melody sits in the cello\'s warm low-middle register (roughly G2 to G4). Very high cello passages would normally switch to tenor clef, but these stay low enough for bass clef.',
    piano: 'Piano reads a grand staff: treble clef for the right hand (the Morse melody) and bass clef for the left hand, which holds a simple two-note chord (root and fifth) under each letter.',
  };

  const fill = (sel, obj, labelOf) => {
    sel.innerHTML = Object.entries(obj)
      .map(([k, v]) => `<option value="${k}">${labelOf(v)}</option>`).join('');
  };
  fill($('instrument'), INSTRUMENTS, v => v.label);
  fill($('key'), KEYS, v => v.label);
  fill($('scale'), SCALES, v => v.label);
  fill($('pattern'), PATTERNS, v => v.label);
  fill($('rhythm'), RHYTHMS, v => v.label);

  const FIELDS = ['text', 'instrument', 'key', 'scale', 'pattern', 'rhythm', 'timeSig', 'bpm'];
  const DEFAULTS = { text: 'Matthew Cruikshank', instrument: 'flute', key: 'C', scale: 'full',
    pattern: 'arpeggio', rhythm: 'musical', timeSig: '4', bpm: '96' };

  // Load settings from the URL.
  const params = new URLSearchParams(location.search);
  FIELDS.forEach(f => {
    const v = params.get(f) ?? DEFAULTS[f];
    const input = $(f);
    if (input.tagName === 'SELECT' && ![...input.options].some(o => o.value === v)) return;
    input.value = v;
  });

  const settings = () => Object.fromEntries(FIELDS.map(f => [f, $(f).value]));

  let comp = null;
  let rendered = null;
  let active = { notes: new Set(), letter: -1 };

  function saveToUrl(s) {
    const p = new URLSearchParams();
    FIELDS.forEach(f => { if (s[f] !== DEFAULTS[f]) p.set(f, s[f]); });
    const q = p.toString();
    history.replaceState(null, '', q ? `?${q}` : location.pathname);
  }

  function rebuild() {
    const s = settings();
    const wasPlaying = Player.isPlaying();
    Player.stop();
    saveToUrl(s);
    $('bpmOut').textContent = s.bpm;

    comp = Composer.compose(s.text, s);
    $('sheetTitle').textContent = s.text.trim() || 'Untitled';
    $('sheetSub').textContent =
      `${INSTRUMENTS[s.instrument].label} · ${KEYS[s.key].label}` +
      `${s.scale === 'pentatonic' ? ' pentatonic' : ''} · ${PATTERNS[s.pattern].label}`;
    $('rhythmText').textContent = RHYTHMS[s.rhythm].describe;
    $('patternText').textContent = PATTERNS[s.pattern].describe +
      (s.pattern === 'arpeggio' && s.scale === 'pentatonic' ? ' (Arpeggios always use chord tones from the full scale.)' : '');
    $('instText').textContent = INST_TEXT[s.instrument];

    const warn = $('warning');
    warn.hidden = comp.skipped.length === 0;
    warn.textContent = comp.skipped.length ? `Skipped (no Morse code): ${comp.skipped.join(' ')}` : '';

    renderStrip();
    renderScore();
    if (wasPlaying) togglePlay();
  }

  function renderStrip() {
    const strip = $('morseStrip');
    strip.innerHTML = '';
    let li = 0;
    comp.words.forEach(word => {
      const w = document.createElement('div');
      w.className = 'strip-word';
      word.forEach(l => {
        const idx = li++;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.dataset.letter = idx;
        b.title = `Play from “${l.ch}”`;
        b.innerHTML = `<span class="chip-ch">${l.ch}</span><span class="chip-code">${
          [...l.code].map(c => `<i class="${c === '.' ? 'dot' : 'dash'}"></i>`).join('')}</span>`;
        b.addEventListener('click', () => playFrom(idx));
        w.appendChild(b);
      });
      strip.appendChild(w);
    });
  }

  function renderScore() {
    clearHighlight();
    const box = $('score');
    if (!comp.letters.length) {
      box.innerHTML = '<p class="empty">Type some letters or numbers above.</p>';
      rendered = null;
      return;
    }
    rendered = Score.render(box, comp, { onLetterClick: playFrom });
    // Note names as tooltips.
    comp.melody.forEach(ev => {
      if (ev.rest) return;
      (rendered.notes.get(ev.id) || []).forEach(g => {
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        t.textContent = `${comp.letters[ev.letterIndex].ch}: ${ev.sym === '.' ? 'dot' : 'dash'} · ${posToName(ev.pos[0], comp.key)}`;
        g.appendChild(t);
      });
    });
  }

  // ---- Highlighting ----
  function clearHighlight() {
    document.querySelectorAll('.playing').forEach(e => e.classList.remove('playing'));
    active = { notes: new Set(), letter: -1 };
  }

  function findActive(events, u) {
    for (const ev of events) {
      if (ev.start > u) break;
      if (!ev.rest && u < ev.start + ev.len) return ev;
    }
    return null;
  }

  function onTick(u) {
    if (!rendered) return;
    const now = new Set();
    const m = findActive(comp.melody, u);
    if (m) now.add(m.id);
    if (comp.bass) { const b = findActive(comp.bass, u); if (b) now.add(b.id); }

    active.notes.forEach(id => {
      if (!now.has(id)) (rendered.notes.get(id) || []).forEach(e => e.classList.remove('playing'));
    });
    now.forEach(id => {
      if (!active.notes.has(id)) (rendered.notes.get(id) || []).forEach(e => e.classList.add('playing'));
    });
    active.notes = now;

    const letter = m ? m.letterIndex : -1;
    if (letter !== active.letter) {
      document.querySelectorAll('.chip.playing, .letter-label.playing').forEach(e => e.classList.remove('playing'));
      if (letter >= 0) {
        document.querySelector(`.chip[data-letter="${letter}"]`)?.classList.add('playing');
        const labels = rendered.labels.get(letter) || [];
        labels.forEach(e => e.classList.add('playing'));
        const line = labels[0]?.closest('.score-line');
        if (line) scrollIntoViewIfNeeded(line);
      }
      active.letter = letter;
    }
  }

  function scrollIntoViewIfNeeded(node) {
    const r = node.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // ---- Transport ----
  function setPlayingUi(on) {
    $('play').classList.toggle('is-playing', on);
    $('play').querySelector('.label').textContent = on ? 'Stop' : 'Play';
    $('play').setAttribute('aria-label', on ? 'Stop' : 'Play');
  }

  function start(fromUnit) {
    if (!comp || !comp.letters.length) return;
    clearHighlight();
    const s = settings();
    Player.play(comp, {
      instrument: s.instrument,
      bpm: +s.bpm,
      fromUnit,
      onTick,
      onEnd: () => { clearHighlight(); setPlayingUi(false); },
    });
    setPlayingUi(true);
  }

  function togglePlay() {
    if (Player.isPlaying()) Player.stop();
    else start(0);
  }

  function playFrom(letterIndex) {
    start(comp.letters[letterIndex].start);
  }

  $('play').addEventListener('click', togglePlay);
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !/INPUT|SELECT|BUTTON|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault();
      togglePlay();
    }
  });

  let typingTimer;
  $('text').addEventListener('input', () => { clearTimeout(typingTimer); typingTimer = setTimeout(rebuild, 250); });
  ['instrument', 'key', 'scale', 'pattern', 'rhythm', 'timeSig'].forEach(f => $(f).addEventListener('change', rebuild));
  $('bpm').addEventListener('input', () => {
    $('bpmOut').textContent = $('bpm').value;
    saveToUrl(settings());
  });
  $('bpm').addEventListener('change', () => { if (Player.isPlaying()) { Player.stop(); start(0); } });

  let lastWidth = 0, resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const w = $('score').clientWidth;
      if (comp && w !== lastWidth) { lastWidth = w; renderScore(); }
    }, 150);
  });

  rebuild();
  lastWidth = $('score').clientWidth;
})();

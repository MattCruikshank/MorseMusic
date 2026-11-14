// Draws a composition as sheet music with VexFlow, one SVG per system (line).
window.Score = (() => {
  const VF = Vex.Flow;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const DUR = { 1: '8', 2: 'q', 3: 'qd', 4: 'h', 6: 'hd', 8: 'w' };
  const REST_KEY = { treble: 'b/4', bass: 'd/3' };
  const WEIGHT = { 1: 26, 2: 30, 3: 36, 4: 40, 6: 44, 8: 48 };
  const SIDE = 12;

  // Vertical position of a note relative to its stave's y (VexFlow defaults:
  // top staff line at +40, bottom staff line at +80, 5px per diatonic step).
  function yRel(p, clef) {
    const bottomLinePos = clef === 'bass' ? 18 /* G2 */ : 30 /* E4 */;
    return 80 - 5 * (p - bottomLinePos);
  }

  // Rough ink extents of a stave's notes, relative to stave y.
  function extents(segs, clef) {
    let top = 28, bottom = 92;
    for (const s of segs) {
      if (s.ev.rest) continue;
      for (const p of s.ev.pos) {
        const y = yRel(p, clef);
        const stemDown = y < 60;
        top = Math.min(top, y - (stemDown ? 10 : 40));
        bottom = Math.max(bottom, y + (stemDown ? 40 : 10));
      }
    }
    return { top, bottom };
  }

  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function makeNote(seg, clef) {
    const rest = seg.ev.rest;
    const note = new VF.StaveNote({
      keys: rest ? [REST_KEY[clef]] : seg.ev.pos.map(Theory.posToVexKey),
      duration: DUR[seg.units] + (rest ? 'r' : ''),
      clef,
      auto_stem: !rest,
    });
    if (seg.units === 3 || seg.units === 6) VF.Dot.buildAndAttach([note], { all: true });
    return note;
  }

  /**
   * Render `comp` into `container`.
   * Returns { notes: Map(eventId -> [svg elements]), labels: Map(letterIndex -> [svg elements]) }.
   */
  function render(container, comp, { onLetterClick } = {}) {
    container.innerHTML = '';
    const W = Math.max(240, container.clientWidth);
    const avail = W - SIDE * 2;
    const clefs = comp.inst.clefs;
    const staffMeasures = [comp.melodyMeasures, comp.bassMeasures].slice(0, clefs.length);
    const numMeasures = comp.melodyMeasures.length;
    const accCount = Object.keys(comp.key.acc).length;

    // ---- Decide how many measures go on each line. ----
    const est = [];
    for (let m = 0; m < numMeasures; m++) {
      est.push(Math.max(...staffMeasures.map(ms =>
        24 + ms[m].reduce((a, s) => a + WEIGHT[s.units], 0))));
    }
    const lines = [];
    let cur = null;
    for (let m = 0; m < numMeasures; m++) {
      const lead = 46 + accCount * 11 + (lines.length === 0 ? 30 : 0);
      if (!cur || cur.width + est[m] > avail || cur.measures.length >= 5) {
        cur = { measures: [], width: lead, lead };
        lines.push(cur);
      }
      cur.measures.push(m);
      cur.width += est[m];
    }

    const result = { notes: new Map(), labels: new Map() };
    const add = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };

    lines.forEach((line, lineIndex) => {
      let scale = avail / line.width;
      if (lineIndex === lines.length - 1 && lineIndex > 0) scale = Math.min(scale, 1.25);
      if (lineIndex === 0 && lines.length === 1) scale = Math.min(scale, 1.6);

      // ---- Vertical layout for this line. ----
      const segsOf = si => line.measures.flatMap(m => staffMeasures[si][m]);
      const ext = clefs.map((c, si) => extents(segsOf(si), c));
      const ys = [12 - ext[0].top];
      const labelTop = ys[0] + ext[0].bottom + 2;
      const labelBottom = labelTop + 42;
      let height = labelBottom + 8;
      if (clefs.length > 1) {
        ys.push(labelBottom + 4 - ext[1].top);
        height = ys[1] + ext[1].bottom + 8;
      }

      const div = document.createElement('div');
      div.className = 'score-line';
      container.appendChild(div);
      const renderer = new VF.Renderer(div, VF.Renderer.Backends.SVG);
      renderer.resize(W, height);
      const ctx = renderer.getContext();
      const svg = div.querySelector('svg');

      // Per staff, the notes in this line in order (for ties).
      const lineNotes = clefs.map(() => []);
      let x = SIDE;

      line.measures.forEach((m, k) => {
        const w = (est[m] + (k === 0 ? line.lead : 0)) * scale;
        const staves = clefs.map((clef, si) => {
          const s = new VF.Stave(x, ys[si], w);
          if (k === 0) {
            s.addClef(clef).addKeySignature(comp.key.vf);
            if (lineIndex === 0) s.addTimeSignature(comp.timeSig);
          }
          if (m === numMeasures - 1) s.setEndBarType(VF.Barline.type.END);
          s.setContext(ctx);
          return s;
        });
        if (staves.length > 1) {
          const startX = Math.max(...staves.map(s => s.getNoteStartX()));
          staves.forEach(s => s.setNoteStartX(startX));
        }
        staves.forEach(s => s.draw());

        if (staves.length > 1) {
          const conn = type => new VF.StaveConnector(staves[0], staves[1]).setType(type).setContext(ctx).draw();
          if (k === 0) { conn(VF.StaveConnector.type.BRACE); conn(VF.StaveConnector.type.SINGLE_LEFT); }
          conn(m === numMeasures - 1 ? VF.StaveConnector.type.BOLD_DOUBLE_RIGHT : VF.StaveConnector.type.SINGLE_RIGHT);
        }

        const voices = [], allBeams = [], noteLists = [];
        clefs.forEach((clef, si) => {
          const segs = staffMeasures[si][m];
          const notes = segs.map(seg => makeNote(seg, clef));
          notes.forEach(n => n.setStave(staves[si]));
          const voice = new VF.Voice({ num_beats: comp.measureUnits / 2, beat_value: 4 })
            .setMode(VF.Voice.Mode.SOFT).addTickables(notes);
          const beams = VF.Beam.generateBeams(notes, { groups: VF.Beam.getDefaultBeamGroups(comp.timeSig) });
          voices.push(voice); allBeams.push(...beams); noteLists.push(notes);
          segs.forEach((seg, i) => lineNotes[si].push({ seg, note: notes[i] }));
        });

        const fmt = new VF.Formatter();
        voices.forEach(v => fmt.joinVoices([v]));
        fmt.format(voices, staves[0].getNoteEndX() - staves[0].getNoteStartX() - 12);
        voices.forEach((v, si) => v.draw(ctx, staves[si]));
        allBeams.forEach(b => b.setContext(ctx).draw());

        x += w;
      });

      // ---- Ties (including half-ties across line breaks). ----
      lineNotes.forEach(list => {
        list.forEach(({ seg, note }, i) => {
          const idx = seg.ev.pos ? seg.ev.pos.map((_, j) => j) : [0];
          const tie = (a, b) => new VF.StaveTie({ first_note: a, last_note: b, first_indices: idx, last_indices: idx })
            .setContext(ctx).draw();
          if (seg.tieNext) tie(note, i + 1 < list.length ? list[i + 1].note : null);
          if (i === 0 && seg.tieFromPrev) tie(null, note);
        });
      });

      // ---- Register note elements for highlighting. ----
      lineNotes.forEach(list => list.forEach(({ seg, note }) => {
        if (seg.ev.rest) return;
        const g = note.getSVGElement();
        if (g) add(result.notes, seg.ev.id, g);
      }));

      // ---- Morse symbols and letters under the melody. ----
      const byLetter = new Map();
      lineNotes[0].forEach(({ seg, note }) => {
        if (seg.ev.rest) return;
        if (!byLetter.has(seg.ev.letterIndex)) byLetter.set(seg.ev.letterIndex, []);
        byLetter.get(seg.ev.letterIndex).push({ seg, note });
      });
      const symY = labelTop + 9, bracketY = labelTop + 18, letterY = labelTop + 36;
      byLetter.forEach((items, li) => {
        const g = el('g', { class: 'letter-label', 'data-letter': li }, svg);
        let minX = Infinity, maxX = -Infinity;
        items.forEach(({ seg, note }) => {
          const x0 = note.getNoteHeadBeginX(), x1 = note.getNoteHeadEndX();
          minX = Math.min(minX, x0); maxX = Math.max(maxX, x1);
          if (!seg.firstPiece) return;
          const cx = (x0 + x1) / 2;
          const sym = seg.ev.sym === '.'
            ? el('circle', { cx, cy: symY, r: 2.6 }, g)
            : el('rect', { x: cx - 7, y: symY - 2.2, width: 14, height: 4.4, rx: 2.2 }, g);
          sym.setAttribute('class', 'morse-sym');
          sym.dataset.ev = seg.ev.id;
          add(result.notes, seg.ev.id, sym);
        });
        if (items.length > 1) {
          el('path', { class: 'bracket', d: `M${minX} ${bracketY - 3} V${bracketY} H${maxX} V${bracketY - 3}` }, g);
        }
        const text = el('text', { x: (minX + maxX) / 2, y: letterY, 'text-anchor': 'middle', class: 'letter-text' }, g);
        text.textContent = comp.letters[li].ch;
        el('rect', { class: 'hit', x: minX - 6, y: labelTop, width: maxX - minX + 12, height: 42 }, g);
        if (onLetterClick) g.addEventListener('click', () => onLetterClick(li));
        add(result.labels, li, g);
      });
    });

    return result;
  }

  return { render };
})();

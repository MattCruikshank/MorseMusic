// Small Web Audio synths for flute, cello and piano, plus a scheduler.
window.Player = (() => {
  let ctx = null;
  let session = null;
  let noiseBuffer = null;

  const freq = m => 440 * Math.pow(2, (m - 69) / 12);

  function ensureContext() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function vibrato(target, f, t, rate, depth, delay) {
    const lfo = ctx.createOscillator();
    const g = ctx.createGain();
    lfo.frequency.value = rate;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(f * depth, t + delay);
    lfo.connect(g);
    target.forEach(o => g.connect(o.frequency));
    return lfo; // caller starts and stops it
  }

  const VOICES = {
    flute(out, m, t, dur, vel) {
      const f = freq(m), end = t + dur;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.32 * vel, t + 0.045);
      env.gain.linearRampToValueAtTime(0.26 * vel, t + 0.12);
      env.gain.setValueAtTime(0.26 * vel, end);
      env.gain.linearRampToValueAtTime(0, end + 0.08);
      env.connect(out);

      const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f;
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
      const g2 = ctx.createGain(); g2.gain.value = 0.12;
      o1.connect(env); o2.connect(g2); g2.connect(env);
      const lfo = vibrato([o1], f, t, 5, 0.006, 0.3);

      // A puff of breath at the start of the note.
      const n = ctx.createBufferSource(); n.buffer = noiseBuffer;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 1.5;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.06 * vel, t);
      ng.gain.exponentialRampToValueAtTime(0.004 * vel + 0.0001, t + 0.1);
      ng.gain.linearRampToValueAtTime(0, end + 0.05);
      n.connect(bp); bp.connect(ng); ng.connect(out);

      [o1, o2, lfo, n].forEach(s => { s.start(t); s.stop(end + 0.15); });
    },

    cello(out, m, t, dur, vel) {
      const f = freq(m), end = t + dur;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.2 * vel, t + 0.07);
      env.gain.linearRampToValueAtTime(0.16 * vel, t + 0.2);
      env.gain.setValueAtTime(0.16 * vel, end);
      env.gain.linearRampToValueAtTime(0, end + 0.15);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = Math.min(2400, f * 9); lp.Q.value = 0.8;
      const body = ctx.createBiquadFilter(); body.type = 'peaking';
      body.frequency.value = 280; body.gain.value = 5; body.Q.value = 1.2;
      lp.connect(body); body.connect(env); env.connect(out);

      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f; o1.detune.value = -4;
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f; o2.detune.value = 4;
      o1.connect(lp); o2.connect(lp);
      const lfo = vibrato([o1, o2], f, t, 5.5, 0.005, 0.25);
      [o1, o2, lfo].forEach(s => { s.start(t); s.stop(end + 0.2); });
    },

    piano(out, m, t, dur, vel) {
      const f = freq(m), end = t + dur;
      const decay = Math.max(0.6, 2.6 - (m - 48) * 0.03);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.32 * vel, t + 0.006);
      env.gain.setTargetAtTime(0, t + 0.006, decay / 3.5);
      env.gain.cancelScheduledValues(end);
      env.gain.setTargetAtTime(0, end, 0.06);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(Math.min(9000, f * 8), t);
      lp.frequency.setTargetAtTime(Math.min(4000, f * 3), t, 0.3);
      lp.connect(env); env.connect(out);
      const partials = [[1, 'triangle', 1], [2, 'sine', 0.35], [3, 'sine', 0.12], [4, 'sine', 0.05]];
      partials.forEach(([h, type, g]) => {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * h;
        o.detune.value = (h - 1) * 1.5;
        const og = ctx.createGain(); og.gain.value = g;
        o.connect(og); og.connect(lp);
        o.start(t); o.stop(end + 0.5);
      });
    },
  };

  /**
   * Play a composition.
   * opts: { instrument, bpm, fromUnit, onTick(unit), onEnd() }
   */
  function play(comp, opts) {
    stop();
    ensureContext();
    const unit = 60 / opts.bpm / 2; // seconds per eighth note
    const from = opts.fromUnit || 0;
    const t0 = ctx.currentTime + 0.12 - from * unit;

    const master = ctx.createGain();
    master.gain.value = 0.9;
    const comp_ = ctx.createDynamicsCompressor();
    master.connect(comp_); comp_.connect(ctx.destination);

    const voice = VOICES[opts.instrument];
    const schedule = (events, vel, legato) => events.forEach(ev => {
      if (ev.rest || ev.start < from) return;
      const dur = ev.len * unit * legato;
      ev.midi.forEach(m => {
        try { voice(master, m, t0 + ev.start * unit, dur, vel); }
        catch (e) { console.error('Could not schedule note', m, e); }
      });
    });
    schedule(comp.melody, 1, opts.instrument === 'piano' ? 0.95 : 0.9);
    if (comp.bass) schedule(comp.bass, 0.55, 0.98);

    const s = { master, t0, unit, raf: 0, onEnd: opts.onEnd };
    session = s;
    const tick = () => {
      if (session !== s) return;
      const u = (ctx.currentTime - t0) / unit;
      if (u >= comp.total + 1) { stop(); return; }
      opts.onTick && opts.onTick(u);
      s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
  }

  function stop() {
    if (!session) return;
    const s = session;
    session = null;
    cancelAnimationFrame(s.raf);
    const now = ctx.currentTime;
    s.master.gain.cancelScheduledValues(now);
    s.master.gain.setValueAtTime(s.master.gain.value, now);
    s.master.gain.linearRampToValueAtTime(0, now + 0.05);
    setTimeout(() => s.master.disconnect(), 200);
    s.onEnd && s.onEnd();
  }

  return { play, stop, isPlaying: () => !!session };
})();

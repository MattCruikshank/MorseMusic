// Music theory helpers.
//
// Pitches are tracked as "diatonic positions": p = octave * 7 + letterIndex,
// where letterIndex is C=0, D=1, E=2, F=3, G=4, A=5, B=6.  So C4 = 28, A4 = 33.
// Every note we write is in the key, so the key signature supplies the sharps
// and flats on the page, and `acc` below supplies them for playback.
window.Theory = (() => {
  const LETTERS = 'CDEFGAB';
  const SEMITONES = [0, 2, 4, 5, 7, 9, 11];

  const KEYS = {
    C:  { label: 'C major',  vf: 'C',  tonic: 0, minor: false, acc: {} },
    G:  { label: 'G major',  vf: 'G',  tonic: 4, minor: false, acc: { 3: 1 } },
    D:  { label: 'D major',  vf: 'D',  tonic: 1, minor: false, acc: { 3: 1, 0: 1 } },
    F:  { label: 'F major',  vf: 'F',  tonic: 3, minor: false, acc: { 6: -1 } },
    Bb: { label: 'B♭ major', vf: 'Bb', tonic: 6, minor: false, acc: { 6: -1, 2: -1 } },
    Am: { label: 'A minor',  vf: 'Am', tonic: 5, minor: true,  acc: {} },
    Em: { label: 'E minor',  vf: 'Em', tonic: 2, minor: true,  acc: { 3: 1 } },
    Dm: { label: 'D minor',  vf: 'Dm', tonic: 1, minor: true,  acc: { 6: -1 } },
  };

  // Scale "flavors" as diatonic steps above the tonic.
  const SCALES = {
    full:       { label: 'Full scale (7 notes)', major: [0, 1, 2, 3, 4, 5, 6], minor: [0, 1, 2, 3, 4, 5, 6] },
    pentatonic: { label: 'Pentatonic (5 notes)', major: [0, 1, 2, 4, 5],       minor: [0, 2, 3, 4, 6] },
  };

  // Clef and comfortable range for each instrument.  `low` is the lowest
  // diatonic position the tonic may sit on; melodies are built around it.
  const INSTRUMENTS = {
    flute: { label: 'Flute', clefs: ['treble'],         low: 32 /* G4 */ },
    cello: { label: 'Cello', clefs: ['bass'],           low: 17 /* F2 */ },
    piano: { label: 'Piano', clefs: ['treble', 'bass'], low: 30 /* E4 */ },
  };

  const mod = (n, m) => ((n % m) + m) % m;

  function posToMidi(p, key) {
    const letter = mod(p, 7);
    const octave = Math.floor(p / 7);
    return 12 * (octave + 1) + SEMITONES[letter] + (key.acc[letter] || 0);
  }

  function posToVexKey(p) {
    return LETTERS[mod(p, 7)].toLowerCase() + '/' + Math.floor(p / 7);
  }

  function posToName(p, key) {
    const letter = mod(p, 7);
    const a = key.acc[letter] || 0;
    return LETTERS[letter] + (a > 0 ? '♯' : a < 0 ? '♭' : '') + Math.floor(p / 7);
  }

  // Lowest diatonic position >= low whose letter is the key's tonic.
  function tonicAtOrAbove(key, low) {
    let p = low;
    while (mod(p, 7) !== key.tonic) p++;
    return p;
  }

  return { LETTERS, KEYS, SCALES, INSTRUMENTS, mod, posToMidi, posToVexKey, posToName, tonicAtOrAbove };
})();

// Retour sonore et tactile après un scan (F-54) : l'agent sait sans regarder si le passage est accepté.

export type Feedback = 'accepted' | 'refused' | 'warning';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    ctx ??= new Ctx();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(c: AudioContext, frequency: number, start: number, duration: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  // Attaque et extinction douces : pas de claquement
  gain.gain.setValueAtTime(0, c.currentTime + start);
  gain.gain.linearRampToValueAtTime(0.18, c.currentTime + start + 0.01);
  gain.gain.linearRampToValueAtTime(0, c.currentTime + start + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + duration + 0.02);
}

/** Accepté : un bip aigu et bref. Refusé : deux bips graves. Avertissement : un bip moyen. */
export function signal(kind: Feedback, sound: boolean) {
  navigator.vibrate?.(kind === 'accepted' ? 80 : kind === 'refused' ? [90, 60, 90] : [60, 40, 60]);
  if (!sound) return;
  const c = audio();
  if (!c) return;
  if (kind === 'accepted') tone(c, 1046, 0, 0.12);
  else if (kind === 'refused') { tone(c, 330, 0, 0.14); tone(c, 330, 0.2, 0.14); }
  else tone(c, 587, 0, 0.18);
}

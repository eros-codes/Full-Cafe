import { useSyncExternalStore } from 'react';
import { safeStorage } from '../../../shared/storage';

// Short sounds made on the phone itself (Web Audio: no sound files to download). Browsers only allow sound
// after a tap, so `unlockAudio()` is called from the buttons that start a game or a turn.

export type SoundName = 'tap' | 'tick' | 'correct' | 'pass' | 'buzz' | 'reveal' | 'win';

const MUTE_KEY = 'roof.games.muted';
let ctx: AudioContext | null = null;
let muted = safeStorage.get(MUTE_KEY) === '1';
const listeners = new Set<() => void>();

type AudioContextClass = typeof AudioContext;

export function unlockAudio(): void {
	try {
		if (ctx?.state === 'closed') ctx = null;
		if (!ctx) {
			const Ctor: AudioContextClass | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
			if (!Ctor) return;
			ctx = new Ctor();
		}
		// iPhones also leave it «interrupted» after a call or locking the screen
		if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
	} catch {
		ctx = null;
	}
}

/**
 * Any tap on the page (re)starts the sound: after a reload in the middle of a game, or when the phone comes back
 * from a call or the lock screen, there is no «start» button to press first. Returns the cleanup.
 */
export function installAudioUnlock(): () => void {
	const onTap = () => {
		if (!ctx || ctx.state !== 'running') unlockAudio();
	};
	document.addEventListener('pointerdown', onTap, { capture: true, passive: true });
	document.addEventListener('keydown', onTap, { capture: true });
	return () => {
		document.removeEventListener('pointerdown', onTap, { capture: true });
		document.removeEventListener('keydown', onTap, { capture: true });
	};
}

export function setMuted(value: boolean): void {
	muted = value;
	safeStorage.set(MUTE_KEY, value ? '1' : '0');
	listeners.forEach((listener) => listener());
}

/** Whether the sounds are off (the switch in the game bar). */
export function useMuted(): boolean {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => muted,
	);
}

interface Note {
	freq: number;
	/** Start, from now (s). */
	at: number;
	dur: number;
	type?: OscillatorType;
	gain?: number;
	/** Glide to this frequency by the end. */
	to?: number;
}

const SOUNDS: Record<SoundName, Note[]> = {
	tap: [{ freq: 660, at: 0, dur: 0.05, gain: 0.08 }],
	tick: [{ freq: 1250, at: 0, dur: 0.04, type: 'square', gain: 0.05 }],
	correct: [
		{ freq: 660, at: 0, dur: 0.1, type: 'triangle', gain: 0.22 },
		{ freq: 990, at: 0.09, dur: 0.16, type: 'triangle', gain: 0.22 },
	],
	pass: [{ freq: 360, at: 0, dur: 0.22, type: 'sine', gain: 0.2, to: 240 }],
	buzz: [{ freq: 150, at: 0, dur: 0.55, type: 'sawtooth', gain: 0.16, to: 110 }],
	reveal: [
		{ freq: 520, at: 0, dur: 0.12, type: 'sine', gain: 0.14 },
		{ freq: 780, at: 0.1, dur: 0.18, type: 'sine', gain: 0.12 },
	],
	win: [
		{ freq: 523, at: 0, dur: 0.14, type: 'triangle', gain: 0.2 },
		{ freq: 659, at: 0.13, dur: 0.14, type: 'triangle', gain: 0.2 },
		{ freq: 784, at: 0.26, dur: 0.14, type: 'triangle', gain: 0.2 },
		{ freq: 1047, at: 0.39, dur: 0.36, type: 'triangle', gain: 0.22 },
	],
};

export function playSound(name: SoundName): void {
	if (muted || !ctx || ctx.state !== 'running') return;
	try {
		const start = ctx.currentTime + 0.01;
		for (const note of SOUNDS[name]) {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = note.type ?? 'sine';
			osc.frequency.setValueAtTime(note.freq, start + note.at);
			if (note.to) osc.frequency.linearRampToValueAtTime(note.to, start + note.at + note.dur);
			const peak = note.gain ?? 0.15;
			gain.gain.setValueAtTime(0.0001, start + note.at);
			gain.gain.exponentialRampToValueAtTime(peak, start + note.at + 0.012);
			gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.dur);
			osc.connect(gain).connect(ctx.destination);
			osc.start(start + note.at);
			osc.stop(start + note.at + note.dur + 0.02);
		}
	} catch {
		/* no sound, no problem */
	}
}

/** A short buzz on phones that can (Android); silently nothing elsewhere. */
export function vibrate(pattern: number | number[]): void {
	if (muted) return;
	try {
		navigator.vibrate?.(pattern);
	} catch {
		/* not supported */
	}
}

// «گوشی رو پیشونی»: reading the tilt of the phone held on the forehead, screen towards the friends.
//
// From the orientation angles (deviceorientation: beta, gamma in degrees) we take how much the screen faces
// up: cos(beta)·cos(gamma), between 1 (lying on its back) and −1 (face down). It is 0 when the phone stands
// upright, in portrait or in landscape, either way round, so it needs no calibration:
//   nod down (screen to the floor)   → below −TRIGGER  → correct
//   head back (screen to the ceiling) → above +TRIGGER  → pass
// Then the phone has to come back near upright (|value| < REARM) before the next tilt counts.

export const TRIGGER = 0.5;
export const REARM = 0.3;
/** The tilt must last this long (a shaking hand is not an answer). */
export const HOLD_MS = 80;
/** Upright for this long = ready to start. */
export const UPRIGHT_MS = 500;

export function faceUp(beta: number, gamma: number): number {
	const rad = Math.PI / 180;
	return Math.cos(beta * rad) * Math.cos(gamma * rad);
}

export interface TiltState {
	armed: boolean;
	/** The tilt being held: which way, since when. */
	pending: { dir: 'correct' | 'pass'; since: number } | null;
}

export const initialTilt = (): TiltState => ({ armed: false, pending: null });

/** One reading → the new state, and an answer when a tilt was completed. */
export function tiltStep(state: TiltState, value: number, now: number): { state: TiltState; event: 'correct' | 'pass' | null } {
	if (!state.armed) {
		return { state: { armed: Math.abs(value) < REARM, pending: null }, event: null };
	}
	const dir = value <= -TRIGGER ? 'correct' : value >= TRIGGER ? 'pass' : null;
	if (!dir) return { state: { armed: true, pending: null }, event: null };
	if (!state.pending || state.pending.dir !== dir) return { state: { armed: true, pending: { dir, since: now } }, event: null };
	if (now - state.pending.since < HOLD_MS) return { state, event: null };
	return { state: { armed: false, pending: null }, event: dir };
}

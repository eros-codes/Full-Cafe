import { useEffect, useRef, useState } from 'react';
import { safeStorage } from '../../../shared/storage';
import type { GameKey } from '../data';

// Every game keeps its whole state on the phone while it is played: a reload, a call or a trip to another
// app does not lose the game. A save older than MAX_AGE is dropped (that table has long gone home).

const PREFIX = 'roof.games.save.';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

interface Saved<T> {
	/** Shape version of the game's state: a new version ignores old saves. */
	v: number;
	at: number;
	/** In the middle of a game (the games page shows «ادامه‌ی بازی»). */
	live: boolean;
	state: T;
}

export interface SaveOptions<T> {
	/** Whether a restored save has the shape this build of the game expects (anything else starts fresh). */
	isValid?: (state: unknown) => boolean;
	/** Adjusts a restored save before it is used (e.g. close a card that was open when the page went away). */
	restore?: (state: T) => T;
}

function read<T>(game: GameKey, version: number, isValid?: (state: unknown) => boolean): Saved<T> | null {
	try {
		const saved = JSON.parse(safeStorage.get(PREFIX + game) || 'null') as Saved<T> | null;
		if (!saved || saved.v !== version || Date.now() - saved.at > MAX_AGE_MS) return null;
		// A save from an older build with the same version number (or edited by hand) would crash the game on
		// its first render and leave a blank page every time it is opened: start the game fresh instead.
		if (isValid && !isValid(saved.state)) {
			clearSave(game);
			return null;
		}
		return saved;
	} catch {
		return null;
	}
}

/** Whether a game was left in the middle (any version: only for the «ادامه‌ی بازی» mark). */
export function hasLiveSave(game: GameKey): boolean {
	try {
		const saved = JSON.parse(safeStorage.get(PREFIX + game) || 'null') as Saved<unknown> | null;
		return Boolean(saved?.live && Date.now() - saved.at <= MAX_AGE_MS);
	} catch {
		return false;
	}
}

export function clearSave(game: GameKey): void {
	safeStorage.remove(PREFIX + game);
}

/**
 * The game's state, restored from the phone when there is a save, and saved again on every change.
 * `isLive(state)` says whether it is in the middle of a game.
 */
export function useSavedGame<T>(game: GameKey, version: number, initial: () => T, isLive: (state: T) => boolean, options: SaveOptions<T> = {}) {
	const [state, setState] = useState<T>(() => {
		const saved = read<T>(game, version, options.isValid)?.state;
		if (saved === undefined) return initial();
		try {
			return options.restore ? options.restore(saved) : saved;
		} catch {
			clearSave(game);
			return initial();
		}
	});
	const live = useRef(isLive);
	live.current = isLive;
	useEffect(() => {
		safeStorage.set(PREFIX + game, JSON.stringify({ v: version, at: Date.now(), live: live.current(state), state } satisfies Saved<T>));
	}, [game, version, state]);
	return [state, setState] as const;
}

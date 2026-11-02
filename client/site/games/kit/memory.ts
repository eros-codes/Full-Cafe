import { safeStorage } from '../../../shared/storage';
import type { GameKey } from '../data';

// What the phone remembers between games, so the next game at the same table starts quicker: the players'
// names, the team names and each game's chosen decks.

const NAMES_KEY = { players: 'roof.games.players', teams: 'roof.games.teams' } as const;

function readList<T>(key: string, valid: (value: unknown) => value is T): T[] {
	try {
		const value = JSON.parse(safeStorage.get(key) || '[]');
		return Array.isArray(value) ? value.filter(valid) : [];
	} catch {
		return [];
	}
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isId = (value: unknown): value is number => Number.isInteger(value);

/** The names used last time (at least `min` fields, at most `max`). */
export function rememberedNames(kind: keyof typeof NAMES_KEY, min: number, max: number): string[] {
	const names = readList(NAMES_KEY[kind], isString).slice(0, max);
	while (names.length < min) names.push('');
	return names;
}

export function rememberNames(kind: keyof typeof NAMES_KEY, names: readonly string[]): void {
	safeStorage.set(NAMES_KEY[kind], JSON.stringify(names.map((name) => name.trim())));
}

export const rememberedDecks = (game: GameKey): number[] => readList(`roof.games.decks.${game}`, isId);

export function rememberDecks(game: GameKey, ids: readonly number[]): void {
	safeStorage.set(`roof.games.decks.${game}`, JSON.stringify(ids));
}

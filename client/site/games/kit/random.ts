// Randomness of the games, with the random source as a parameter so the tests can fix it.

export type Rng = () => number;

export const randomInt = (max: number, rng: Rng = Math.random) => Math.floor(rng() * max);

/** A shuffled copy (Fisher–Yates). */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = randomInt(i + 1, rng);
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

export const pickOne = <T>(items: readonly T[], rng: Rng = Math.random): T => items[randomInt(items.length, rng)];

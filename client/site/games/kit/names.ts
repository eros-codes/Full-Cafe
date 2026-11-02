import { faDigits } from '../../../shared/format.js';

// Names and numbers as the games show them. Pure (used by the tests too).

export const fa = (value: number | string) => faDigits(value);

/**
 * The names to play with: an empty field becomes its placeholder («بازیکن ۳»), and a repeated name gets a
 * number («سارا ۲»), so every player can be told apart when the phone is passed around.
 */
export function finalNames(names: readonly string[], placeholder: (index: number) => string): string[] {
	const result: string[] = [];
	names.forEach((raw, index) => {
		const base = raw.trim().replace(/\s+/g, ' ') || placeholder(index);
		let name = base;
		for (let n = 2; result.includes(name); n++) name = `${base} ${fa(n)}`;
		result.push(name);
	});
	return result;
}

/** «سارا و علی» · «سارا، علی و رضا» */
export function joinNames(names: readonly string[]): string {
	if (names.length < 2) return names.join('');
	return `${names.slice(0, -1).join('، ')} و ${names[names.length - 1]}`;
}

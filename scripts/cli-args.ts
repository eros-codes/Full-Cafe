// Options of the npm scripts that change data (map:apply, images:webp, db:export-tables).
// Before, an option a script did not know was simply ignored, so a mistyped «--dry-run» ran the script for real.
// The usual way that happens: a long dash (—) instead of two hyphens, from autocorrect or from copying formatted text.

/** The options given, or the problem with them (an option the script does not know). */
export function parseOptions(args: readonly string[], known: readonly string[]): { options: Set<string>; problem: string | null } {
	const unknown = args.filter((arg) => !known.includes(arg));
	if (!unknown.length) return { options: new Set(args), problem: null };
	const dash = unknown.some((arg) => /^[‐-―−]/.test(arg));
	const lines = [`Unknown option: ${unknown.join(' ')}. Nothing was changed.`];
	if (dash) lines.push('It starts with a long dash (—): type two plain hyphens instead («-- --dry-run», not «— —dry-run»)');
	lines.push(`Options: ${known.join(', ')}`);
	return { options: new Set(), problem: lines.join('\n') };
}

/** The script's options from the command line; stops the script (before it touches anything) on an unknown one. */
export function requireOptions(known: readonly string[]): Set<string> {
	const { options, problem } = parseOptions(process.argv.slice(2), known);
	if (problem) {
		console.error(problem);
		process.exit(1);
	}
	return options;
}

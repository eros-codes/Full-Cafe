// The booking lengths offered on the booking page and in the admin's manual booking. Pure (unit-tested).

/**
 * From the café's minimum to its maximum (settings «حداقل/حداکثر مدت رزرو»), in half-hour steps. Before, it was
 * always 1 to 4 hours whatever the settings said: a changed minimum or maximum offered lengths the server then
 * refused, and hid the ones it allowed.
 */
export function durationOptions(min = 60, max = 240): number[] {
	const low = Math.max(15, Math.round(min));
	const high = Math.max(low, Math.round(max));
	const options = [low];
	for (let minutes = Math.floor(low / 30) * 30 + 30; minutes < high; minutes += 30) options.push(minutes);
	if (high !== low) options.push(high);
	return options;
}

/** The allowed length nearest to `wanted` (the shorter one on a tie). */
export function fitDuration(wanted: number, min?: number, max?: number): number {
	const options = durationOptions(min, max);
	return options.reduce((best, m) => (Math.abs(m - wanted) < Math.abs(best - wanted) ? m : best), options[0]);
}

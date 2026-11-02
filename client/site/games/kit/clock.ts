// The countdowns of the games. A clock is plain data (kept in the game's saved state), so a turn that was
// running when the phone locked or the page reloaded goes on with the right time left.

export interface Clock {
	/** When it runs out (ms since epoch); null while paused. */
	endsAt: number | null;
	/** Time left when paused (ms). */
	left: number;
}

export const startClock = (ms: number, now = Date.now()): Clock => ({ endsAt: now + ms, left: ms });

export const pauseClock = (clock: Clock, now = Date.now()): Clock => (clock.endsAt === null ? clock : { endsAt: null, left: Math.max(0, clock.endsAt - now) });

export const resumeClock = (clock: Clock, now = Date.now()): Clock => (clock.endsAt !== null ? clock : { endsAt: now + clock.left, left: clock.left });

export const clockLeft = (clock: Clock, now = Date.now()): number => (clock.endsAt === null ? clock.left : Math.max(0, clock.endsAt - now));

export const isPaused = (clock: Clock) => clock.endsAt === null;

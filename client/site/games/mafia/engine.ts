import { shuffle, type Rng } from '../kit/random.js';

// «مافیا» on one phone: the phone deals the roles (passed from player to player), then stays with the
// narrator (گرداننده), who is not a player, and leads the game with it: who the mafia shoots at night, whom the
// doctor saves, whom the detective asks about, the sniper's one bullet, the day's vote and the winner.
// Pure functions over plain data (saved on the phone as it is).
//
// Teams: mafia = پدرخوانده + مافیای ساده (they know each other); town = دکتر, کارآگاه, تک‌تیرانداز, شهروند.
// The mafia win when they are as many as the town, the town when no mafia is left.

export type Role = 'godfather' | 'mafia' | 'doctor' | 'detective' | 'sniper' | 'citizen';

export const ROLE_FA: Record<Role, string> = {
	godfather: 'پدرخوانده',
	mafia: 'مافیا',
	doctor: 'دکتر',
	detective: 'کارآگاه',
	sniper: 'تک‌تیرانداز',
	citizen: 'شهروند',
};

export const MAFIA_PLAYERS = { min: 5, max: 16 } as const;

export const isMafiaRole = (role: Role) => role === 'godfather' || role === 'mafia';

export interface MafiaSettings {
	players: string[];
	/** The whole mafia team, the godfather included. */
	mafia: number;
	godfather: boolean;
	doctor: boolean;
	detective: boolean;
	sniper: boolean;
	/** Say the role of whoever is voted out or killed. */
	revealRoles: boolean;
}

export interface MafiaPlayer {
	name: string;
	role: Role;
	alive: boolean;
}

export type NightStep = 'mafia' | 'doctor' | 'detective' | 'sniper';

export interface Night {
	step: NightStep;
	/** The mafia's choice (null = nobody). */
	target: number | null;
	saved: number | null;
	checked: number | null;
	shot: number | null;
}

/** What happened, for the narrator's log and the morning announcement. */
export type MafiaEvent =
	| { kind: 'night'; day: number; died: number[]; saved: boolean }
	| { kind: 'vote'; day: number; out: number | null };

export type MafiaPhase =
	| { kind: 'setup' }
	| { kind: 'deal'; index: number; showing: boolean }
	/** All cards seen: the phone goes to the narrator. */
	| { kind: 'handover' }
	| { kind: 'day' }
	| { kind: 'vote' }
	| { kind: 'night'; night: Night }
	| { kind: 'over'; winner: 'mafia' | 'town' };

export interface MafiaState {
	settings: MafiaSettings;
	players: MafiaPlayer[];
	day: number;
	/** The doctor may save themselves only once in a game. */
	doctorSelfSaved: boolean;
	sniperBullet: boolean;
	log: MafiaEvent[];
	phase: MafiaPhase;
}

export const defaultMafiaCount = (players: number) => Math.max(1, Math.floor(players / 3));
/** The mafia must be fewer than the town at the start. */
export const maxMafia = (players: number) => Math.max(1, Math.floor((players - 1) / 2));

/** Town roles chosen in the settings that fit next to the mafia (the rest of the town are plain citizens). */
export function specialRoles(settings: Pick<MafiaSettings, 'doctor' | 'detective' | 'sniper'>): Role[] {
	const roles: Role[] = [];
	if (settings.doctor) roles.push('doctor');
	if (settings.detective) roles.push('detective');
	if (settings.sniper) roles.push('sniper');
	return roles;
}

/** The settings, made consistent for this many players (mafia within bounds, town specials not more than the town). */
export function fitSettings(settings: MafiaSettings): MafiaSettings {
	const n = settings.players.length;
	const mafia = Math.min(Math.max(1, settings.mafia), maxMafia(n));
	let next = { ...settings, mafia };
	const town = n - mafia;
	for (const role of ['sniper', 'detective', 'doctor'] as const) {
		if (specialRoles(next).length > town) next = { ...next, [role]: false };
	}
	return next;
}

export function rolesFor(settings: MafiaSettings): Role[] {
	const { mafia } = fitSettings(settings);
	const n = settings.players.length;
	const roles: Role[] = [];
	for (let i = 0; i < mafia; i++) roles.push(i === 0 && settings.godfather ? 'godfather' : 'mafia');
	const specials = specialRoles(fitSettings(settings));
	roles.push(...specials);
	while (roles.length < n) roles.push('citizen');
	return roles;
}

export function initialMafiaState(players: string[]): MafiaState {
	return {
		settings: {
			players,
			mafia: defaultMafiaCount(players.length),
			godfather: true,
			doctor: true,
			detective: true,
			sniper: false,
			revealRoles: false,
		},
		players: [],
		day: 0,
		doctorSelfSaved: false,
		sniperBullet: true,
		log: [],
		phase: { kind: 'setup' },
	};
}

/** Deals the roles at random and starts passing the phone. */
export function startMafia(settings: MafiaSettings, rng: Rng = Math.random): MafiaState {
	const fitted = fitSettings(settings);
	const roles = shuffle(rolesFor(fitted), rng);
	return {
		settings: fitted,
		players: fitted.players.map((name, i) => ({ name, role: roles[i], alive: true })),
		day: 0,
		doctorSelfSaved: false,
		sniperBullet: true,
		log: [],
		phase: { kind: 'deal', index: 0, showing: false },
	};
}

/** The others of the mafia team (what a mafia card shows). */
export const teammates = (players: readonly MafiaPlayer[], index: number) =>
	players.flatMap((p, i) => (i !== index && isMafiaRole(p.role) ? [i] : []));

export const alive = (players: readonly MafiaPlayer[]) => players.flatMap((p, i) => (p.alive ? [i] : []));

export function winnerOf(players: readonly MafiaPlayer[]): 'mafia' | 'town' | null {
	const living = players.filter((p) => p.alive);
	const mafia = living.filter((p) => isMafiaRole(p.role)).length;
	if (mafia === 0) return 'town';
	if (mafia >= living.length - mafia) return 'mafia';
	return null;
}

/**
 * The steps of a night, in order. A step is called even when its player is dead (or the sniper has no bullet
 * left): skipping it would tell everyone who is gone. Roles that are not in the game are left out.
 */
export function nightSteps(state: MafiaState): NightStep[] {
	const has = (role: Role) => state.players.some((p) => p.role === role);
	const steps: NightStep[] = ['mafia'];
	if (has('doctor')) steps.push('doctor');
	if (has('detective')) steps.push('detective');
	if (has('sniper')) steps.push('sniper');
	return steps;
}

/** Whether the role of this step can act tonight (alive, and the sniper still has the bullet). */
export function canAct(state: MafiaState, step: NightStep): boolean {
	if (step === 'mafia') return state.players.some((p) => p.alive && isMafiaRole(p.role));
	const role: Role = step;
	const holder = state.players.find((p) => p.role === role);
	if (!holder?.alive) return false;
	return step !== 'sniper' || state.sniperBullet;
}

/** The detective's answer: the godfather looks like a citizen. */
export const looksMafia = (player: MafiaPlayer) => player.role === 'mafia';

export function startDay(state: MafiaState): MafiaState {
	return { ...state, day: state.day + 1, phase: { kind: 'day' } };
}

export function startNight(state: MafiaState): MafiaState {
	return { ...state, phase: { kind: 'night', night: { step: 'mafia', target: null, saved: null, checked: null, shot: null } } };
}

/** The narrator records this step's choice (null = nobody / no action) and goes to the next step. */
export function chooseAtNight(state: MafiaState, choice: number | null): MafiaState {
	if (state.phase.kind !== 'night') return state;
	const night = { ...state.phase.night };
	const act = canAct(state, night.step);
	if (night.step === 'mafia') night.target = act ? choice : null;
	if (night.step === 'doctor') night.saved = act ? choice : null;
	if (night.step === 'detective') night.checked = act ? choice : null;
	if (night.step === 'sniper') night.shot = act ? choice : null;
	const steps = nightSteps(state);
	const next = steps[steps.indexOf(night.step) + 1];
	if (next) return { ...state, phase: { kind: 'night', night: { ...night, step: next } } };
	return resolveNight({ ...state, phase: { kind: 'night', night } });
}

/** Morning: who died in the night (the doctor's save stops one shot; a sniper who shoots the town dies). */
export function resolveNight(state: MafiaState): MafiaState {
	if (state.phase.kind !== 'night') return state;
	const { target, saved, shot } = state.phase.night;
	const players = state.players.map((p) => ({ ...p }));
	const doctor = players.findIndex((p) => p.role === 'doctor');
	const sniper = players.findIndex((p) => p.role === 'sniper');
	const died = new Set<number>();
	let wasSaved = false;
	if (target !== null && players[target]?.alive) {
		if (saved === target) wasSaved = true;
		else died.add(target);
	}
	let sniperBullet = state.sniperBullet;
	if (shot !== null && players[shot]?.alive) {
		sniperBullet = false;
		if (isMafiaRole(players[shot].role)) {
			if (saved === shot) wasSaved = true;
			else died.add(shot);
		} else if (sniper >= 0) died.add(sniper);
	}
	for (const i of died) players[i].alive = false;
	const doctorSelfSaved = state.doctorSelfSaved || (saved !== null && saved === doctor);
	const next: MafiaState = {
		...state,
		players,
		sniperBullet,
		doctorSelfSaved,
		log: [...state.log, { kind: 'night', day: state.day, died: [...died].sort((a, b) => a - b), saved: wasSaved }],
	};
	const winner = winnerOf(players);
	return winner ? { ...next, phase: { kind: 'over', winner } } : startDay(next);
}

/** The day's vote: `out` leaves the game (null = nobody). */
export function voteOut(state: MafiaState, out: number | null): MafiaState {
	const players = state.players.map((p, i) => (i === out ? { ...p, alive: false } : p));
	const next: MafiaState = { ...state, players, log: [...state.log, { kind: 'vote', day: state.day, out }] };
	const winner = winnerOf(players);
	return winner ? { ...next, phase: { kind: 'over', winner } } : startNight(next);
}

/** Same players, new roles. */
export const playAgain = (state: MafiaState, rng: Rng = Math.random) => startMafia(state.settings, rng);

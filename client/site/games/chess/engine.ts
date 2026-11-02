import type { Rng } from '../kit/random.js';

// «شطرنج» on one phone: the full rules (castling, en passant, promotion, check, mate, stalemate and the draws:
// fifty moves, threefold repetition, too little material), the moves written in standard notation, and a
// small bot of our own (alpha-beta search a ply or two deep, plus captures; roughly a 1000-rated club player
// on «سخت», weaker on «آسون»). Pure functions over plain data.
//
// Squares are 0…63 from a8 to h1 (index = row × 8 + file, row 0 = the 8th rank), as the board is drawn.
// Pieces are letters: PNBRQK white, pnbrqk black, '.' an empty square.

export type Color = 'w' | 'b';
export type Promo = 'q' | 'r' | 'b' | 'n';

export interface Move {
	from: number;
	to: number;
	promo?: Promo;
}

export interface Position {
	board: string[];
	turn: Color;
	/** Castling still allowed: a subset of 'KQkq'. */
	castling: string;
	/** The square a pawn may take en passant onto (−1 = none); only set when an enemy pawn can really take. */
	ep: number;
	/** Moves since the last capture or pawn move (for the fifty-move rule). */
	halfmove: number;
	fullmove: number;
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const PROMOTIONS: readonly Promo[] = ['q', 'r', 'b', 'n'];

const FILES = 'abcdefgh';
const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const QUEEN = [...ROOK, ...BISHOP];

export const squareName = (sq: number) => `${FILES[sq & 7]}${8 - (sq >> 3)}`;
export const colorOf = (piece: string): Color | null => (piece === '.' ? null : piece === piece.toUpperCase() ? 'w' : 'b');
export const other = (color: Color): Color => (color === 'w' ? 'b' : 'w');
export const sameMove = (a: Move, b: Move) => a.from === b.from && a.to === b.to && (a.promo ?? null) === (b.promo ?? null);

// ─── FEN (for the tests and the save check) ───────────────────────────────────

export function fromFen(fen: string): Position {
	const [placement, turn, castling, ep, halfmove, fullmove] = fen.trim().split(/\s+/);
	const board: string[] = [];
	for (const ch of placement.replace(/\//g, '')) {
		if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) board.push('.');
		else board.push(ch);
	}
	if (board.length !== 64) throw new Error(`bad FEN: ${fen}`);
	const epSquare = ep && ep !== '-' ? FILES.indexOf(ep[0]) + (8 - Number(ep[1])) * 8 : -1;
	return {
		board,
		turn: turn === 'b' ? 'b' : 'w',
		castling: castling && castling !== '-' ? castling : '',
		ep: epSquare,
		halfmove: Number(halfmove ?? 0) || 0,
		fullmove: Number(fullmove ?? 1) || 1,
	};
}

export function toFen(pos: Position): string {
	const rows: string[] = [];
	for (let r = 0; r < 8; r++) {
		let row = '';
		let empty = 0;
		for (let f = 0; f < 8; f++) {
			const p = pos.board[r * 8 + f];
			if (p === '.') empty++;
			else {
				if (empty) row += empty;
				empty = 0;
				row += p;
			}
		}
		rows.push(row + (empty ? empty : ''));
	}
	return `${rows.join('/')} ${pos.turn} ${pos.castling || '-'} ${pos.ep >= 0 ? squareName(pos.ep) : '-'} ${pos.halfmove} ${pos.fullmove}`;
}

export const startPosition = () => fromFen(START_FEN);

// ─── attacks and moves ────────────────────────────────────────────────────────

export const kingSquare = (board: readonly string[], color: Color) => board.indexOf(color === 'w' ? 'K' : 'k');

/** Whether `sq` is attacked by a piece of `by`. */
export function attacked(board: readonly string[], sq: number, by: Color): boolean {
	const r = sq >> 3;
	const f = sq & 7;
	const piece = (kind: string) => (by === 'w' ? kind.toUpperCase() : kind);
	const at = (rr: number, ff: number) => (rr >= 0 && rr < 8 && ff >= 0 && ff < 8 ? board[rr * 8 + ff] : '');
	// a white pawn attacks upwards, so it stands one row below the square
	const pr = by === 'w' ? r + 1 : r - 1;
	if (at(pr, f - 1) === piece('p') || at(pr, f + 1) === piece('p')) return true;
	for (const [dr, df] of KNIGHT) if (at(r + dr, f + df) === piece('n')) return true;
	for (const [dr, df] of KING) if (at(r + dr, f + df) === piece('k')) return true;
	const slides = (dirs: number[][], kinds: string[]) => {
		for (const [dr, df] of dirs) {
			let rr = r + dr;
			let ff = f + df;
			while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
				const p = board[rr * 8 + ff];
				if (p !== '.') {
					if (kinds.includes(p)) return true;
					break;
				}
				rr += dr;
				ff += df;
			}
		}
		return false;
	};
	return slides(ROOK, [piece('r'), piece('q')]) || slides(BISHOP, [piece('b'), piece('q')]);
}

export const inCheck = (pos: Position) => attacked(pos.board, kingSquare(pos.board, pos.turn), other(pos.turn));

/** Moves that follow the pieces' rules, before checking that the own king is safe. `tactical` = captures and queen promotions only. */
function pseudoMoves(pos: Position, tactical: boolean): Move[] {
	const { board, turn } = pos;
	const moves: Move[] = [];
	const own = (p: string) => p !== '.' && colorOf(p) === turn;
	const enemy = (p: string) => p !== '.' && colorOf(p) !== turn;
	const by = other(turn);
	for (let sq = 0; sq < 64; sq++) {
		const p = board[sq];
		if (!own(p)) continue;
		const r = sq >> 3;
		const f = sq & 7;
		const kind = p.toLowerCase();
		if (kind === 'p') {
			const dir = turn === 'w' ? -1 : 1;
			const r1 = r + dir;
			if (r1 < 0 || r1 > 7) continue;
			const last = r1 === (turn === 'w' ? 0 : 7);
			const add = (to: number) => {
				if (!last) moves.push({ from: sq, to });
				else if (tactical) moves.push({ from: sq, to, promo: 'q' });
				else for (const promo of PROMOTIONS) moves.push({ from: sq, to, promo });
			};
			const one = r1 * 8 + f;
			if (board[one] === '.' && (!tactical || last)) {
				add(one);
				const two = (r + 2 * dir) * 8 + f;
				if (!tactical && r === (turn === 'w' ? 6 : 1) && board[two] === '.') moves.push({ from: sq, to: two });
			}
			for (const df of [-1, 1]) {
				const ff = f + df;
				if (ff < 0 || ff > 7) continue;
				const to = r1 * 8 + ff;
				if (enemy(board[to]) || to === pos.ep) add(to);
			}
			continue;
		}
		if (kind === 'n' || kind === 'k') {
			for (const [dr, df] of kind === 'n' ? KNIGHT : KING) {
				const rr = r + dr;
				const ff = f + df;
				if (rr < 0 || rr > 7 || ff < 0 || ff > 7) continue;
				const to = rr * 8 + ff;
				if (own(board[to]) || (tactical && board[to] === '.')) continue;
				moves.push({ from: sq, to });
			}
			if (kind === 'k' && !tactical) {
				// castling: the squares between empty, the king not in check and not passing an attacked square
				const [k, q, rook, home] = turn === 'w' ? ['K', 'Q', 'R', 60] : ['k', 'q', 'r', 4];
				if (sq === home && !attacked(board, home, by)) {
					if (pos.castling.includes(k) && board[home + 1] === '.' && board[home + 2] === '.' && board[home + 3] === rook && !attacked(board, home + 1, by) && !attacked(board, home + 2, by))
						moves.push({ from: sq, to: home + 2 });
					if (
						pos.castling.includes(q) &&
						board[home - 1] === '.' &&
						board[home - 2] === '.' &&
						board[home - 3] === '.' &&
						board[home - 4] === rook &&
						!attacked(board, home - 1, by) &&
						!attacked(board, home - 2, by)
					)
						moves.push({ from: sq, to: home - 2 });
				}
			}
			continue;
		}
		for (const [dr, df] of kind === 'r' ? ROOK : kind === 'b' ? BISHOP : QUEEN) {
			let rr = r + dr;
			let ff = f + df;
			while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
				const to = rr * 8 + ff;
				const q = board[to];
				if (q === '.') {
					if (!tactical) moves.push({ from: sq, to });
				} else {
					if (enemy(q)) moves.push({ from: sq, to });
					break;
				}
				rr += dr;
				ff += df;
			}
		}
	}
	return moves;
}

export function makeMove(pos: Position, m: Move): Position {
	const b = pos.board.slice();
	const p = b[m.from];
	const kind = p.toLowerCase();
	const white = pos.turn === 'w';
	const captured = b[m.to];
	b[m.to] = m.promo ? (white ? m.promo.toUpperCase() : m.promo) : p;
	b[m.from] = '.';
	if (kind === 'p' && m.to === pos.ep && captured === '.') b[m.to + (white ? 8 : -8)] = '.';
	if (kind === 'k' && Math.abs(m.to - m.from) === 2) {
		const kingSide = m.to > m.from;
		b[kingSide ? m.from + 3 : m.from - 4] = '.';
		b[kingSide ? m.from + 1 : m.from - 1] = white ? 'R' : 'r';
	}
	let castling = pos.castling;
	const drop = (chars: string) => {
		for (const c of chars) castling = castling.replace(c, '');
	};
	if (p === 'K') drop('KQ');
	if (p === 'k') drop('kq');
	for (const sq of [m.from, m.to]) {
		if (sq === 63) drop('K');
		if (sq === 56) drop('Q');
		if (sq === 7) drop('k');
		if (sq === 0) drop('q');
	}
	let ep = -1;
	if (kind === 'p' && Math.abs(m.to - m.from) === 16) {
		const enemyPawn = white ? 'p' : 'P';
		const f = m.to & 7;
		if ((f > 0 && b[m.to - 1] === enemyPawn) || (f < 7 && b[m.to + 1] === enemyPawn)) ep = (m.from + m.to) / 2;
	}
	return {
		board: b,
		turn: white ? 'b' : 'w',
		castling,
		ep,
		halfmove: kind === 'p' || captured !== '.' ? 0 : pos.halfmove + 1,
		fullmove: white ? pos.fullmove : pos.fullmove + 1,
	};
}

/** The legal moves with the positions they lead to. */
function legalChildren(pos: Position, tactical = false): [Move, Position][] {
	const result: [Move, Position][] = [];
	for (const m of pseudoMoves(pos, tactical)) {
		const next = makeMove(pos, m);
		if (!attacked(next.board, kingSquare(next.board, pos.turn), next.turn)) result.push([m, next]);
	}
	return result;
}

export const legalMoves = (pos: Position): Move[] => legalChildren(pos).map(([m]) => m);

/** Leaf positions `depth` plies ahead: the standard check of a move generator. */
export function perft(pos: Position, depth: number): number {
	if (depth === 0) return 1;
	const children = legalChildren(pos);
	if (depth === 1) return children.length;
	let n = 0;
	for (const [, next] of children) n += perft(next, depth - 1);
	return n;
}

// ─── the end of a game ────────────────────────────────────────────────────────

export type Outcome =
	| { kind: 'checkmate'; winner: Color }
	| { kind: 'stalemate' | 'fifty' | 'material' | 'repetition' }
	| { kind: 'resign'; winner: Color }
	| { kind: 'agreed' };

/** Neither side can mate: kings alone, one minor piece, or only bishops all on squares of one colour. */
export function insufficientMaterial(board: readonly string[]): boolean {
	const pieces: { kind: string; sq: number }[] = [];
	board.forEach((p, sq) => {
		if (p !== '.' && p.toLowerCase() !== 'k') pieces.push({ kind: p.toLowerCase(), sq });
	});
	if (pieces.some((p) => p.kind === 'p' || p.kind === 'r' || p.kind === 'q')) return false;
	if (pieces.length <= 1) return true;
	if (pieces.every((p) => p.kind === 'b')) {
		const shade = (sq: number) => ((sq >> 3) + (sq & 7)) % 2;
		return pieces.every((p) => shade(p.sq) === shade(pieces[0].sq));
	}
	return false;
}

/** What makes two positions "the same" for the repetition rule. */
export const positionKey = (pos: Position) => `${pos.board.join('')} ${pos.turn} ${pos.castling} ${pos.ep}`;

/** How the game stands after the last of `positions` (every position since the start): null = still playing. */
export function outcomeOf(positions: readonly Position[]): Outcome | null {
	const pos = positions[positions.length - 1];
	if (!legalChildren(pos).length) return inCheck(pos) ? { kind: 'checkmate', winner: other(pos.turn) } : { kind: 'stalemate' };
	if (insufficientMaterial(pos.board)) return { kind: 'material' };
	if (pos.halfmove >= 100) return { kind: 'fifty' };
	const key = positionKey(pos);
	if (positions.filter((p) => positionKey(p) === key).length >= 3) return { kind: 'repetition' };
	return null;
}

/** The positions of a game from its moves, or null when a move is not legal (a damaged save). */
export function replay(moves: readonly Move[], start: Position = startPosition()): Position[] | null {
	const positions = [start];
	for (const m of moves) {
		const pos = positions[positions.length - 1];
		const found = legalChildren(pos).find(([l]) => sameMove(l, m));
		if (!found) return null;
		positions.push(found[1]);
	}
	return positions;
}

/** A move in standard notation (Nf3, exd5, O-O, e8=Q+, Qh4#). */
export function san(pos: Position, m: Move): string {
	const p = pos.board[m.from];
	const kind = p.toLowerCase();
	let text: string;
	if (kind === 'k' && Math.abs(m.to - m.from) === 2) text = m.to > m.from ? 'O-O' : 'O-O-O';
	else {
		const capture = pos.board[m.to] !== '.' || (kind === 'p' && m.to === pos.ep);
		if (kind === 'p') text = `${capture ? `${FILES[m.from & 7]}x` : ''}${squareName(m.to)}${m.promo ? `=${m.promo.toUpperCase()}` : ''}`;
		else {
			const rivals = legalMoves(pos).filter((o) => o.to === m.to && o.from !== m.from && pos.board[o.from] === p);
			let which = '';
			if (rivals.length) {
				if (!rivals.some((o) => (o.from & 7) === (m.from & 7))) which = FILES[m.from & 7];
				else if (!rivals.some((o) => o.from >> 3 === m.from >> 3)) which = String(8 - (m.from >> 3));
				else which = squareName(m.from);
			}
			text = `${kind.toUpperCase()}${which}${capture ? 'x' : ''}${squareName(m.to)}`;
		}
	}
	const next = makeMove(pos, m);
	if (inCheck(next)) text += legalChildren(next).length ? '+' : '#';
	return text;
}

// ─── material (for the captured pieces beside the board) ──────────────────────

export const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const FULL_SET: Record<string, number> = { q: 1, r: 2, b: 2, n: 2, p: 8 };

/** The pieces `color` has lost (strongest first), and the material balance in pawns (+ = white ahead). */
export function captured(board: readonly string[]): { w: string[]; b: string[]; balance: number } {
	const result = { w: [] as string[], b: [] as string[], balance: 0 };
	for (const color of ['w', 'b'] as const) {
		for (const [kind, full] of Object.entries(FULL_SET)) {
			const piece = color === 'w' ? kind.toUpperCase() : kind;
			const left = board.filter((p) => p === piece).length;
			for (let i = left; i < full; i++) result[color].push(kind);
		}
	}
	for (const p of board) if (p !== '.') result.balance += (colorOf(p) === 'w' ? 1 : -1) * VALUE[p.toLowerCase()];
	result.balance = Math.round(result.balance / 100);
	return result;
}

// ─── the bot ──────────────────────────────────────────────────────────────────

export type Level = 'easy' | 'hard';

// Piece-square tables from white's side (index = square as above): a little for good squares.
// prettier-ignore
const PST: Record<string, number[]> = {
	p: [
		0, 0, 0, 0, 0, 0, 0, 0,
		50, 50, 50, 50, 50, 50, 50, 50,
		10, 10, 20, 30, 30, 20, 10, 10,
		5, 5, 10, 25, 25, 10, 5, 5,
		0, 0, 0, 20, 20, 0, 0, 0,
		5, -5, -10, 0, 0, -10, -5, 5,
		5, 10, 10, -20, -20, 10, 10, 5,
		0, 0, 0, 0, 0, 0, 0, 0,
	],
	n: [
		-50, -40, -30, -30, -30, -30, -40, -50,
		-40, -20, 0, 0, 0, 0, -20, -40,
		-30, 0, 10, 15, 15, 10, 0, -30,
		-30, 5, 15, 20, 20, 15, 5, -30,
		-30, 0, 15, 20, 20, 15, 0, -30,
		-30, 5, 10, 15, 15, 10, 5, -30,
		-40, -20, 0, 5, 5, 0, -20, -40,
		-50, -40, -30, -30, -30, -30, -40, -50,
	],
	b: [
		-20, -10, -10, -10, -10, -10, -10, -20,
		-10, 0, 0, 0, 0, 0, 0, -10,
		-10, 0, 5, 10, 10, 5, 0, -10,
		-10, 5, 5, 10, 10, 5, 5, -10,
		-10, 0, 10, 10, 10, 10, 0, -10,
		-10, 10, 10, 10, 10, 10, 10, -10,
		-10, 5, 0, 0, 0, 0, 5, -10,
		-20, -10, -10, -10, -10, -10, -10, -20,
	],
	r: [
		0, 0, 0, 0, 0, 0, 0, 0,
		5, 10, 10, 10, 10, 10, 10, 5,
		-5, 0, 0, 0, 0, 0, 0, -5,
		-5, 0, 0, 0, 0, 0, 0, -5,
		-5, 0, 0, 0, 0, 0, 0, -5,
		-5, 0, 0, 0, 0, 0, 0, -5,
		-5, 0, 0, 0, 0, 0, 0, -5,
		0, 0, 0, 5, 5, 0, 0, 0,
	],
	q: [
		-20, -10, -10, -5, -5, -10, -10, -20,
		-10, 0, 0, 0, 0, 0, 0, -10,
		-10, 0, 5, 5, 5, 5, 0, -10,
		-5, 0, 5, 5, 5, 5, 0, -5,
		0, 0, 5, 5, 5, 5, 0, -5,
		-10, 5, 5, 5, 5, 5, 0, -10,
		-10, 0, 5, 0, 0, 0, 0, -10,
		-20, -10, -10, -5, -5, -10, -10, -20,
	],
	k: [
		-30, -40, -40, -50, -50, -40, -40, -30,
		-30, -40, -40, -50, -50, -40, -40, -30,
		-30, -40, -40, -50, -50, -40, -40, -30,
		-30, -40, -40, -50, -50, -40, -40, -30,
		-20, -30, -30, -40, -40, -30, -30, -20,
		-10, -20, -20, -20, -20, -20, -20, -10,
		20, 20, 0, 0, 0, 0, 20, 20,
		20, 30, 10, 0, 0, 10, 30, 20,
	],
	kEnd: [
		-50, -40, -30, -20, -20, -30, -40, -50,
		-30, -20, -10, 0, 0, -10, -20, -30,
		-30, -10, 20, 30, 30, 20, -10, -30,
		-30, -10, 30, 40, 40, 30, -10, -30,
		-30, -10, 30, 40, 40, 30, -10, -30,
		-30, -10, 20, 30, 30, 20, -10, -30,
		-30, -30, 0, 0, 0, 0, -30, -30,
		-50, -30, -30, -30, -30, -30, -30, -50,
	],
};

/** The position's score for the side to move, in centipawns. */
export function evaluate(pos: Position): number {
	const { board } = pos;
	let heavy = 0;
	for (const p of board) if (p !== '.' && 'nbrq'.includes(p.toLowerCase())) heavy += VALUE[p.toLowerCase()];
	const endgame = heavy <= 2600;
	let score = 0;
	for (let sq = 0; sq < 64; sq++) {
		const p = board[sq];
		if (p === '.') continue;
		const kind = p.toLowerCase();
		const white = p !== kind;
		// black reads the tables mirrored top to bottom
		const index = white ? sq : (7 - (sq >> 3)) * 8 + (sq & 7);
		const table = kind === 'k' && endgame ? PST.kEnd : PST[kind];
		score += (white ? 1 : -1) * (VALUE[kind] + table[index]);
	}
	return pos.turn === 'w' ? score : -score;
}

const MATE = 100_000;

/** Captures first, the biggest prize with the smallest piece. */
function ordered(pos: Position, children: [Move, Position][]): [Move, Position][] {
	const gain = ([m]: [Move, Position]) => {
		const victim = pos.board[m.to];
		return (victim === '.' ? 0 : VALUE[victim.toLowerCase()] * 10 - VALUE[pos.board[m.from].toLowerCase()]) + (m.promo === 'q' ? 8000 : 0);
	};
	return children.sort((a, b) => gain(b) - gain(a));
}

/** Only captures from here, so the search does not stop in the middle of an exchange. */
function quiesce(pos: Position, alpha: number, beta: number, depth: number): number {
	const stand = evaluate(pos);
	if (stand >= beta) return beta;
	if (stand > alpha) alpha = stand;
	if (depth >= 6) return alpha;
	for (const [, next] of ordered(pos, legalChildren(pos, true))) {
		const score = -quiesce(next, -beta, -alpha, depth + 1);
		if (score >= beta) return beta;
		if (score > alpha) alpha = score;
	}
	return alpha;
}

function search(pos: Position, depth: number, alpha: number, beta: number, ply: number): number {
	if (depth <= 0) return quiesce(pos, alpha, beta, 0);
	const children = legalChildren(pos);
	if (!children.length) return inCheck(pos) ? -MATE + ply : 0;
	for (const [, next] of ordered(pos, children)) {
		const score = -search(next, depth - 1, -beta, -alpha, ply + 1);
		if (score >= beta) return beta;
		if (score > alpha) alpha = score;
	}
	return alpha;
}

const LEVELS: Record<Level, { depth: number; noise: number }> = {
	// sees its own move and the captures after it; often misses what the opponent threatens
	easy: { depth: 1, noise: 70 },
	// also sees the opponent's best reply (no mate in one slips by), a little noise for variety
	hard: { depth: 2, noise: 12 },
};

/** The bot's move (null when there is none: the game is over). */
export function botMove(pos: Position, level: Level, rng: Rng = Math.random): Move | null {
	const { depth, noise } = LEVELS[level];
	const children = ordered(pos, legalChildren(pos));
	if (!children.length) return null;
	let best: Move | null = null;
	let bestScore = -Infinity;
	for (const [m, next] of children) {
		// a mate in one is seen on every level (the search below it would only see the material)
		const mates = !legalChildren(next).length && inCheck(next);
		const exact = mates ? MATE - 1 : -search(next, depth - 1, -MATE, MATE, 1);
		// a mate is never blurred away by the noise
		const score = Math.abs(exact) > MATE / 2 ? exact : exact + (rng() * 2 - 1) * noise;
		if (score > bestScore) {
			bestScore = score;
			best = m;
		}
	}
	return best;
}

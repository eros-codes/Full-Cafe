import type { Color } from './engine';

// The chess pieces, drawn for this page (45 × 45, one path set per piece). White: light body with a dark
// outline; black: dark body with light details.

const SHAPES: Record<string, { body: string[]; details?: string[]; dots?: [number, number, number][] }> = {
	p: {
		body: ['M22.5 9a5 5 0 0 0-3.2 8.8c-2.4 1.4-4 4-4 6.9 0 2.4 1.1 4.6 2.9 6-3.6 1.3-6.4 4.7-6.7 8.3h22c-.3-3.6-3.1-7-6.7-8.3 1.8-1.4 2.9-3.6 2.9-6 0-2.9-1.6-5.5-4-6.9A5 5 0 0 0 22.5 9z'],
	},
	r: {
		body: ['M11 39.5h23v-3.5H11z', 'M14 36l1.5-4h14l1.5 4z', 'M15.5 32V18h14v14z', 'M13 18h19l-1.5-3h-16z', 'M12 15V9h4.2v2.2h4V9h4.6v2.2h4V9H33v6z'],
		details: ['M15.5 32h14M15.5 18h14'],
	},
	n: {
		body: [
			'M13.5 39.5h20c.4-6.6-1.6-11.2-4.2-15.2 1.9-3.4 1.7-7.6-.9-11-2.1-2.8-5.4-4.3-8.4-4.4l-1.7-3.2-2 3.9c-2.6 1.2-4.4 3.1-5.4 5.6l-3.4 6.2c-.7 1.6.3 3.2 2 3.2l4.9-1.3c1.6-.2 3-1.1 4-2.6.3 3.3-1.6 5.8-3.7 8.4-2 2.6-1.4 6.4-1.2 10.4z',
		],
		details: ['M21.5 9.5c3.5 2.2 6 6 6.2 10.5'],
		dots: [[17.3, 15.2, 1.2]],
	},
	b: {
		body: ['M12 39.5h21V36H12z', 'M15.5 36c1.2-2.8 2.8-5 2.8-8h8.4c0 3 1.6 5.2 2.8 8z', 'M22.5 10.5c-4.2 3-7.2 7-7.2 11.2 0 3 1.8 5 3 6.3h8.4c1.2-1.3 3-3.3 3-6.3 0-4.2-3-8.2-7.2-11.2z'],
		details: ['M20 21.5l5.2-5.2M18.3 28h8.4'],
		dots: [[22.5, 8, 2.4]],
	},
	q: {
		body: ['M11 39.5h23V36H11z', 'M12.8 36l2-6h15.4l2 6z', 'M14.8 30L11.5 16l6.3 8.6 1.9-11.3 2.8 11.2 2.8-11.2 1.9 11.3 6.3-8.6L30.2 30z'],
		details: ['M14.8 30h15.4'],
		dots: [[11.4, 14.2, 2], [19.7, 11.4, 2], [22.5, 10.8, 0], [25.3, 11.4, 2], [33.6, 14.2, 2]],
	},
	k: {
		body: [
			'M11 39.5h23V36H11z',
			'M12.8 36l2-6h15.4l2 6z',
			'M14.6 30c-3.2-2.7-5.4-6-4.4-9.2.9-3 5-3.6 7.4-1 .9-3 2.8-4.6 4.9-4.6s4 1.6 4.9 4.6c2.4-2.6 6.5-2 7.4 1 1 3.2-1.2 6.5-4.4 9.2z',
		],
		details: ['M22.5 5.5v9M18.8 9h7.4', 'M14.6 30h15.8'],
	},
};

export function Piece({ kind, color }: { kind: string; color: Color }) {
	const shape = SHAPES[kind];
	if (!shape) return null;
	const white = color === 'w';
	return (
		<svg className={`ch-piece ch-piece-${color}`} viewBox="0 0 45 45" aria-hidden="true">
			<g fill={white ? '#fffaf1' : '#2f2324'} stroke={white ? '#3a2a2b' : '#140d0e'} strokeWidth="1.5" strokeLinejoin="round">
				{shape.body.map((d, i) => (
					<path key={i} d={d} />
				))}
				{shape.dots?.filter(([, , r]) => r > 0).map(([cx, cy, r], i) => (
					<circle key={`d${i}`} cx={cx} cy={cy} r={r} fill={kind === 'n' ? (white ? '#3a2a2b' : '#f2e6d4') : undefined} stroke={kind === 'n' ? 'none' : undefined} />
				))}
			</g>
			{shape.details && (
				<g fill="none" stroke={white ? '#3a2a2b' : '#e9dcc8'} strokeWidth="1.3" strokeLinecap="round">
					{shape.details.map((d, i) => (
						<path key={i} d={d} />
					))}
				</g>
			)}
		</svg>
	);
}

import type { ReactNode } from 'react';

/** A label / value row of a reservation summary (track, invoice). */
export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="detail-row">
			<span>{label}</span>
			<strong>{value}</strong>
		</div>
	);
}

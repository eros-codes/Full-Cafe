import { useEffect, useState } from 'react';
import { useLatest } from '../../shared/useLatest';

const R = 30;
const CIRCUMFERENCE = 2 * Math.PI * R;

/** Countdown ring for the table hold; calls onExpire once when the time is up. */
export function HoldRing({ expiresAt, totalSeconds, onExpire }: { expiresAt: string; totalSeconds?: number; onExpire: () => void }) {
	const expiryMs = new Date(expiresAt).getTime();
	const [total] = useState(() => totalSeconds || Math.max(1, Math.round((expiryMs - Date.now()) / 1000)));
	const remainingNow = () => Math.max(0, Math.ceil((expiryMs - Date.now()) / 1000));
	const [remain, setRemain] = useState(remainingNow);
	const expire = useLatest(onExpire);

	useEffect(() => {
		if (!Number.isFinite(expiryMs)) {
			expire.current();
			return;
		}
		let timer = 0;
		const tick = () => {
			const left = Math.max(0, Math.ceil((expiryMs - Date.now()) / 1000));
			setRemain(left);
			if (left <= 0) {
				expire.current();
				return;
			}
			timer = window.setTimeout(tick, 250);
		};
		tick();
		return () => window.clearTimeout(timer);
	}, [expiryMs, expire]);

	const ratio = Math.max(0, Math.min(1, remain / total));
	const m = Math.floor(remain / 60);
	const s = remain % 60;
	return (
		<div className={`hold-ring${remain <= 60 ? ' warn' : ''}`}>
			<svg viewBox="0 0 74 74">
				<circle className="track" cx="37" cy="37" r={R} />
				<circle className="progress" cx="37" cy="37" r={R} strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - ratio)} />
			</svg>
			<div className="hold-ring-num">{`${m}:${String(s).padStart(2, '0')}`}</div>
		</div>
	);
}

import { useEffect, useState } from 'react';

/** The current time, re-rendering every `interval` ms while `active`. */
export function useNow(active: boolean, interval = 200): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), interval);
		return () => window.clearInterval(timer);
	}, [active, interval]);
	return now;
}

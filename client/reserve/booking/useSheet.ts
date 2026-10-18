import { useCallback, useEffect, useState } from 'react';

/** Bottom sheet for the table details on phones (≤767px); a plain side panel on larger screens. */
export function useSheet() {
	const [state, setState] = useState<'none' | 'open' | 'closed'>('none');
	useEffect(() => {
		const query = window.matchMedia('(max-width: 767px)');
		const onResize = () => {
			if (!query.matches) setState('none');
		};
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, []);
	const open = useCallback(() => {
		if (window.matchMedia('(max-width: 767px)').matches) setState('open');
	}, []);
	const close = useCallback(() => setState((s) => (s === 'open' ? 'closed' : s)), []);
	return { state, open, close };
}

import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useLatest } from '../../../shared/useLatest';

// Keeping the screen on while a game is played (a timer must not be cut by the phone going to sleep), and
// full screen for «گوشی رو پیشونی» (bigger word, no address bar). Both are best effort: a browser without
// them just does not do it.

interface WakeLockSentinelLike {
	release: () => Promise<void>;
}

export function useWakeLock(active: boolean): void {
	useEffect(() => {
		if (!active) return;
		let sentinel: WakeLockSentinelLike | null = null;
		let cancelled = false;
		const request = async () => {
			try {
				const wakeLock = (navigator as unknown as { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
				if (!wakeLock || document.visibilityState !== 'visible') return;
				const next = await wakeLock.request('screen');
				if (cancelled) void next.release().catch(() => undefined);
				else sentinel = next;
			} catch {
				/* not allowed (battery saver, old browser) */
			}
		};
		// the lock is dropped whenever the page is hidden; take it again when the players come back
		const onVisible = () => {
			if (document.visibilityState === 'visible') void request();
		};
		void request();
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			cancelled = true;
			document.removeEventListener('visibilitychange', onVisible);
			void sentinel?.release().catch(() => undefined);
		};
	}, [active]);
}

/**
 * Calls `pause` as soon as the page is hidden while `active` (another app, a call, the screen locking), so a
 * running clock does not go on without the players. Committed at once (flushSync): a hidden page may be
 * frozen or killed by the phone before React would get round to saving the paused state.
 */
export function usePauseWhenHidden(active: boolean, pause: () => void): void {
	const latest = useLatest(pause);
	useEffect(() => {
		if (!active) return;
		const onChange = () => {
			if (document.visibilityState !== 'hidden') return;
			flushSync(() => latest.current());
		};
		document.addEventListener('visibilitychange', onChange);
		window.addEventListener('pagehide', onChange);
		return () => {
			document.removeEventListener('visibilitychange', onChange);
			window.removeEventListener('pagehide', onChange);
		};
	}, [active, latest]);
}

export function enterFullscreen(): void {
	try {
		if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => undefined);
	} catch {
		/* not supported (iPhone) */
	}
}

export function exitFullscreen(): void {
	try {
		if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
	} catch {
		/* ignore */
	}
}

import { useEffect, useRef, useState } from 'react';
import { useLatest } from '../../../shared/useLatest';
import { REARM, UPRIGHT_MS, faceUp, initialTilt, tiltStep } from './tilt';

// The phone's tilt for «گوشی رو پیشونی» (the maths: tilt.ts). iPhones ask the player first; that question
// can only be asked from a tap, so requestTiltPermission() runs from the turn's start button. Without a
// sensor, or without permission, the game uses buttons for the friends to tap instead.

export type SensorStatus = 'waiting' | 'on' | 'off';

interface OrientationPermission {
	requestPermission?: () => Promise<'granted' | 'denied'>;
}

/** Asks for the sensor where the browser wants that (iPhone). False = refused or not available. */
export async function requestTiltPermission(): Promise<boolean> {
	try {
		if (typeof DeviceOrientationEvent === 'undefined') return false;
		const ask = (DeviceOrientationEvent as unknown as OrientationPermission).requestPermission;
		if (typeof ask !== 'function') return true;
		return (await ask.call(DeviceOrientationEvent)) === 'granted';
	} catch {
		return false;
	}
}

/** How long to wait for a first reading before deciding there is no sensor. */
const NO_SENSOR_MS = 1500;
/** What the last check found, so the turn itself starts with the right screen (buttons or tilt). */
let known: SensorStatus | null = null;

/** Forgets what the last check found: the next check waits for the sensor again (each turn's start). */
export function resetTiltStatus(): void {
	known = null;
}

interface TiltHandlers {
	onTilt?: (dir: 'correct' | 'pass') => void;
	onUpright?: () => void;
	/** No reading came (no sensor, or no permission): the game goes on with buttons. */
	onNoSensor?: () => void;
}

/**
 * While `active`: `onTilt` on each completed tilt (down = correct, up = pass), `onUpright` once the phone
 * has stood upright for a moment (on the forehead, ready to start), `onNoSensor` when no reading comes.
 */
export function useTilt(active: boolean, { onTilt, onUpright, onNoSensor }: TiltHandlers): SensorStatus {
	const [status, setStatusState] = useState<SensorStatus>(known ?? 'waiting');
	const handlers = useLatest({ onTilt, onUpright, onNoSensor });
	const statusRef = useRef<SensorStatus>(known ?? 'waiting');
	const setStatus = (value: SensorStatus) => {
		known = value;
		setStatusState(value);
	};

	useEffect(() => {
		if (!active) return;
		const start = known ?? 'waiting';
		statusRef.current = start;
		setStatusState(start);
		if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
			statusRef.current = 'off';
			setStatus('off');
			handlers.current.onNoSensor?.();
			return;
		}
		let tilt = initialTilt();
		let uprightSince: number | null = null;
		let uprightFired = false;
		const onReading = (event: DeviceOrientationEvent) => {
			if (event.beta === null || event.gamma === null) return;
			if (statusRef.current !== 'on') {
				statusRef.current = 'on';
				setStatus('on');
			}
			const now = performance.now();
			const value = faceUp(event.beta, event.gamma);
			if (Math.abs(value) < REARM) {
				uprightSince ??= now;
				if (!uprightFired && now - uprightSince >= UPRIGHT_MS) {
					uprightFired = true;
					handlers.current.onUpright?.();
				}
			} else {
				uprightSince = null;
			}
			const step = tiltStep(tilt, value, now);
			tilt = step.state;
			if (step.event) handlers.current.onTilt?.(step.event);
		};
		const timer = window.setTimeout(() => {
			if (statusRef.current !== 'on') {
				statusRef.current = 'off';
				setStatus('off');
				handlers.current.onNoSensor?.();
			}
		}, NO_SENSOR_MS);
		window.addEventListener('deviceorientation', onReading);
		return () => {
			window.clearTimeout(timer);
			window.removeEventListener('deviceorientation', onReading);
		};
	}, [active, handlers]);

	return status;
}

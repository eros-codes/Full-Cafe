import { useLayoutEffect, useRef } from 'react';

/** A ref that always holds the latest value — for event listeners that must not be re-attached on every render. */
export function useLatest<T>(value: T) {
	const ref = useRef(value);
	useLayoutEffect(() => {
		ref.current = value;
	});
	return ref;
}

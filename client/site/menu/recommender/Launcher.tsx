import { useEffect, useState, type RefObject } from 'react';
import { fetchRecommenderStatus } from './data';
import { SPARK_ICON } from './icons';

// The way into «انتخاب برای من»: a round button at the bottom right of the menu. It arrives a few seconds after
// the page (not at once), opens into the sentence «نمی‌دونی چی انتخاب کنی؟» for about two seconds, and goes back
// to a circle; hovering or focusing it opens the sentence again. Only shown when the café switched the
// feature on and there is something to suggest.

const BUBBLE = 'نمی‌دونی چی انتخاب کنی؟';
/** After the page loads, when the circle arrives. */
const ARRIVE_MS = 3000;
/** Then, when it opens into the sentence… */
const OPEN_MS = ARRIVE_MS + 600;
/** …and for how long the whole sentence stays (the opening animation takes about half a second of it). */
const SENTENCE_MS = 2500;

/** Warms the dialog's code while the customer is still looking at the menu. */
export const preloadDialog = () => import('./RecommenderDialog');

interface Props {
	/** While another dialog (product, order list, the recommender itself) is open. */
	hidden: boolean;
	onOpen: () => void;
	buttonRef: RefObject<HTMLButtonElement | null>;
}

export function RecommenderLauncher({ hidden, onOpen, buttonRef }: Props) {
	const [enabled, setEnabled] = useState(false);
	const [arrived, setArrived] = useState(false);
	const [expanded, setExpanded] = useState(false);

	useEffect(() => {
		let cancelled = false;
		fetchRecommenderStatus()
			.then((status) => {
				if (!cancelled && status.enabled) setEnabled(true);
			})
			// no button is better than a broken one
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!enabled) return;
		const arrive = window.setTimeout(() => setArrived(true), ARRIVE_MS);
		const show = window.setTimeout(() => setExpanded(true), OPEN_MS);
		const hide = window.setTimeout(() => setExpanded(false), OPEN_MS + SENTENCE_MS);
		const preload = window.setTimeout(() => void preloadDialog().catch(() => undefined), 2500);
		return () => {
			window.clearTimeout(arrive);
			window.clearTimeout(show);
			window.clearTimeout(hide);
			window.clearTimeout(preload);
		};
	}, [enabled]);

	if (!enabled || !arrived) return null;
	return (
		<button
			ref={buttonRef}
			id="recommender-button"
			type="button"
			className={`rec-launcher${expanded ? ' expanded' : ''}`}
			hidden={hidden}
			aria-haspopup="dialog"
			aria-label={`${BUBBLE} چند سوال کوتاه و پیشنهاد از منو`}
			onClick={onOpen}
			onMouseEnter={() => setExpanded(true)}
			onMouseLeave={() => setExpanded(false)}
			onFocus={() => setExpanded(true)}
			onBlur={() => setExpanded(false)}
		>
			<span className="rec-launcher-icon">{SPARK_ICON}</span>
			<span className="rec-launcher-text" aria-hidden="true">
				{BUBBLE}
			</span>
		</button>
	);
}

/** Shown for the moment the dialog's code is still loading (slow connection, first tap). */
export function RecommenderLoadingShell({ onClose }: { onClose: () => void }) {
	return (
		<>
			<div className="rec-backdrop visible" onClick={onClose}></div>
			<section className="rec-dialog open" role="dialog" aria-modal="true" aria-label="انتخاب برای من" aria-busy="true">
				<div className="rec-head">
					<span className="rec-head-label">
						{SPARK_ICON}
						انتخاب برای من
					</span>
				</div>
				<div className="rec-body">
					<p className="rec-loading">یه لحظه…</p>
				</div>
			</section>
		</>
	);
}

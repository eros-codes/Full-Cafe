import { Component, useEffect, useState, type ReactNode, type RefObject } from 'react';
import { useLatest } from '../../../shared/useLatest';
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

/** The dialog's frame while its own code is not there: loading (slow connection, first tap) or failed. */
function Shell({ onClose, busy, children }: { onClose: () => void; busy?: boolean; children: ReactNode }) {
	const close = useLatest(onClose);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') close.current();
		};
		document.addEventListener('keydown', onKey);
		document.body.classList.add('recommender-open');
		return () => {
			document.removeEventListener('keydown', onKey);
			document.body.classList.remove('recommender-open');
		};
	}, [close]);
	return (
		<>
			<div className="rec-backdrop visible" onClick={onClose}></div>
			<section className="rec-dialog open" role="dialog" aria-modal="true" aria-label="انتخاب برای من" aria-busy={busy || undefined}>
				<div className="rec-head">
					<span className="rec-head-label">
						{SPARK_ICON}
						انتخاب برای من
					</span>
					<button type="button" className="rec-close" aria-label="بستن انتخاب برای من" onClick={onClose}>
						&times;
					</button>
				</div>
				<div className="rec-body">{children}</div>
			</section>
		</>
	);
}

/** Shown for the moment the dialog's code is still loading (slow connection, first tap). */
export function RecommenderLoadingShell({ onClose }: { onClose: () => void }) {
	return (
		<Shell onClose={onClose} busy>
			<p className="rec-loading">یه لحظه…</p>
		</Shell>
	);
}

interface BoundaryProps {
	open: boolean;
	onClose: () => void;
	children: ReactNode;
}

/**
 * Around the dialog. If its code cannot be loaded (a flaky connection, or the site was updated while the page
 * was open, so the old file is gone) or it fails while drawing, React would otherwise remove the whole menu page
 * and leave it blank. Instead the dialog says so and offers to load the page again (the order list is kept: it
 * lives in the phone's storage). A failed download is not retried in place: the browser keeps the failure for the
 * page, only a reload fetches the code again.
 */
export class RecommenderBoundary extends Component<BoundaryProps, { failed: boolean }> {
	state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	componentDidCatch(error: unknown) {
		console.error('«انتخاب برای من» باز نشد:', error);
	}

	render() {
		if (!this.state.failed) return this.props.children;
		if (!this.props.open) return null;
		return (
			<Shell onClose={this.props.onClose}>
				<h2 className="rec-title">الان باز نشد</h2>
				<p className="rec-sub">احتمالاً اینترنت لحظه‌ای قطع شده. صفحه رو دوباره بارگذاری کن؛ لیست سفارشت سر جاش می‌مونه.</p>
				<button type="button" className="rec-primary" onClick={() => window.location.reload()}>
					بارگذاری دوباره
				</button>
			</Shell>
		);
	}
}

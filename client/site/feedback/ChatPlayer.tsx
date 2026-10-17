import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchReviews, type PublicReview } from './api';

const DURATION = 4000; // ms between auto-advances
const ANIM_MS = 450; // must match the CSS animation duration

interface Review extends PublicReview {
	date: string | null;
}

function Bubble({ text, name, date, variant }: { text: string; name: string | null; date: string | null; variant: 'user' | 'admin' }) {
	return (
		<div className={`msg-row msg-row--${variant}`}>
			<div className={`msg-bubble msg-bubble--${variant}`}>
				{name ? <span className="msg-sender">{name}</span> : null}
				<p className="msg-text">{text}</p>
				{date ? <span className="msg-meta">{date}</span> : null}
			</div>
		</div>
	);
}

function Exchange({ review, motion }: { review: Review; motion: string }) {
	return (
		<div className={`msg-exchange${motion ? ` ${motion}` : ''}`}>
			<Bubble text={review.text} name={review.name} date={review.date} variant="user" />
			{review.reply ? <Bubble text={review.reply} name="روف" date={null} variant="admin" /> : null}
		</div>
	);
}

/** One rendered exchange; during a transition the outgoing and the incoming one are both on screen. */
interface Slot {
	key: number;
	index: number;
	motion: string;
}

/** Approved reviews played one after another like a chat, with next / previous / pause and dots. */
export function ChatPlayer() {
	const [reviews, setReviews] = useState<Review[] | null>(null);
	const [slots, setSlots] = useState<Slot[]>([]);
	const [current, setCurrent] = useState(0);
	const [paused, setPaused] = useState(false);

	const state = useRef({ current: 0, animating: false, count: 0, nextKey: 1 });
	const timers = useRef<{ interval: number | null; pending: number[] }>({ interval: null, pending: [] });

	useEffect(() => {
		let cancelled = false;
		fetchReviews()
			.catch((error) => {
				console.error('Failed to load reviews:', error);
				return [] as PublicReview[];
			})
			.then((list) => {
				if (cancelled) return;
				const withDates = list.map((r) => ({ ...r, date: r.createdAt ? new Date(r.createdAt).toLocaleDateString('fa-IR') : null }));
				state.current.count = withDates.length;
				setReviews(withDates);
				if (withDates.length) setSlots([{ key: 0, index: 0, motion: '' }]);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const transition = useCallback((nextIndex: number, dir: 'next' | 'prev') => {
		const s = state.current;
		if (s.animating || s.count === 0) return;
		s.animating = true;
		const incomingKey = s.nextKey++;
		setSlots((prev) => [
			...prev.slice(-1).map((slot) => ({ ...slot, motion: dir === 'next' ? 'msg--exit-top' : 'msg--exit-bottom' })),
			{ key: incomingKey, index: nextIndex, motion: dir === 'next' ? 'msg--enter-bottom' : 'msg--enter-top' },
		]);
		const id = window.setTimeout(() => {
			setSlots([{ key: incomingKey, index: nextIndex, motion: '' }]);
			s.current = nextIndex;
			setCurrent(nextIndex);
			s.animating = false;
		}, ANIM_MS);
		timers.current.pending.push(id);
	}, []);

	const goNext = useCallback(() => {
		const { count, current: cur } = state.current;
		if (count > 1) transition((cur + 1) % count, 'next');
	}, [transition]);

	const goPrev = useCallback(() => {
		const { count, current: cur } = state.current;
		if (count > 1) transition((cur - 1 + count) % count, 'prev');
	}, [transition]);

	const stopTimer = useCallback(() => {
		if (timers.current.interval !== null) window.clearInterval(timers.current.interval);
		timers.current.interval = null;
	}, []);

	const startTimer = useCallback(() => {
		stopTimer();
		if (state.current.count > 1) timers.current.interval = window.setInterval(goNext, DURATION);
	}, [goNext, stopTimer]);

	// auto-play once the reviews are in, and whenever "pause" is released
	useEffect(() => {
		if (!reviews || paused) return;
		startTimer();
		return stopTimer;
	}, [reviews, paused, startTimer, stopTimer]);

	useEffect(() => {
		const t = timers.current;
		return () => t.pending.forEach((id) => window.clearTimeout(id));
	}, []);

	const resetTimer = () => {
		if (!paused) startTimer();
	};

	const goTo = (index: number) => {
		if (index === state.current.current || state.current.animating) return;
		transition(index, index > state.current.current ? 'next' : 'prev');
		resetTimer();
	};

	const empty = reviews !== null && reviews.length === 0;

	return (
		<div className={`chat-container${empty ? ' chat-container--empty' : ''}`}>
			<div className="chat-header">
				<div className="chat-avatar">R</div>
				<div className="chat-meta">
					<h2 className="chat-name">روف</h2>
					<span className="chat-status">
						<span className="status-dot"></span>
						آنلاین
					</span>
				</div>
			</div>
			<div className={`chat-window${empty ? ' chat-window--empty' : ''}`}>
				<div className="chat-messages" id="chat-messages">
					{empty ? (
						<div className="chat-placeholder">
							<p className="chat-placeholder-title">هنوز نظری ثبت نشده</p>
							<p className="chat-placeholder-body">اولین نفر باشید و تجربه‌تان را با ما به اشتراک بگذارید</p>
						</div>
					) : (
						reviews && slots.map((slot) => <Exchange key={slot.key} review={reviews[slot.index]} motion={slot.motion} />)
					)}
				</div>
			</div>
			<div className="chat-controls" dir="ltr" style={empty ? { display: 'none' } : undefined}>
				<button
					className="ctrl-btn"
					id="next-btn"
					aria-label="نظر بعدی"
					onClick={() => {
						goNext();
						resetTimer();
					}}
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
						<polyline points="9 18 15 12 9 6"></polyline>
					</svg>
				</button>
				<button className="ctrl-btn ctrl-btn--pause" id="pause-btn" aria-label={paused ? 'پخش' : 'توقف'} onClick={() => setPaused((p) => !p)}>
					<svg className="icon-pause" viewBox="0 0 24 24" fill="currentColor" style={{ display: paused ? 'none' : 'block' }}>
						<rect x="6" y="4" width="4" height="16" rx="1"></rect>
						<rect x="14" y="4" width="4" height="16" rx="1"></rect>
					</svg>
					<svg className="icon-play" viewBox="0 0 24 24" fill="currentColor" style={{ display: paused ? 'block' : 'none' }}>
						<polygon points="5 3 19 12 5 21 5 3"></polygon>
					</svg>
				</button>
				<button
					className="ctrl-btn"
					id="prev-btn"
					aria-label="نظر قبلی"
					onClick={() => {
						goPrev();
						resetTimer();
					}}
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
						<polyline points="15 18 9 12 15 6"></polyline>
					</svg>
				</button>
			</div>
			<div className="chat-dots" id="chat-dots" style={empty ? { display: 'none' } : undefined}>
				{reviews?.map((_, i) => (
					<button key={i} className={`chat-dot${i === current ? ' chat-dot--active' : ''}`} aria-label={`نظر ${i + 1}`} onClick={() => goTo(i)}></button>
				))}
			</div>
		</div>
	);
}

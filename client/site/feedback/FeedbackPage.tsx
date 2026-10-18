import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../shared/api';
import { faNumber } from '../../shared/format';
import { safeStorage } from '../../shared/storage';
import { HamburgerButton, MobileDrawer, SiteFooter, useDrawer } from '../../shared/chrome/SiteChrome';
import { ChatPlayer } from './ChatPlayer';
import { postReview } from './api';

const MAX = 100;
const PENDING_KEY = 'pendingReviews';

interface PendingReview {
	id: number;
	name: string | null;
	text: string;
}

function readPending(): PendingReview[] {
	try {
		const value = JSON.parse(safeStorage.get(PENDING_KEY) || '[]');
		return Array.isArray(value) ? value : [];
	} catch {
		return [];
	}
}

const isClientError = (error: unknown) => error instanceof ApiError && error.status >= 400 && error.status < 500;

function FeedbackForm() {
	const [name, setName] = useState('');
	const [text, setText] = useState('');
	const [loading, setLoading] = useState(false);
	const [notice, setNotice] = useState<{ message: string; type: 'success' | 'error'; visible: boolean } | null>(null);
	const textRef = useRef<HTMLTextAreaElement>(null);
	const hideTimer = useRef<number | undefined>(undefined);

	const showFeedback = useCallback((message: string, type: 'success' | 'error') => {
		setNotice({ message, type, visible: true });
		window.clearTimeout(hideTimer.current);
		hideTimer.current = window.setTimeout(() => setNotice((n) => (n ? { ...n, visible: false } : n)), 4500);
	}, []);

	// نظرهایی که موقع قطعی اینترنت ذخیره شده‌اند، الان یا وقتی اینترنت برگشت فرستاده می‌شوند
	useEffect(() => {
		const sync = async () => {
			const pending = readPending();
			if (!pending.length) return;
			const remaining: PendingReview[] = [];
			for (const entry of pending) {
				try {
					await postReview({ name: entry.name, text: entry.text });
				} catch (error) {
					// invalid entries are dropped; everything else (offline, 429, 5xx) is kept for later
					if (isClientError(error) && (error as ApiError).status !== 429) continue;
					remaining.push(entry);
				}
			}
			if (remaining.length === 0) {
				safeStorage.remove(PENDING_KEY);
				showFeedback('نظرات آفلاین با موفقیت همگام‌سازی شدند.', 'success');
			} else {
				safeStorage.set(PENDING_KEY, JSON.stringify(remaining));
			}
		};
		sync();
		window.addEventListener('online', sync);
		return () => {
			window.removeEventListener('online', sync);
			window.clearTimeout(hideTimer.current);
		};
	}, [showFeedback]);

	const reset = () => {
		setName('');
		setText('');
	};

	const onSubmit = async (event: FormEvent) => {
		event.preventDefault();
		const cleanName = name.trim() || null;
		const cleanText = text.trim();
		if (!cleanText) {
			showFeedback('لطفاً نظر خود را وارد کنید.', 'error');
			textRef.current?.focus();
			return;
		}
		setLoading(true);
		try {
			await postReview({ name: cleanName, text: cleanText });
			reset();
			showFeedback('نظر شما ثبت شد و پس از بررسی نمایش داده خواهد شد 🙏', 'success');
		} catch (error) {
			// validation / rate-limit errors are shown; a network or server failure keeps the review for later
			if (isClientError(error)) {
				showFeedback((error as ApiError).message || 'خطا در ثبت نظر', 'error');
				return;
			}
			const pending = readPending();
			pending.push({ id: Date.now(), name: cleanName, text: cleanText });
			safeStorage.set(PENDING_KEY, JSON.stringify(pending));
			reset();
			showFeedback('اتصال به سرور برقرار نشد؛ نظر شما آفلاین ذخیره شد.', 'success');
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="form-container">
			<div className="form-header">
				<h2 className="form-title">نظر شما</h2>
				<p className="form-subtitle">تجربه‌تان را با ما به اشتراک بگذارید</p>
			</div>
			<form id="feedback-form" className="feedback-form" noValidate onSubmit={onSubmit}>
				<div className="field-group">
					<label htmlFor="review-name" className="field-label">
						نام <span className="optional">(اختیاری)</span>
					</label>
					<input
						type="text"
						id="review-name"
						name="name"
						className="field-input"
						placeholder="نام شما"
						autoComplete="name"
						maxLength={64}
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</div>
				<div className="field-group">
					<label htmlFor="review-text" className="field-label">
						نظر
					</label>
					<textarea
						id="review-text"
						name="review"
						className="field-input field-textarea"
						placeholder="تجربه‌تان را بنویسید..."
						required
						maxLength={MAX}
						ref={textRef}
						value={text}
						onChange={(event) => setText(event.target.value)}
					></textarea>
					<span className={`char-count${text.length > MAX * 0.88 ? ' char-count--warn' : ''}`} id="char-count" dir="ltr">
						{faNumber(text.length)} / {faNumber(MAX)}
					</span>
				</div>
				<button type="submit" className={`submit-btn${loading ? ' submit-btn--loading' : ''}`} id="submit-btn" disabled={loading}>
					<span className="submit-text">ثبت نظر</span>
					<span className="submit-icon" aria-hidden="true">
						←
					</span>
				</button>
			</form>
			<div
				className={notice ? `form-feedback form-feedback--${notice.type}${notice.visible ? ' form-feedback--visible' : ''}` : 'form-feedback'}
				id="form-feedback"
				role="status"
				aria-live="polite"
			>
				{notice?.message}
			</div>
		</div>
	);
}

export function FeedbackPage() {
	const drawer = useDrawer();
	return (
		<>
			<div>
				<header className="menu-header">
					<div className="menu-header-top">
						<div className="menu-header-right">
							<HamburgerButton drawer={drawer} />
							<div className="menu-logo">
								<img src="/images/Logo-2.PNG" alt="روف" />
							</div>
						</div>
					</div>
				</header>
				<main className="feedback-page">
					<section className="chat-section">
						<ChatPlayer />
					</section>
					<section className="form-section">
						<FeedbackForm />
					</section>
				</main>
			</div>
			<SiteFooter links={['about', 'contact', 'reserve', 'menu']} credit="Made with love 🤍 Eros & Nord " />
			<MobileDrawer drawer={drawer} links={['menu', 'about', 'contact', 'reserve']} />
		</>
	);
}

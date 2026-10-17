import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { errorText } from '../../shared/api';
import { useLatest } from '../../shared/useLatest';

interface Props {
	title: string;
	submitLabel?: string;
	/** Throws to keep the dialog open and show the error under the form. */
	onSubmit: () => Promise<void>;
	onClose: () => void;
	children: ReactNode;
}

/** The dialog used by every form of the menu sections (products, categories, add-ons, reviews…). */
export function MenuModal({ title, submitLabel = 'ذخیره', onSubmit, onClose, children }: Props) {
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const formRef = useRef<HTMLFormElement>(null);
	const close = useLatest(onClose);

	useEffect(() => {
		formRef.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') close.current();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [close]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setError(null);
		setBusy(true);
		try {
			await onSubmit();
			onClose();
		} catch (err) {
			setError(errorText(err));
			setBusy(false);
		}
	};

	return (
		<div
			id="menuModal"
			className="modal open"
			role="dialog"
			aria-modal="true"
			aria-labelledby="menuModalTitle"
			onClick={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<form className="modal-content menu-modal" noValidate onSubmit={submit} ref={formRef}>
				<h3 id="menuModalTitle">{title}</h3>
				<div className="form-grid">{children}</div>
				<div className={error ? 'menu-modal-error notice danger' : 'menu-modal-error'} aria-live="polite">
					{error}
				</div>
				<div className="actions">
					<button type="button" className="secondary-btn" onClick={onClose}>
						انصراف
					</button>
					<button type="submit" className="primary-btn" disabled={busy}>
						{submitLabel}
					</button>
				</div>
			</form>
		</div>
	);
}

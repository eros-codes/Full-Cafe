import { useEffect, useRef, useState, type RefObject } from 'react';
import { faNumber } from '../../shared/format';
import { useLatest } from '../../shared/useLatest';
import { totalQuantity, type Order, type OrderItem } from './order';

interface Props {
	open: boolean;
	order: Order;
	openButtonRef: RefObject<HTMLButtonElement | null>;
	onClose: () => void;
	onIncrease: (item: OrderItem) => void;
	onDecrease: (item: OrderItem) => void;
	onRemove: (item: OrderItem) => void;
	onClear: () => void;
}

/** The local order list ("what we want to order"), opened from the receipt button in the header. */
export function OrderDialog({ open, order, openButtonRef, onClose, onIncrease, onDecrease, onRemove, onClear }: Props) {
	const [visible, setVisible] = useState(false);
	const closeRef = useRef<HTMLButtonElement>(null);
	const itemsRef = useRef<HTMLDivElement>(null);
	const onCloseRef = useLatest(onClose);
	const total = totalQuantity(order);

	useEffect(() => {
		if (!open) {
			setVisible(false);
			return;
		}
		document.body.classList.add('order-dialog-open');
		const frame = requestAnimationFrame(() => {
			setVisible(true);
			closeRef.current?.focus();
		});
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onCloseRef.current();
		};
		document.addEventListener('keydown', onKey);
		const opener = openButtonRef.current;
		return () => {
			cancelAnimationFrame(frame);
			document.body.classList.remove('order-dialog-open');
			document.removeEventListener('keydown', onKey);
			opener?.focus();
		};
	}, [open, openButtonRef, onCloseRef]);

	/** After a change in the list, keep keyboard focus inside the dialog. */
	const refocus = () =>
		requestAnimationFrame(() => {
			const first = itemsRef.current?.querySelector('button');
			if (first) first.focus();
			else closeRef.current?.focus();
		});

	return (
		<>
			<div id="order-dialog-backdrop" className={`order-dialog-backdrop${open && visible ? ' visible' : ''}`} hidden={!open} onClick={onClose}></div>
			<section
				id="order-dialog"
				className={`order-dialog${open && visible ? ' open' : ''}`}
				role="dialog"
				aria-modal="true"
				aria-labelledby="order-dialog-title"
				hidden={!open}
			>
				<div className="order-dialog-header">
					<div>
						<h2 id="order-dialog-title">لیست سفارش</h2>
						<span id="order-dialog-count" className="order-dialog-count">
							{total > 0 ? `${faNumber(total)} آیتم` : 'خالی'}
						</span>
					</div>
					<button id="order-dialog-close" className="order-dialog-close" type="button" aria-label="بستن لیست سفارش" ref={closeRef} onClick={onClose}>
						&times;
					</button>
				</div>
				<div id="order-dialog-items" className="order-dialog-items" ref={itemsRef}>
					{order.items.length === 0 ? (
						<div className="order-empty-state">لیست سفارش شما خالی است. از منو، آیتم‌های موردنظرتان را اضافه کنید.</div>
					) : (
						order.items.map((item) => (
							<article className="order-dialog-item" key={item.key}>
								<div className="order-dialog-item-info">
									<h3 className="order-dialog-item-name">{item.name}</h3>
									{item.addOns.length > 0 && (
										<span className="order-dialog-item-addons">+ {item.addOns.map((addOn) => addOn.name).join('، ')}</span>
									)}
									<span className="order-dialog-item-quantity-text">{`${faNumber(item.quantity)} عدد`}</span>
								</div>
								<div className="order-dialog-item-controls">
									<button
										type="button"
										className="order-dialog-qty-btn"
										aria-label={`زیاد کردن ${item.name}`}
										onClick={() => {
											onIncrease(item);
											refocus();
										}}
									>
										+
									</button>
									<span className="order-dialog-qty-value">{faNumber(item.quantity)}</span>
									<button
										type="button"
										className="order-dialog-qty-btn"
										aria-label={`کم کردن ${item.name}`}
										onClick={() => {
											onDecrease(item);
											refocus();
										}}
									>
										−
									</button>
									<button
										type="button"
										className="order-dialog-remove"
										onClick={() => {
											onRemove(item);
											refocus();
										}}
									>
										حذف
									</button>
								</div>
							</article>
						))
					)}
				</div>
				<p className="order-dialog-note">این لیست فقط برای یادداشت سفارش شماست و سفارش آنلاین ثبت نمی‌شود.</p>
				<div className="order-dialog-actions">
					<button id="order-clear-button" className="order-clear-button" type="button" disabled={order.items.length === 0} onClick={onClear}>
						پاک کردن لیست
					</button>
					<button id="order-dialog-done" className="order-dialog-done" type="button" onClick={onClose}>
						بستن
					</button>
				</div>
			</section>
		</>
	);
}

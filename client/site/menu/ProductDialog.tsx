import { useEffect, useRef, useState } from 'react';
import { faNumber } from '../../shared/format';
import { useLatest } from '../../shared/useLatest';
import { productImageUrl, type AddOn, type Product } from './api';
import { ImageIcon } from './ImagePlaceholder';
import { itemKey, keyQuantity, type Order } from './order';

interface Props {
	/** The product shown, or null when the dialog is closed. */
	product: Product | null;
	order: Order;
	onAdd: (product: Product, addOns: AddOn[]) => void;
	onDecrease: (key: string) => void;
	onClose: () => void;
}

/** Product details: large photo, description, add-ons to choose, and its own order stepper. */
export function ProductDialog({ product, order, onAdd, onDecrease, onClose }: Props) {
	// the last product stays rendered while hidden, like the original dialog
	const [shown, setShown] = useState<Product | null>(product);
	const [visible, setVisible] = useState(false);
	const [selected, setSelected] = useState<number[]>([]);
	const closeRef = useRef<HTMLButtonElement>(null);
	const onCloseRef = useLatest(onClose);
	const isOpen = product !== null;

	// opening a product: fresh add-on choice, then fade in on the next frame (as the original did)
	useEffect(() => {
		if (!product) {
			setVisible(false);
			return;
		}
		setShown(product);
		setSelected([]);
		document.body.classList.add('product-dialog-open');
		const frame = requestAnimationFrame(() => {
			setVisible(true);
			closeRef.current?.focus();
		});
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onCloseRef.current();
		};
		document.addEventListener('keydown', onKey);
		return () => {
			cancelAnimationFrame(frame);
			document.body.classList.remove('product-dialog-open');
			document.removeEventListener('keydown', onKey);
		};
	}, [product, onCloseRef]);

	const addOns = shown?.addOns ?? [];
	const chosen = addOns.filter((addOn) => selected.includes(addOn.id));
	const key = shown ? itemKey(shown.id, chosen) : '';
	const quantity = shown ? keyQuantity(order, key) : 0;
	const price = (shown?.price ?? 0) + chosen.reduce((sum, addOn) => sum + addOn.price, 0);
	const src = productImageUrl(shown?.image);

	const toggle = (id: number) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

	return (
		<>
			<div
				id="product-dialog-backdrop"
				className={`product-dialog-backdrop${isOpen && visible ? ' visible' : ''}`}
				hidden={!isOpen}
				onClick={onClose}
			></div>
			<section
				id="product-dialog"
				className={`product-dialog${isOpen && visible ? ' open' : ''}${quantity > 0 ? ' has-order' : ''}${addOns.length ? ' has-addons' : ''}`}
				role="dialog"
				aria-modal="true"
				aria-labelledby="product-dialog-name"
				hidden={!isOpen}
			>
				<button
					id="product-dialog-close"
					className="product-dialog-close"
					type="button"
					aria-label="بستن جزئیات محصول"
					ref={closeRef}
					onClick={onClose}
				>
					&times;
				</button>
				<div id="product-dialog-image" className="product-dialog-image">
					{shown &&
						(src ? (
							<img src={src} alt={shown.name} />
						) : (
							<div className="product-dialog-image-empty">
								<ImageIcon />
							</div>
						))}
				</div>
				<div className="product-dialog-content">
					<div className="product-dialog-body">
						<h2 id="product-dialog-name" className="product-dialog-name">
							{shown?.name}
						</h2>
						<p id="product-dialog-description" className="product-dialog-description" hidden={!shown?.description}>
							{shown?.description}
						</p>
						{addOns.length > 0 && (
							<fieldset className="product-dialog-addons">
								<legend className="product-dialog-addons-title">افزودنی‌ها</legend>
								{addOns.map((addOn) => (
									<label className="product-dialog-addon" key={addOn.id}>
										<input type="checkbox" checked={selected.includes(addOn.id)} onChange={() => toggle(addOn.id)} />
										<span className="product-dialog-addon-name">{addOn.name}</span>
										<span className="product-dialog-addon-price">
											{addOn.price > 0 ? `\u200F+${faNumber(addOn.price)} تومان` : 'رایگان'}
										</span>
									</label>
								))}
							</fieldset>
						)}
					</div>
					<div className="product-dialog-footer">
						<div id="product-dialog-price" className="product-dialog-price">
							{shown ? `${faNumber(price)} تومان` : ''}
						</div>
						<div className="product-dialog-order-control" aria-label="کنترل سفارش محصول">
							<div className="product-dialog-order-stepper">
								<button
									className="product-dialog-order-btn product-dialog-order-increase"
									type="button"
									aria-label="افزودن محصول به لیست سفارش"
									onClick={() => shown && onAdd(shown, chosen)}
								>
									+
								</button>
								<span className="product-dialog-order-quantity">{quantity > 0 ? faNumber(quantity) : ''}</span>
								<button
									className="product-dialog-order-btn product-dialog-order-decrease"
									type="button"
									aria-label="کم کردن محصول"
									onClick={() => onDecrease(key)}
								>
									−
								</button>
							</div>
						</div>
					</div>
				</div>
			</section>
		</>
	);
}

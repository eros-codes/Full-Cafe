import { faNumber } from '../../shared/format';
import { productImageUrl, type Product } from './api';
import { ImageIcon } from './ImagePlaceholder';
import { useBump } from './useBump';

interface Props {
	product: Product;
	index: number;
	quantity: number;
	onOpen: () => void;
	onIncrease: () => void;
	onDecrease: () => void;
}

export function ProductCard({ product, index, quantity, onOpen, onIncrease, onDecrease }: Props) {
	const quantityText = quantity > 0 ? faNumber(quantity) : '';
	const quantityRef = useBump<HTMLSpanElement>(quantityText);
	const src = productImageUrl(product.image);

	return (
		<section
			className={`food-card${quantity > 0 ? ' has-order' : ''}`}
			data-product-id={product.id}
			style={{ animationDelay: `${index * 0.04}s` }}
			onClick={onOpen}
		>
			<div className="food-pic">
				{src ? (
					<img src={src} alt={product.name} />
				) : (
					<div className="food-pic--empty">
						<ImageIcon />
					</div>
				)}
			</div>
			<div className="food-info">
				<div className="food-tag">
					<h3 className="food-name">{product.name}</h3>
					<div className="food-price">{`${faNumber(product.price)} تومان`}</div>
				</div>
				<p className="food-description">{product.description}</p>
				<div className="food-order-control" aria-label={`کنترل سفارش ${product.name}`}>
					<div className="food-order-stepper">
						<button
							type="button"
							className="food-order-btn food-order-increase"
							aria-label={`افزودن ${product.name} به لیست سفارش`}
							onClick={(event) => {
								event.stopPropagation();
								onIncrease();
							}}
						>
							+
						</button>
						<span className="food-order-quantity" ref={quantityRef}>
							{quantityText}
						</span>
						<button
							type="button"
							className="food-order-btn food-order-decrease"
							aria-label={`کم کردن ${product.name}`}
							onClick={(event) => {
								event.stopPropagation();
								onDecrease();
							}}
						>
							−
						</button>
					</div>
				</div>
			</div>
		</section>
	);
}

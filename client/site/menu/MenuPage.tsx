import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError } from '../../shared/api';
import { faNumber } from '../../shared/format';
import { safeStorage } from '../../shared/storage';
import { HamburgerButton, MobileDrawer, SiteFooter, useDrawer } from '../common/SiteChrome';
import { fetchCategories, fetchMenuTypes, fetchProducts, type AddOn, type Category, type MenuType, type Product } from './api';
import { OrderDialog } from './OrderDialog';
import { ProductCard } from './ProductCard';
import { ProductDialog } from './ProductDialog';
import { addItem, clearOrder, decreaseItem, loadOrder, productQuantity, removeItem, totalQuantity, type OrderItem } from './order';
import { useBump } from './useBump';

const TYPE_KEY = 'currentMenuType';
const CATEGORY_KEY = 'currentCategory';
const EMPTY_TEXT = 'به زودی محصولات این دسته اضافه خواهند شد!';
const ERROR_TEXT = 'خطا در ارتباط با سرور. لطفاً بعداً تلاش کنید.';

const storedNumber = (key: string): number | null => {
	const value = Number(safeStorage.get(key));
	return Number.isInteger(value) && value > 0 ? value : null;
};

/** The remembered category if it belongs to this menu type, otherwise the type's first category. */
function pickCategory(typeId: number | null, categories: Category[]): number | null {
	const ofType = categories.filter((c) => c.menuTypeId === typeId);
	const stored = storedNumber(CATEGORY_KEY);
	if (stored !== null && ofType.some((c) => c.id === stored)) return stored;
	if (ofType.length) {
		safeStorage.set(CATEGORY_KEY, String(ofType[0].id));
		return ofType[0].id;
	}
	safeStorage.remove(CATEGORY_KEY);
	return null;
}

type Products = { state: 'idle' } | { state: 'loaded'; list: Product[] } | { state: 'error' };

export function MenuPage() {
	const drawer = useDrawer();
	const [menuTypes, setMenuTypes] = useState<MenuType[]>([]);
	const [categories, setCategories] = useState<Category[]>([]);
	const [typeId, setTypeId] = useState<number | null>(null);
	const [categoryId, setCategoryId] = useState<number | null>(null);
	const [products, setProducts] = useState<Products>({ state: 'idle' });
	const [order, setOrder] = useState(loadOrder);
	const [openProduct, setOpenProduct] = useState<Product | null>(null);
	const [orderOpen, setOrderOpen] = useState(false);
	const [tabsScrollable, setTabsScrollable] = useState(false);

	const optionsRef = useRef<HTMLDivElement>(null);
	const indicatorRef = useRef<HTMLSpanElement>(null);
	const orderButtonRef = useRef<HTMLButtonElement>(null);
	const total = totalQuantity(order);
	const badgeText = total > 0 ? faNumber(total) : '';
	const badgeRef = useBump<HTMLSpanElement>(badgeText);

	// ─── load the menu structure once ──────────────────────────────────────────
	useEffect(() => {
		let cancelled = false;
		Promise.all([fetchMenuTypes().catch(() => [] as MenuType[]), fetchCategories().catch(() => [] as Category[])]).then(([types, cats]) => {
			if (cancelled) return;
			setMenuTypes(types);
			setCategories(cats);
			const stored = storedNumber(TYPE_KEY);
			const initial = types.some((t) => t.id === stored) ? stored : (types[0]?.id ?? null);
			if (initial !== null) safeStorage.set(TYPE_KEY, String(initial));
			setTypeId(initial);
			const first = pickCategory(initial, cats);
			setCategoryId(first);
			// a type with no category shows the "coming soon" text, like before
			if (first === null) setProducts({ state: 'loaded', list: [] });
		});
		return () => {
			cancelled = true;
		};
	}, []);

	// ─── products of the selected category (only the latest request wins) ─────
	useEffect(() => {
		if (categoryId === null) return;
		const controller = new AbortController();
		fetchProducts(categoryId, controller.signal)
			.then((list) => setProducts({ state: 'loaded', list: Array.isArray(list) ? list : [] }))
			.catch((error) => {
				if (controller.signal.aborted) return;
				console.error('Failed to fetch products:', error);
				// a server / network problem is a connection error, not "no products"
				const serverSide = !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
				setProducts(serverSide ? { state: 'error' } : { state: 'loaded', list: [] });
			});
		return () => controller.abort();
	}, [categoryId]);

	// ─── the sliding line under the selected menu type ─────────────────────────
	const placeIndicator = useCallback(() => {
		const container = optionsRef.current;
		const indicator = indicatorRef.current;
		if (!container || !indicator) return;
		const containerRect = container.getBoundingClientRect();
		// Room for the tabs: from the header's edge up to the logo / order button. The usual three tabs
		// already spill a little past their own box on phones (as they always did), which is fine;
		// only running into the logo or off the screen, or wrapping, switches the row to scrolling.
		const headerTop = container.parentElement;
		const headerRect = headerTop?.getBoundingClientRect();
		const minLeft = headerRect && headerTop ? headerRect.left + parseFloat(getComputedStyle(headerTop).paddingLeft) - 1 : -Infinity;
		const rightBlock = headerTop?.querySelector('.menu-header-right');
		const maxRight = rightBlock?.children.length ? Math.min(...[...rightBlock.children].map((c) => c.getBoundingClientRect().left)) - 4 : Infinity;
		const buttons = [...container.querySelectorAll('button')];
		const lowest = Math.min(...buttons.map((b) => b.offsetHeight));
		setTabsScrollable(
			buttons.some((b) => {
				const r = b.getBoundingClientRect();
				return r.left < minLeft || r.right > maxRight || b.offsetHeight > lowest + 2;
			}),
		);
		const button = container.querySelector<HTMLButtonElement>('button.selected');
		if (!button) {
			indicator.style.opacity = '0';
			return;
		}
		const rect = button.getBoundingClientRect();
		indicator.style.width = `${rect.width}px`;
		indicator.style.transform = `translateX(${rect.left - containerRect.left + (container.scrollLeft || 0)}px)`;
		indicator.style.opacity = '1';
	}, []);

	useLayoutEffect(placeIndicator, [typeId, categoryId, menuTypes, tabsScrollable, placeIndicator]);
	// re-measure whenever a tab changes size: window resize, and the web font arriving after the first
	// paint (before, the line stayed misaligned until the first click)
	useEffect(() => {
		const container = optionsRef.current;
		if (!container) return;
		const observer = new ResizeObserver(() => placeIndicator());
		observer.observe(container);
		container.querySelectorAll('button').forEach((button) => observer.observe(button));
		return () => observer.disconnect();
	}, [menuTypes, placeIndicator]);

	const selectType = (id: number, button: HTMLButtonElement) => {
		if (tabsScrollable) button.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
		if (id === typeId) return;
		safeStorage.set(TYPE_KEY, String(id));
		setTypeId(id);
		const next = pickCategory(id, categories);
		setCategoryId(next);
		if (next === null) setProducts({ state: 'loaded', list: [] });
	};

	const selectCategory = (id: number) => {
		safeStorage.set(CATEGORY_KEY, String(id));
		setCategoryId(id);
	};

	// arrow keys / Home / End move between categories, Enter / Space selects
	const onCategoryKeys = (event: KeyboardEvent<HTMLUListElement>) => {
		const anchors = [...event.currentTarget.querySelectorAll('a')];
		if (!anchors.length) return;
		let index = anchors.indexOf(document.activeElement as HTMLAnchorElement);
		if (index === -1) {
			const li = (document.activeElement as HTMLElement | null)?.closest?.('li');
			if (li) index = anchors.indexOf(li.querySelector('a') as HTMLAnchorElement);
		}
		const focus = (a: HTMLAnchorElement) => {
			a.focus();
			a.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
		};
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			const next = index === -1 ? 0 : event.key === 'ArrowLeft' ? (index - 1 + anchors.length) % anchors.length : (index + 1) % anchors.length;
			focus(anchors[next]);
		} else if (event.key === 'Home') {
			event.preventDefault();
			focus(anchors[0]);
		} else if (event.key === 'End') {
			event.preventDefault();
			focus(anchors[anchors.length - 1]);
		} else if (event.key === 'Enter' || event.key === ' ') {
			const li = (document.activeElement as HTMLElement | null)?.closest?.('li');
			if (li) {
				event.preventDefault();
				li.click();
			}
		}
	};

	// ─── order list actions ─────────────────────────────────────────────────────
	const add = useCallback((product: Product, addOns: AddOn[] = []) => setOrder(addItem(product, addOns)), []);
	const closeProduct = useCallback(() => setOpenProduct(null), []);
	const closeOrder = useCallback(() => setOrderOpen(false), []);

	/** Card "−": the product's most recently added line (any add-on variant). */
	const decreaseProduct = (product: Product) => {
		const lines = order.items.filter((item) => item.id === String(product.id));
		if (lines.length) setOrder(decreaseItem(lines[lines.length - 1].key));
	};

	const typeCategories = categories.filter((c) => c.menuTypeId === typeId);

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
							<button
								id="order-list-button"
								className={`order-list-button${total > 0 ? ' has-order' : ''}`}
								type="button"
								aria-label={total > 0 ? `باز کردن لیست سفارش، ${faNumber(total)} آیتم` : 'باز کردن لیست سفارش'}
								aria-haspopup="dialog"
								aria-controls="order-dialog"
								aria-expanded={orderOpen}
								ref={orderButtonRef}
								onClick={() => setOrderOpen(true)}
							>
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
									<path
										fill="currentColor"
										d="M7 3h10a2 2 0 0 1 2 2v14.5a1 1 0 0 1-1.45.9L16 19.62l-1.55.78a1 1 0 0 1-.9 0L12 19.62l-1.55.78a1 1 0 0 1-.9 0L8 19.62l-1.55.78A1 1 0 0 1 5 19.5V5a2 2 0 0 1 2-2Zm0 2v12.88l.55-.28a1 1 0 0 1 .9 0l1.55.78l1.55-.78a1 1 0 0 1 .9 0l1.55.78l1.55-.78a1 1 0 0 1 .9 0l.55.28V5H7Zm2 3h6v2H9V8Zm0 4h6v2H9v-2Z"
									/>
								</svg>
								<span className="order-list-badge" hidden={total === 0} ref={badgeRef}>
									{badgeText || '0'}
								</span>
							</button>
						</div>
						<div className={`menu-options${tabsScrollable ? ' is-scrollable' : ''}`} ref={optionsRef}>
							{menuTypes.map((type) => (
								<button
									key={type.id}
									id={`menu-type-${type.id}`}
									data-menu={type.id}
									className={type.id === typeId ? 'selected' : undefined}
									onClick={(event) => selectType(type.id, event.currentTarget)}
								>
									{type.name}
								</button>
							))}
							<span className="type-indicator" ref={indicatorRef}></span>
						</div>
					</div>
					<nav className="menu-nav" role="navigation" aria-label="منوی دسته‌بندی‌ها">
						<ul id="menu-categories" className="menu-categories" role="list" onKeyDown={onCategoryKeys}>
							{typeCategories.map((category) => (
								<li
									key={category.id}
									data-category-id={category.id}
									className={category.id === categoryId ? 'selected' : undefined}
									onClick={(event) => {
										event.preventDefault();
										selectCategory(category.id);
									}}
								>
									<a href="#">{category.name}</a>
								</li>
							))}
						</ul>
					</nav>
				</header>

				<main className="menu-main">
					{products.state === 'error'
						? ERROR_TEXT
						: products.state === 'loaded' &&
							(products.list.length === 0
								? EMPTY_TEXT
								: products.list.map((product, index) => (
										<ProductCard
											key={product.id}
											product={product}
											index={index}
											quantity={productQuantity(order, product.id)}
											onOpen={() => setOpenProduct(product)}
											// a product with add-ons opens its details so the add-ons can be chosen
											onIncrease={() => (product.addOns.length ? setOpenProduct(product) : add(product))}
											onDecrease={() => decreaseProduct(product)}
										/>
									)))}
				</main>
			</div>

			<SiteFooter links={['about', 'contact', 'reserve', 'feedback']} credit="Made with love 🤍" />
			<MobileDrawer drawer={drawer} links={['about', 'contact', 'feedback', 'reserve']} />

			<OrderDialog
				open={orderOpen}
				order={order}
				openButtonRef={orderButtonRef}
				onClose={closeOrder}
				onIncrease={(item: OrderItem) => setOrder(addItem(item, item.addOns))}
				onDecrease={(item) => setOrder(decreaseItem(item.key))}
				onRemove={(item) => setOrder(removeItem(item.key))}
				onClear={() => setOrder(clearOrder())}
			/>
			<ProductDialog product={openProduct} order={order} onAdd={add} onDecrease={(key) => setOrder(decreaseItem(key))} onClose={closeProduct} />
		</>
	);
}

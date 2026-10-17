import type { MapConfig, ViewBox } from './types';

// Pan, pinch-zoom, wheel-zoom and zone focus for the floor map. This works directly on the <svg>
// element's viewBox (dozens of updates per second while dragging), outside React rendering.

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const rounded = (value: number) => Math.round(Number(value) * 10) / 10;

export function normalizeViewBox(input: ViewBox | number[]): ViewBox {
	if (Array.isArray(input)) {
		const [x, y, width, height] = input.map(Number);
		return { x, y, width, height };
	}
	return { x: Number(input.x), y: Number(input.y), width: Number(input.width), height: Number(input.height) };
}

interface Point {
	x: number;
	y: number;
}

export class MapViewport {
	readonly defaultView: ViewBox;
	currentView: ViewBox;
	activeZone = 'ALL';
	/** The view shows a whole zone (refit on resize) rather than a free pan / zoom position. */
	viewIsZone = true;
	zoom = 1;

	private animationFrame: number | null = null;
	private pointers = new Map<number, Point>();
	private pan: { pointerId: number; x: number; y: number; view: ViewBox } | null = null;
	private pinch: { distance: number; view: ViewBox; anchor: Point } | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private cleanups: (() => void)[] = [];

	constructor(
		private readonly svg: SVGSVGElement,
		private readonly config: MapConfig,
		private readonly onZoneChange: (zone: string) => void,
	) {
		this.defaultView = normalizeViewBox(config.defaultView ?? config.viewBox);
		this.currentView = { ...this.defaultView };
	}

	start(): void {
		this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
		this.bindNavigation();
		// روی گوشی (کادر عمودی/مربعی) کل نقشه خیلی ریز دیده می‌شه؛ پس از اولین سالن شروع می‌کنیم.
		// روی دسکتاپ مثل قبل کل نقشه نمایش داده می‌شه.
		const startZone = this.isCompact() ? this.firstZoneKey() : 'ALL';
		this.activeZone = startZone;
		this.viewIsZone = true;
		this.onZoneChange(startZone);
		this.applyViewBox(this.zoneBounds(startZone), true);
		// با چرخش گوشی یا تغییر اندازه‌ی پنجره، نما دوباره با کادر هم‌اندازه می‌شه
		let lastSize = '';
		this.resizeObserver = new ResizeObserver(() => {
			const rect = this.svg.getBoundingClientRect();
			const size = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
			if (size === lastSize || !rect.width || !rect.height) return;
			lastSize = size;
			if (this.viewIsZone) {
				this.applyViewBox(this.zoneBounds(this.activeZone), true);
			} else {
				// همون مرکز و همون بزرگ‌نمایی حفظ می‌شه
				const width = this.fullView().width / (this.zoom || 1);
				const height = width * this.containerRatio();
				const cx = this.currentView.x + this.currentView.width / 2;
				const cy = this.currentView.y + this.currentView.height / 2;
				this.applyViewBox({ x: cx - width / 2, y: cy - height / 2, width, height }, true);
			}
		});
		this.resizeObserver.observe(this.svg);
	}

	destroy(): void {
		if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
		this.resizeObserver?.disconnect();
		this.cleanups.forEach((cleanup) => cleanup());
		this.cleanups = [];
	}

	/** کادر نقشه تقریباً مربع یا عمودیه (گوشی)؟ اون‌وقت کل نقشه‌ی ۲:۱ خیلی ریز دیده می‌شه. */
	isCompact(): boolean {
		const rect = this.svg.getBoundingClientRect();
		return rect.width > 0 && rect.height / rect.width >= 0.75;
	}

	firstZoneKey(): string {
		return Object.keys(this.config.zones || {}).find((key) => key !== 'ALL') || 'ALL';
	}

	zoneBounds(zoneKey: string): ViewBox {
		const zone = this.config.zones?.[zoneKey] || this.config.zones?.ALL;
		return zone ? normalizeViewBox(zone.bounds) : { ...this.defaultView };
	}

	/** «⌂»: whole map on desktop, the current zone on phones. */
	reset(): void {
		this.focusZone(this.isCompact() ? this.activeZone || 'ALL' : 'ALL');
	}

	focusZone(zoneKey: string): void {
		const key = this.config.zones?.[zoneKey] ? zoneKey : 'ALL';
		this.activeZone = key;
		this.viewIsZone = true;
		this.onZoneChange(key);
		this.animateViewBox(this.zoneBounds(key));
	}

	zoomBy(factor: number, center: Point | null = null): void {
		this.viewIsZone = false;
		const full = this.fullView();
		const maxZoom = this.config.limits?.maxZoom || 3.2;
		const currentZoom = full.width / this.currentView.width;
		const newZoom = clamp(currentZoom * factor, 1, maxZoom);
		const width = full.width / newZoom;
		const height = width * this.containerRatio();
		const focus = center || {
			x: this.currentView.x + this.currentView.width / 2,
			y: this.currentView.y + this.currentView.height / 2,
		};
		const rx = (focus.x - this.currentView.x) / this.currentView.width;
		const ry = (focus.y - this.currentView.y) / this.currentView.height;
		this.applyViewBox({ x: focus.x - width * rx, y: focus.y - height * ry, width, height }, true);
	}

	clientToSvg(clientX: number, clientY: number): Point {
		const point = this.svg.createSVGPoint();
		point.x = clientX;
		point.y = clientY;
		const matrix = this.svg.getScreenCTM();
		return matrix ? point.matrixTransform(matrix.inverse()) : { x: 0, y: 0 };
	}

	/** نسبت ارتفاع به عرض کادر نقشه روی صفحه (اگر هنوز اندازه نداره، نسبت خود نقشه). */
	private containerRatio(): number {
		const rect = this.svg.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) return rect.height / rect.width;
		return this.defaultView.height / this.defaultView.width;
	}

	/** کوچک‌ترین نمایی که کل نقشه رو با نسبت کادر نشون می‌ده (زوم ۱). */
	private fullView(): { width: number; height: number } {
		const base = this.defaultView;
		const ratio = this.containerRatio();
		const width = Math.max(base.width, base.height / ratio);
		return { width, height: width * ratio };
	}

	/**
	 * نما همیشه دقیقاً هم‌نسبتِ کادر نقشه نگه داشته می‌شه، تا روی گوشی کادر خالی نمونه و
	 * جابه‌جایی با انگشت با حرکت واقعی انگشت جور باشه. روی دسکتاپ (کادر ۲:۱) مثل نقشه‌ی اصلیه.
	 */
	private applyViewBox(view: ViewBox, clampToMap = true): void {
		const requested = normalizeViewBox(view);
		const ratio = this.containerRatio();
		const centerX = requested.x + requested.width / 2;
		const centerY = requested.y + requested.height / 2;
		let width = Math.max(requested.width, requested.height / ratio);
		if (clampToMap) {
			const full = this.fullView();
			const maxZoom = this.config.limits?.maxZoom || 3.2;
			width = clamp(width, full.width / maxZoom, full.width);
		}
		const height = width * ratio;
		const next = { x: centerX - width / 2, y: centerY - height / 2, width, height };
		if (clampToMap) {
			const base = this.defaultView;
			// اگر نما از نقشه بزرگ‌تره، نقشه وسط کادر می‌مونه؛ وگرنه نما از لبه‌ی نقشه بیرون نمی‌زنه
			next.x = width >= base.width ? base.x + (base.width - width) / 2 : clamp(next.x, base.x, base.x + base.width - width);
			next.y = height >= base.height ? base.y + (base.height - height) / 2 : clamp(next.y, base.y, base.y + base.height - height);
		}
		this.currentView = next;
		this.zoom = this.fullView().width / next.width;
		this.svg.setAttribute('viewBox', `${rounded(next.x)} ${rounded(next.y)} ${rounded(next.width)} ${rounded(next.height)}`);
	}

	private animateViewBox(target: ViewBox): void {
		if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
		const from = { ...this.currentView };
		// مقصد اول با نسبت کادر تطبیق داده و داخل محدوده‌ی نقشه نگه داشته می‌شه تا انیمیشن بدون پرش تموم بشه
		this.applyViewBox(target, true);
		const to = { ...this.currentView };
		this.applyViewBox(from, false);
		const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		const started = performance.now();
		const duration = reduceMotion ? 0 : 430;
		const tick = (now: number) => {
			const progress = duration ? clamp((now - started) / duration, 0, 1) : 1;
			const eased = 1 - Math.pow(1 - progress, 3);
			this.applyViewBox(
				{
					x: from.x + (to.x - from.x) * eased,
					y: from.y + (to.y - from.y) * eased,
					width: from.width + (to.width - from.width) * eased,
					height: from.height + (to.height - from.height) * eased,
				},
				false,
			);
			this.animationFrame = progress < 1 ? requestAnimationFrame(tick) : null;
		};
		this.animationFrame = requestAnimationFrame(tick);
	}

	private listen<K extends keyof WindowEventMap>(target: Window, type: K, handler: (event: WindowEventMap[K]) => void): void;
	private listen<K extends keyof SVGElementEventMap>(target: SVGSVGElement, type: K, handler: (event: SVGElementEventMap[K]) => void, options?: AddEventListenerOptions): void;
	private listen(target: EventTarget, type: string, handler: (event: never) => void, options?: AddEventListenerOptions): void {
		target.addEventListener(type, handler as EventListener, options);
		this.cleanups.push(() => target.removeEventListener(type, handler as EventListener, options));
	}

	private bindNavigation(): void {
		this.listen(
			this.svg,
			'wheel',
			(event) => {
				// زوم فقط با Ctrl/⌘ + چرخ؛ در غیر این صورت صفحه عادی اسکرول بشه
				if (!event.ctrlKey && !event.metaKey) return;
				event.preventDefault();
				const factor = event.deltaY < 0 ? 1.14 : 1 / 1.14;
				this.zoomBy(factor, this.clientToSvg(event.clientX, event.clientY));
			},
			{ passive: false },
		);

		// انگشت‌های فعال روی نقشه: یک انگشت = جابه‌جایی، دو انگشت = زوم (pinch)
		const startPan = (pointerId: number, x: number, y: number) => {
			this.pan = { pointerId, x, y, view: { ...this.currentView } };
		};
		const startPinch = () => {
			const [a, b] = [...this.pointers.values()];
			const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
			this.pan = null;
			this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, view: { ...this.currentView }, anchor: this.clientToSvg(mid.x, mid.y) };
		};

		this.listen(this.svg, 'pointerdown', (event) => {
			if (event.button !== 0 || (event.target as Element).closest('.roof-table-anchor')) return;
			if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
			this.viewIsZone = false;
			this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			try {
				this.svg.setPointerCapture(event.pointerId);
			} catch {
				// بعضی مرورگرها برای pointer نامعتبر خطا می‌دن؛ جابه‌جایی بدون capture هم کار می‌کنه
			}
			this.svg.classList.add('is-panning');
			if (this.pointers.size === 1) startPan(event.pointerId, event.clientX, event.clientY);
			else if (this.pointers.size === 2) startPinch();
		});

		this.listen(this.svg, 'pointermove', (event) => {
			if (!this.pointers.has(event.pointerId)) return;
			this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			const rect = this.svg.getBoundingClientRect();
			if (this.pinch && this.pointers.size >= 2) {
				const [a, b] = [...this.pointers.values()];
				const scale = (Math.hypot(a.x - b.x, a.y - b.y) || 1) / this.pinch.distance;
				const width = this.pinch.view.width / scale;
				const height = this.pinch.view.height / scale;
				// نقطه‌ی وسط دو انگشت زیر انگشت‌ها ثابت می‌مونه
				const midX = ((a.x + b.x) / 2 - rect.left) / rect.width;
				const midY = ((a.y + b.y) / 2 - rect.top) / rect.height;
				this.applyViewBox({ x: this.pinch.anchor.x - width * midX, y: this.pinch.anchor.y - height * midY, width, height }, true);
				return;
			}
			if (!this.pan || this.pan.pointerId !== event.pointerId) return;
			const dx = ((event.clientX - this.pan.x) / rect.width) * this.pan.view.width;
			const dy = ((event.clientY - this.pan.y) / rect.height) * this.pan.view.height;
			this.applyViewBox({ ...this.pan.view, x: this.pan.view.x - dx, y: this.pan.view.y - dy }, true);
		});

		const finishPointer = (event: PointerEvent) => {
			if (!this.pointers.has(event.pointerId)) return;
			this.pointers.delete(event.pointerId);
			if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
			this.pinch = null;
			if (this.pointers.size === 1) {
				// بعد از برداشتن یک انگشت، با انگشت باقی‌مانده جابه‌جایی ادامه پیدا می‌کنه
				const [[pointerId, point]] = [...this.pointers.entries()];
				startPan(pointerId, point.x, point.y);
			} else if (this.pointers.size === 0) {
				this.pan = null;
				this.svg.classList.remove('is-panning');
			}
		};
		this.listen(this.svg, 'pointerup', finishPointer);
		this.listen(this.svg, 'pointercancel', finishPointer);
		// اگر انگشت بیرون از نقشه برداشته شد (و capture در دسترس نبود)، اینجا پاک می‌شه تا
		// لمس بعدی به‌اشتباه دو انگشتی حساب نشه
		this.listen(window, 'pointerup', finishPointer);
		this.listen(window, 'pointercancel', finishPointer);
	}
}

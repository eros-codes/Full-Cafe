import { useEffect, useState, type ReactNode } from 'react';
import { faNumber } from '../../shared/format';
import { ICONS, type IconName } from '../../shared/icons';

export const ZONE_FA: Record<string, string> = { WINDOW: 'سالن پنجره', CENTER: 'سالن وسط', ROOF: 'روف گاردن' };
export const SHAPE_FA: Record<string, string> = { ROUND: 'گرد', SQUARE: 'مربع', RECTANGLE: 'مستطیل' };
export const fa = (n: unknown) => faNumber(Number(n || 0));

export function Kpi({ icon, label, value }: { icon: IconName; label: string; value: string }) {
	return (
		<div className="kpi">
			<div className="kpi-icon">{ICONS[icon]}</div>
			<span>{label}</span>
			<strong>{value}</strong>
		</div>
	);
}

export function SkeletonKpis({ count }: { count: number }) {
	return (
		<>
			{Array.from({ length: count }, (_, i) => (
				<div className="kpi" key={i}>
					<div className="skeleton" style={{ height: '12px', width: '60%', marginBottom: '10px' }}></div>
					<div className="skeleton" style={{ height: '22px', width: '40%' }}></div>
				</div>
			))}
		</>
	);
}

export function Skeleton({ height }: { height: number }) {
	return <div className="skeleton" style={{ height: `${height}px` }}></div>;
}

export function ErrorNotice({ message }: { message: string }) {
	return <div className="notice danger">{message}</div>;
}

export function EmptyState({ title, text }: { title: string; text: string }) {
	return (
		<div className="empty-state">
			{ICONS.empty}
			<strong>{title}</strong>
			<p>{text}</p>
		</div>
	);
}

export type NoticeState = { type: string; text: ReactNode } | null;

/** `<div class="notice …">` that renders nothing-styled (empty div) when there is no message. */
export function Notice({ notice, id }: { notice: NoticeState; id?: string }) {
	return (
		<div id={id} className={notice ? `notice ${notice.type}`.trim() : undefined}>
			{notice?.text}
		</div>
	);
}

/** A notice that disappears after a few seconds unless it is an error (menu sections). */
export function useFlash(timeoutMs = 3200) {
	const [flash, setFlash] = useState<{ type: string; text: string; id: number } | null>(null);
	useEffect(() => {
		if (!flash || flash.type === 'danger') return;
		const timer = window.setTimeout(() => setFlash(null), timeoutMs);
		return () => window.clearTimeout(timer);
	}, [flash, timeoutMs]);
	const show = (text: string, type = 'danger') => setFlash({ type, text, id: Date.now() });
	return { flash, show, clear: () => setFlash(null) };
}

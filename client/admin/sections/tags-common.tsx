import type { ReactNode } from 'react';
import { adminApi } from '../common/adminApi';
import type { CategoryKind, CategoryRow, ProductRow } from './menu-common';

// «انتخاب برای من» in the admin panel: the tag groups (the questions), and the tag pickers of the category
// and product forms. The rules (inheritance, «هیچ‌کدام», vegan → vegetarian) are the server's
// (src/services/recommender.service.ts); the pickers only show them while the admin edits.

export const KINDS: readonly CategoryKind[] = ['DRINK', 'FOOD', 'DESSERT'];
export const KIND_FA: Record<CategoryKind, string> = { DRINK: 'نوشیدنی', FOOD: 'غذا', DESSERT: 'دسر' };

export interface TagOptionRow {
	id: number;
	groupId: number;
	label: string;
	key: string | null;
	sortOrder: number;
	/** Products that carry the option themselves (not counting the ones that inherit it). */
	productCount: number;
	categoryCount: number;
}

export interface TagGroupRow {
	id: number;
	key: string | null;
	name: string;
	question: string;
	questionByKind: Partial<Record<CategoryKind, string>> | null;
	multi: boolean;
	/** The options are a scale (شیرین ← کم‌شیرین ← تلخ): the neighbour of the answer counts half. */
	ordered: boolean;
	/** SOFT = a taste question; HARD = a restriction (only in «محدودیت غذایی داری؟»). */
	strictness: 'SOFT' | 'HARD';
	importance: number;
	kinds: CategoryKind[];
	isActive: boolean;
	sortOrder: number;
	options: TagOptionRow[];
}

export interface TagCoverage {
	/** Active taste groups: products they apply to, and how many are done (tagged or «هیچ‌کدام»). */
	groups: { id: number; name: string; relevant: number; tagged: number }[];
	incomplete: { productId: number; missingGroupIds: number[] }[];
	/** Products in categories without a kind (never recommended). */
	withoutKind: number;
}

export const fetchTagGroups = () => adminApi<{ groups: TagGroupRow[] }>('/api/admin/tag-groups').then((r) => r.groups);
export const fetchCoverage = () => adminApi<TagCoverage>('/api/admin/tags/coverage');

/** The groups a category or product of this kind is tagged with: active, meant for the kind, with options. */
export function groupsForKind(groups: readonly TagGroupRow[], kind: CategoryKind | null | undefined): TagGroupRow[] {
	return kind ? groups.filter((g) => g.isActive && g.options.length > 0 && g.kinds.includes(kind)) : [];
}

const inGroup = (group: TagGroupRow, optionId: number) => group.options.some((o) => o.id === optionId);

/** Mirror of OPTION_IMPLIES in src/services/recommender.service.ts (the server applies it again on save). */
const OPTION_IMPLIES: Readonly<Record<string, readonly string[]>> = { vegan: ['vegetarian'] };

/** Options of the group that `optionId` implies («وگان» → «گیاهخوار»). */
export function impliedBy(group: TagGroupRow, optionId: number): number[] {
	const key = group.options.find((o) => o.id === optionId)?.key;
	const keys = key ? (OPTION_IMPLIES[key] ?? []) : [];
	return group.options.filter((o) => o.key && keys.includes(o.key)).map((o) => o.id);
}

/** Options of the group that imply `optionId` («گیاهخوار» ← «وگان»). */
export function implying(group: TagGroupRow, optionId: number): number[] {
	return group.options.filter((o) => o.id !== optionId && impliedBy(group, o.id).includes(optionId)).map((o) => o.id);
}

/**
 * Ticks or unticks one option of a group (`selected` = the group's ticked options). Ticking «وگان» ticks
 * «گیاهخوار» too, unticking «گیاهخوار» unticks «وگان»: exactly what the server would save. Group order.
 */
export function toggleOption(group: TagGroupRow, selected: readonly number[], optionId: number): number[] {
	const set = new Set(selected.filter((id) => inGroup(group, id)));
	if (set.has(optionId)) {
		set.delete(optionId);
		implying(group, optionId).forEach((id) => set.delete(id));
	} else {
		set.add(optionId);
		impliedBy(group, optionId).forEach((id) => set.add(id));
	}
	return group.options.filter((o) => set.has(o.id)).map((o) => o.id);
}

const sameSet = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((id) => b.includes(id));

export function TagChip({ on, inherited, onClick, children }: { on: boolean; inherited?: boolean; onClick: () => void; children: ReactNode }) {
	return (
		<button type="button" className={`tag-chip${on ? ' on' : ''}${on && inherited ? ' inherited' : ''}`} aria-pressed={on} onClick={onClick}>
			{children}
		</button>
	);
}

export function TagRow({ group, status, action, children }: { group: TagGroupRow; status?: ReactNode; action?: ReactNode; children: ReactNode }) {
	return (
		<div className="tag-row">
			<div className="tag-row-head">
				<span className="tag-row-name">{group.name}</span>
				{group.strictness === 'HARD' && <small className="tag-row-note">محدودیت: بدون برچسب یعنی مناسب آن نیست</small>}
				{status}
				{action}
			</div>
			<div className="tag-chips" role="group" aria-label={group.name}>
				{children}
			</div>
		</div>
	);
}

// ─── Category form ───────────────────────────────────────────────────────────

/**
 * The tags every product of the category inherits. Only the groups of the category's kind are shown; ticks
 * of other groups (another kind, an inactive group) are kept as they are.
 */
export function CategoryTagsField({
	groups,
	kind,
	value,
	onChange,
}: {
	groups: readonly TagGroupRow[];
	kind: CategoryKind | null;
	value: number[];
	onChange: (value: number[]) => void;
}) {
	const shown = groupsForKind(groups, kind);
	let body: ReactNode;
	if (!kind) body = <p className="hint">دسته‌ی بدون نوع در «انتخاب برای من» نیست (مثلاً قلیان)؛ برای برچسب زدن، اول نوعش را انتخاب کن.</p>;
	else if (!shown.length) body = <p className="hint">{`برای «${KIND_FA[kind]}» هنوز گروه برچسب فعالی تعریف نشده.`}</p>;
	else
		body = (
			<div className="tag-rows">
				{shown.map((group) => {
					const ticked = value.filter((id) => inGroup(group, id));
					return (
						<TagRow key={group.id} group={group}>
							{group.options.map((option) => (
								<TagChip
									key={option.id}
									on={ticked.includes(option.id)}
									onClick={() => onChange([...value.filter((id) => !inGroup(group, id)), ...toggleOption(group, ticked, option.id)])}
								>
									{option.label}
								</TagChip>
							))}
						</TagRow>
					);
				})}
			</div>
		);
	return (
		<div className="field tag-field">
			<label>برچسب‌های «انتخاب برای من»</label>
			{kind && shown.length > 0 && (
				<p className="hint tag-field-hint">همه‌ی محصولات این دسته این برچسب‌ها را می‌گیرند، مگر محصولی که در فرم خودش آن گروه را جور دیگری تعیین کند.</p>
			)}
			{body}
		</div>
	);
}

// ─── Product form ────────────────────────────────────────────────────────────

/** The groups a product sets itself: group id → its options (an empty list = «هیچ‌کدام»). */
export type OwnTags = Record<number, number[]>;

export function ownTagsOf(product: ProductRow | null, groups: readonly TagGroupRow[]): OwnTags {
	const own: OwnTags = {};
	if (!product) return own;
	const groupOf = new Map(groups.flatMap((g) => g.options.map((o) => [o.id, g.id] as const)));
	for (const groupId of product.tagGroupIds) own[groupId] = [];
	for (const optionId of product.tagOptionIds) {
		const groupId = groupOf.get(optionId);
		if (groupId !== undefined && own[groupId]) own[groupId].push(optionId);
	}
	return own;
}

/** The `tags` field of the product API: every group the product sets itself (shown or not). */
export const ownTagsBody = (own: OwnTags) => Object.entries(own).map(([groupId, optionIds]) => ({ groupId: Number(groupId), optionIds }));

/**
 * A product's tags. Per group: what it inherits from its category (pale, «از دسته»), or what it sets itself.
 * Touching a group makes it the product's own; «مثل دسته» gives it back to the category. «هیچ‌کدام»
 * (taste groups) = none of the options fits this product: a miss for the customer's answer, not "unknown".
 */
export function ProductTagsField({
	groups,
	category,
	own,
	onChange,
}: {
	groups: readonly TagGroupRow[];
	category: CategoryRow | undefined;
	own: OwnTags;
	onChange: (own: OwnTags) => void;
}) {
	const kind = category?.kind ?? null;
	const shown = groupsForKind(groups, kind);
	const set = (groupId: number, options: number[] | null) => {
		const next = { ...own };
		if (options === null) delete next[groupId];
		else next[groupId] = options;
		onChange(next);
	};
	let body: ReactNode;
	if (!category) body = null;
	else if (!kind)
		body = (
			<p className="hint">{`دسته‌ی «${category.name}» نوع ندارد، پس این محصول در «انتخاب برای من» پیشنهاد نمی‌شود. نوع دسته از بخش «دسته‌بندی منو» تعیین می‌شود.`}</p>
		);
	else if (!shown.length) body = <p className="hint">{`برای «${KIND_FA[kind]}» هنوز گروه برچسب فعالی تعریف نشده.`}</p>;
	else
		body = (
			<div className="tag-rows">
				{shown.map((group) => {
					const inherited = category.tagOptionIds.filter((id) => inGroup(group, id));
					const isOwn = group.id in own;
					const current = isOwn ? own[group.id] : inherited;
					const soft = group.strictness === 'SOFT';
					let status: ReactNode = null;
					if (isOwn) status = <span className="tag-status own">{current.length ? 'مخصوص این محصول' : 'هیچ‌کدام'}</span>;
					else if (inherited.length) status = <span className="tag-status">از دسته</span>;
					else if (soft) status = <span className="tag-status warn">بدون برچسب</span>;
					return (
						<TagRow
							key={group.id}
							group={group}
							status={status}
							action={
								isOwn && (
									<button type="button" className="tag-reset" onClick={() => set(group.id, null)}>
										{inherited.length ? 'مثل دسته' : 'پاک کن'}
									</button>
								)
							}
						>
							{group.options.map((option) => (
								<TagChip
									key={option.id}
									on={current.includes(option.id)}
									inherited={!isOwn}
									onClick={() => {
										const next = toggleOption(group, current, option.id);
										// the same as the category again: inherit (so later category changes reach it)
										set(group.id, sameSet(next, inherited) ? null : next);
									}}
								>
									{option.label}
								</TagChip>
							))}
							{soft && (
								<TagChip on={isOwn && !current.length} onClick={() => set(group.id, isOwn && !current.length ? null : [])}>
									هیچ‌کدام
								</TagChip>
							)}
						</TagRow>
					);
				})}
			</div>
		);
	return (
		<div className="field tag-field">
			<label>برچسب‌های «انتخاب برای من»</label>
			{kind && shown.length > 0 && (
				<p className="hint tag-field-hint">
					برچسب‌های کم‌رنگ از دسته می‌آیند؛ با زدن روی یک گزینه، آن گروه مخصوص همین محصول می‌شود. یک محصول می‌تواند چند گزینه‌ی یک گروه را
					داشته باشد (مثلاً هم گرم هم سرد). «هیچ‌کدام» یعنی هیچ گزینه‌ای به این محصول نمی‌خورد.
				</p>
			)}
			{body}
		</div>
	);
}

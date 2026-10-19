import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, errorText } from '../../shared/api';
import { ICONS } from '../../shared/icons';
import { adminApi } from '../common/adminApi';
import { MenuModal } from '../common/MenuModal';
import { EmptyState, ErrorNotice, Skeleton, fa, useFlash } from '../common/ui';
import { MenuFlash, type CategoryKind } from './menu-common';
import { KINDS, KIND_FA, fetchCoverage, fetchTagGroups, impliedBy, type TagCoverage, type TagGroupRow, type TagOptionRow } from './tags-common';

// Limits of the server (src/routes/admin/tags.routes.ts)
const NAME_MAX = 40;
const QUESTION_MAX = 120;
const OPTION_MAX = 40;
const OPTIONS_MAX = 12;

const IMPORTANCE_FA = ['', 'خیلی کم', 'کم', 'متوسط', 'زیاد', 'خیلی زیاد'];

interface Overview {
	groups: TagGroupRow[];
	coverage: TagCoverage | null;
	/** The switch in «قیمت و تنظیمات». */
	switchedOn: boolean;
	/** What the menu page sees: switched on and there is something to ask and to suggest. */
	live: boolean;
}

async function loadOverview(): Promise<Overview> {
	const [groups, coverage, settings, status] = await Promise.all([
		fetchTagGroups(),
		fetchCoverage().catch(() => null),
		adminApi<{ settings: Record<string, unknown> }>('/api/admin/settings'),
		adminApi<{ enabled: boolean }>('/api/recommender/status').catch(() => ({ enabled: false })),
	]);
	return { groups, coverage, switchedOn: String(settings.settings.recommenderEnabled) === '1', live: status.enabled };
}

/** «۳ محصول و ۱ دسته» */
function usageText(products: number, categories: number): string {
	const parts = [];
	if (products) parts.push(`${fa(products)} محصول`);
	if (categories) parts.push(`${fa(categories)} دسته`);
	return parts.join(' و ');
}

/**
 * «انتخاب برای من»: the tag groups (the questions the customer is asked, and the restrictions) and their
 * options. Manager only: these texts are what every customer reads. Tagging products and categories is done
 * in their own sections (staff can do that too). Reloaded on every visit.
 */
export function Tags({ visit }: { visit: number }) {
	const [data, setData] = useState<Overview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [editing, setEditing] = useState<TagGroupRow | 'new' | null>(null);
	const [optionsOf, setOptionsOf] = useState<number | null>(null);
	const { flash, show } = useFlash();

	useEffect(() => {
		let current = true;
		setData(null);
		setError(null);
		loadOverview()
			.then((overview) => current && setData(overview))
			.catch((err) => current && setError(errorText(err)));
		return () => {
			current = false;
		};
	}, [visit]);

	if (error && !data) return <div id="tagsBox"><ErrorNotice message={error} /></div>;
	if (!data) return <div id="tagsBox"><Skeleton height={220} /></div>;

	const { groups, coverage } = data;

	// after a change: groups, coverage and what the menu page sees (the switch itself only changes in settings)
	const reload = async () => {
		try {
			const [fresh, freshCoverage, status] = await Promise.all([
				fetchTagGroups(),
				fetchCoverage().catch(() => null),
				adminApi<{ enabled: boolean }>('/api/recommender/status').catch(() => null),
			]);
			setData((d) => d && { ...d, groups: fresh, coverage: freshCoverage ?? d.coverage, live: status ? status.enabled : d.live });
		} catch (err) {
			show(errorText(err));
		}
	};

	/** Runs one change, then reads everything again (counts, coverage and order come from the server). */
	const run = async (action: () => Promise<unknown>, success: string) => {
		setBusy(true);
		try {
			await action();
			show(success, 'ok');
		} catch (err) {
			show(errorText(err));
		}
		await reload();
		setBusy(false);
	};

	const move = (index: number, delta: -1 | 1) => {
		const target = index + delta;
		if (target < 0 || target >= groups.length) return;
		const next = groups.slice();
		[next[index], next[target]] = [next[target], next[index]];
		setData({ ...data, groups: next });
		void run(() => adminApi('/api/admin/tag-groups/order', { method: 'PUT', body: { ids: next.map((g) => g.id) } }), 'ترتیب گروه‌ها ذخیره شد.');
	};

	const toggle = (group: TagGroupRow) =>
		run(
			() => adminApi(`/api/admin/tag-groups/${group.id}`, { method: 'PATCH', body: { isActive: !group.isActive } }),
			group.isActive ? `«${group.name}» غیرفعال شد و دیگر پرسیده نمی‌شود (برچسب‌های محصولات می‌ماند).` : `«${group.name}» فعال شد.`,
		);

	const remove = async (group: TagGroupRow) => {
		const used = group.options.some((o) => o.productCount > 0 || o.categoryCount > 0);
		const question = used
			? `برچسب‌های گروه «${group.name}» روی محصولات یا دسته‌ها زده شده و با حذف گروه از همه‌شان برداشته می‌شود. حذف شود؟`
			: `گروه «${group.name}» حذف شود؟`;
		if (!window.confirm(question)) return;
		setBusy(true);
		try {
			try {
				await adminApi(`/api/admin/tag-groups/${group.id}${used ? '?force=1' : ''}`, { method: 'DELETE' });
			} catch (err) {
				// e.g. products that set this group to «هیچ‌کدام»: the server counts them, the option counts do not
				if (!(err instanceof ApiError && err.status === 409)) throw err;
				const where = usageText(Number(err.data.productCount) || 0, Number(err.data.categoryCount) || 0);
				if (!window.confirm(`گروه «${group.name}» روی ${where} تعیین شده و با حذفش از همه‌شان برداشته می‌شود. حذف شود؟`)) return;
				await adminApi(`/api/admin/tag-groups/${group.id}?force=1`, { method: 'DELETE' });
			}
			show('گروه حذف شد.', 'ok');
		} catch (err) {
			show(errorText(err));
		} finally {
			await reload();
			setBusy(false);
		}
	};

	const optionsGroup = groups.find((g) => g.id === optionsOf);

	return (
		<div id="tagsBox">
			<MenuFlash flash={flash} />
			<StatusNotice data={data} />
			<div className="menu-toolbar tag-toolbar">
				<p className="hint">
					الگوریتم خودش مفیدترین سوال بعدی را انتخاب می‌کند؛ ترتیب این فهرست فقط بین دو سوالِ به یک اندازه مفید تصمیم می‌گیرد. برچسب زدن محصولات و
					دسته‌ها از فرم خودشان انجام می‌شود.
				</p>
				<button type="button" className="primary-btn menu-add-btn" disabled={busy} onClick={() => setEditing('new')}>
					{ICONS.plus}
					<span>گروه جدید</span>
				</button>
			</div>
			{groups.length ? (
				<div className="tag-group-list">
					{groups.map((group, index) => (
						<GroupCard
							key={group.id}
							group={group}
							coverage={coverage?.groups.find((g) => g.id === group.id)}
							busy={busy}
							first={index === 0}
							last={index === groups.length - 1}
							onMove={(delta) => move(index, delta)}
							onEdit={() => setEditing(group)}
							onOptions={() => setOptionsOf(group.id)}
							onToggle={() => toggle(group)}
							onRemove={() => remove(group)}
						/>
					))}
				</div>
			) : (
				<EmptyState title="هنوز گروهی نیست" text="هر گروه یک سوال است (مثلاً «گرم یا سرد؟») با گزینه‌هایش. با «گروه جدید» اولین را بساز." />
			)}
			{editing && (
				<GroupForm
					group={editing === 'new' ? null : editing}
					onClose={() => setEditing(null)}
					onSaved={(message) => {
						show(message, 'ok');
						void reload();
					}}
				/>
			)}
			{optionsGroup && <OptionsDialog group={optionsGroup} onClose={() => setOptionsOf(null)} onChanged={reload} />}
		</div>
	);
}

function StatusNotice({ data }: { data: Overview }) {
	const incomplete = data.coverage?.incomplete.length ?? 0;
	const withoutKind = data.coverage?.withoutKind ?? 0;
	return (
		<div className="tag-status-notes">
			{!data.switchedOn ? (
				<div className="notice warn">«انتخاب برای من» خاموش است و مشتری‌ها دکمه‌اش را نمی‌بینند. بعد از برچسب زدن محصولات، از بخش «قیمت و تنظیمات» روشنش کن.</div>
			) : data.live ? (
				<div className="notice ok">روشن است و دکمه‌ی «نمی‌دونی چی انتخاب کنی؟» در صفحه‌ی منو دیده می‌شود.</div>
			) : (
				<div className="notice warn">
					روشن است، ولی دکمه هنوز در منو دیده نمی‌شود: حداقل یک گروه سلیقه‌ی فعال با گزینه، و یک محصول موجود در دسته‌ای که نوع دارد لازم است.
				</div>
			)}
			{incomplete > 0 && <p className="hint">{`${fa(incomplete)} محصول برچسب ناقص دارند؛ در «محصولات منو» با فیلتر «برچسب ناقص» پیدایشان کن.`}</p>}
			{withoutKind > 0 && (
				<p className="hint">{`${fa(withoutKind)} محصول در دسته‌هایی هستند که نوع ندارند و پیشنهاد نمی‌شوند (مثل قلیان). اگر اشتباه است، نوع دسته را در «دسته‌بندی منو» تعیین کن.`}</p>
			)}
		</div>
	);
}

interface CardProps {
	group: TagGroupRow;
	coverage: { relevant: number; tagged: number } | undefined;
	busy: boolean;
	first: boolean;
	last: boolean;
	onMove: (delta: -1 | 1) => void;
	onEdit: () => void;
	onOptions: () => void;
	onToggle: () => void;
	onRemove: () => void;
}

function GroupCard({ group, coverage, busy, first, last, onMove, onEdit, onOptions, onToggle, onRemove }: CardProps) {
	const soft = group.strictness === 'SOFT';
	const kinds = group.kinds.map((k) => KIND_FA[k]).join('، ');
	const ownTexts = group.questionByKind ? Object.keys(group.questionByKind).map((k) => KIND_FA[k as CategoryKind]) : [];
	const share = coverage && coverage.relevant ? coverage.tagged / coverage.relevant : 0;
	return (
		<article className={`tag-group-card${group.isActive ? '' : ' inactive'}`}>
			<div className="tag-group-head">
				<div className="menu-order-btns">
					<button type="button" className="menu-order-btn" aria-label={`«${group.name}» یکی بالاتر`} disabled={busy || first} onClick={() => onMove(-1)}>
						{ICONS.up}
					</button>
					<button type="button" className="menu-order-btn" aria-label={`«${group.name}» یکی پایین‌تر`} disabled={busy || last} onClick={() => onMove(1)}>
						{ICONS.down}
					</button>
				</div>
				<h4 className="tag-group-name">{group.name}</h4>
				<span className={`status${soft ? '' : ' HOLD'}`}>{soft ? 'سلیقه' : 'محدودیت غذایی'}</span>
				{!group.isActive && <span className="status CANCELLED">غیرفعال</span>}
			</div>
			<p className="tag-group-q">{`«${group.question}»`}</p>
			<p className="tag-group-meta">
				{soft
					? `برای: ${kinds} · اهمیت: ${IMPORTANCE_FA[group.importance]} (${fa(group.importance)} از ۵) · ${group.multi ? 'چند انتخابی' : 'تک انتخابی'}${group.ordered ? ' · طیف' : ''}`
					: `برای: ${kinds} · فقط وقتی مشتری «محدودیت غذایی داری؟» را بزند`}
				{ownTexts.length > 0 && ` · متن جدا برای ${ownTexts.join('، ')}`}
			</p>
			<div className="tag-chips tag-chips-static">
				{group.options.length ? (
					group.options.map((o) => (
						<span key={o.id} className="tag-chip static">
							{o.label}
						</span>
					))
				) : (
					<span className="hint">هنوز گزینه‌ای ندارد.</span>
				)}
			</div>
			{soft && group.options.length < 2 && <p className="tag-group-warn">با کمتر از دو گزینه این سوال هیچ‌وقت پرسیده نمی‌شود.</p>}
			{soft && group.isActive && coverage && (
				<div className="tag-coverage">
					<div className="tag-coverage-bar" aria-hidden="true">
						<span style={{ width: `${Math.round(share * 100)}%` }}></span>
					</div>
					<small>
						{coverage.relevant
							? `${fa(coverage.tagged)} از ${fa(coverage.relevant)} محصول مرتبط برچسب دارند`
							: 'هنوز محصولی از این نوع‌ها در منو نیست'}
					</small>
				</div>
			)}
			<div className="tag-group-actions">
				<button type="button" className="secondary-btn" disabled={busy} onClick={onEdit}>
					ویرایش سوال
				</button>
				<button type="button" className="secondary-btn" disabled={busy} onClick={onOptions}>
					{`گزینه‌ها (${fa(group.options.length)})`}
				</button>
				<button type="button" className="secondary-btn" disabled={busy} onClick={onToggle}>
					{group.isActive ? 'غیرفعال' : 'فعال'}
				</button>
				<button type="button" className="danger-btn" disabled={busy} onClick={onRemove}>
					حذف
				</button>
			</div>
		</article>
	);
}

// ─── Create / edit a group ───────────────────────────────────────────────────

function GroupForm({ group, onClose, onSaved }: { group: TagGroupRow | null; onClose: () => void; onSaved: (message: string) => void }) {
	const [name, setName] = useState(group?.name ?? '');
	const [question, setQuestion] = useState(group?.question ?? '');
	const [kinds, setKinds] = useState<CategoryKind[]>(group?.kinds ?? []);
	const [byKind, setByKind] = useState<Partial<Record<CategoryKind, string>>>(group?.questionByKind ?? {});
	const [strictness, setStrictness] = useState<'SOFT' | 'HARD'>(group?.strictness ?? 'SOFT');
	const [multi, setMulti] = useState(group?.multi ?? false);
	const [ordered, setOrdered] = useState(group?.ordered ?? false);
	const [importance, setImportance] = useState(group?.importance ?? 3);
	const [isActive, setIsActive] = useState(group?.isActive ?? true);
	const [options, setOptions] = useState<string[]>(['', '']);
	const soft = strictness === 'SOFT';

	const submit = async () => {
		const cleanName = name.trim();
		const cleanQuestion = question.trim();
		if (!cleanName) throw new Error('نام گروه الزامی است.');
		if (!cleanQuestion) throw new Error('متن سوال الزامی است.');
		if (!kinds.length) throw new Error('حداقل یکی از نوشیدنی، غذا یا دسر را انتخاب کن.');
		const texts = Object.fromEntries(
			KINDS.filter((k) => soft && kinds.includes(k))
				.map((k) => [k, (byKind[k] ?? '').trim()])
				.filter(([, text]) => text),
		);
		const body: Record<string, unknown> = {
			name: cleanName,
			question: cleanQuestion,
			questionByKind: Object.keys(texts).length ? texts : null,
			kinds: KINDS.filter((k) => kinds.includes(k)),
			strictness,
			// a restriction is always picked as checkboxes (vegetarian and nut-free together)
			multi: soft ? multi : true,
			ordered: soft && ordered,
			importance,
			isActive,
		};
		if (!group) {
			const labels = options.map((o) => o.trim()).filter(Boolean);
			if (labels.length < (soft ? 2 : 1)) throw new Error(soft ? 'یک سوال حداقل دو گزینه لازم دارد.' : 'حداقل یک گزینه بنویس.');
			const twin = labels.find((label, i) => labels.indexOf(label) !== i);
			if (twin) throw new Error(`گزینه‌ی «${twin}» دو بار آمده است.`);
			body.options = labels;
			await adminApi('/api/admin/tag-groups', { method: 'POST', body });
			onSaved(`گروه «${cleanName}» ساخته شد؛ حالا از فرم دسته‌ها و محصولات برچسبش را بزن.`);
		} else {
			await adminApi(`/api/admin/tag-groups/${group.id}`, { method: 'PATCH', body });
			onSaved(`گروه «${cleanName}» ذخیره شد.`);
		}
	};

	return (
		<MenuModal title={group ? 'ویرایش گروه' : 'گروه جدید'} submitLabel={group ? 'ذخیره' : 'ساختن گروه'} onSubmit={submit} onClose={onClose}>
			<fieldset className="field tag-radio">
				<legend>نوع گروه</legend>
				<label className="checkbox-row">
					<input type="radio" name="strictness" checked={soft} onChange={() => setStrictness('SOFT')} />
					<span>سلیقه: از مشتری پرسیده می‌شود (مثل گرم یا سرد)</span>
				</label>
				<label className="checkbox-row">
					<input type="radio" name="strictness" checked={!soft} onChange={() => setStrictness('HARD')} />
					<span>محدودیت غذایی: فقط اگر مشتری خودش «محدودیت غذایی داری؟» را بزند (مثل گیاهخوار)</span>
				</label>
			</fieldset>
			<div className="row">
				<div className="field">
					<label htmlFor="tgName">نام گروه (فقط در پنل)</label>
					<input id="tgName" name="name" maxLength={NAME_MAX} placeholder={soft ? 'مثلاً دما' : 'مثلاً رژیم'} value={name} onChange={(e) => setName(e.target.value)} />
				</div>
				<div className="field">
					<label htmlFor="tgQuestion">{soft ? 'متن سوال برای مشتری' : 'عنوان برای مشتری'}</label>
					<input
						id="tgQuestion"
						name="question"
						maxLength={QUESTION_MAX}
						placeholder={soft ? 'مثلاً گرم میل داری یا سرد؟' : 'مثلاً رژیم خاصی داری؟'}
						value={question}
						onChange={(e) => setQuestion(e.target.value)}
					/>
				</div>
			</div>
			<fieldset className="field tag-kind-picks">
				<legend>برای کدام‌ها؟</legend>
				{KINDS.map((kind) => (
					<label className="checkbox-row" key={kind}>
						<input
							type="checkbox"
							checked={kinds.includes(kind)}
							onChange={(e) => setKinds((list) => (e.target.checked ? [...list, kind] : list.filter((k) => k !== kind)))}
						/>
						<span>{KIND_FA[kind]}</span>
					</label>
				))}
			</fieldset>
			{soft && (
				<>
					<div className="row">
						<div className="field">
							<label htmlFor="tgImportance">اهمیت</label>
							<select id="tgImportance" name="importance" value={importance} onChange={(e) => setImportance(Number(e.target.value))}>
								{[5, 4, 3, 2, 1].map((n) => (
									<option key={n} value={n}>
										{`${IMPORTANCE_FA[n]} (${fa(n)})`}
									</option>
								))}
							</select>
						</div>
						<div className="field tag-check-field">
							<label className="checkbox-row">
								<input type="checkbox" name="multi" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
								<span>مشتری می‌تواند چند گزینه را با هم بزند</span>
							</label>
						</div>
					</div>
					<p className="hint">
						اهمیت بیشتر یعنی جواب این سوال در امتیاز محصول وزن بیشتری دارد و زودتر پرسیده می‌شود. چند انتخابی برای سوال‌هایی مثل «چه طعمی؟» است
						(شکلاتی و قهوه‌ای با هم).
					</p>
					<label className="checkbox-row tag-ordered-row">
						<input type="checkbox" name="ordered" checked={ordered} onChange={(e) => setOrdered(e.target.checked)} />
						<span>گزینه‌ها یک طیف‌اند، به همین ترتیب (مثل شیرین ← کم‌شیرین ← تلخ): گزینه‌ی کنار جواب مشتری نیمه‌درست حساب می‌شود</span>
					</label>
					{kinds.length > 1 && (
						<details className="tag-kind-texts" open={Object.keys(byKind).length > 0}>
							<summary>متن جدا برای هر نوع (اختیاری)</summary>
							{KINDS.filter((k) => kinds.includes(k)).map((kind) => (
								<div className="field" key={kind}>
									<label htmlFor={`tgQ-${kind}`}>{`متن سوال وقتی مشتری «${KIND_FA[kind]}» خواسته`}</label>
									<input
										id={`tgQ-${kind}`}
										maxLength={QUESTION_MAX}
										placeholder={question || 'همان متن اصلی'}
										value={byKind[kind] ?? ''}
										onChange={(e) => setByKind((texts) => ({ ...texts, [kind]: e.target.value }))}
									/>
								</div>
							))}
						</details>
					)}
				</>
			)}
			{!group && (
				<div className="field">
					<label>گزینه‌ها</label>
					<p className="hint tag-field-hint">
						توصیفی بنویس، مثل «با کافئین» (نه «دارد»): همین متن در دلیل پیشنهاد به مشتری نشان داده می‌شود. «فرقی نداره» را لازم نیست بنویسی.
					</p>
					<div className="tag-option-drafts">
						{options.map((value, i) => (
							<div className="tag-option-draft" key={i}>
								<input
									aria-label={`گزینه‌ی ${fa(i + 1)}`}
									maxLength={OPTION_MAX}
									placeholder={i === 0 ? (soft ? 'مثلاً گرم' : 'مثلاً گیاهخوار') : ''}
									value={value}
									onChange={(e) => setOptions((list) => list.map((v, j) => (j === i ? e.target.value : v)))}
								/>
								{options.length > 1 && (
									<button type="button" className="menu-order-btn" aria-label={`حذف گزینه‌ی ${fa(i + 1)}`} onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}>
										{ICONS.x}
									</button>
								)}
							</div>
						))}
					</div>
					<button type="button" className="secondary-btn tag-option-more" disabled={options.length >= OPTIONS_MAX} onClick={() => setOptions((list) => [...list, ''])}>
						{ICONS.plus}
						<span>گزینه‌ی دیگر</span>
					</button>
				</div>
			)}
			<label className="checkbox-row">
				<input type="checkbox" name="isActive" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
				<span>فعال (غیرفعال یعنی پرسیده نمی‌شود، ولی برچسب‌های محصولات می‌ماند)</span>
			</label>
		</MenuModal>
	);
}

// ─── Options of one group (each change is saved at once) ─────────────────────

function OptionsDialog({ group, onClose, onChanged }: { group: TagGroupRow; onClose: () => void; onChanged: () => Promise<void> }) {
	const [options, setOptions] = useState<TagOptionRow[]>(group.options);
	const [drafts, setDrafts] = useState<Record<number, string>>({});
	const [label, setLabel] = useState('');
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<{ type: string; text: string } | null>(null);
	const soft = group.strictness === 'SOFT';

	// the group from the server after every change (counts, order)
	useEffect(() => setOptions(group.options), [group]);

	const run = async (action: () => Promise<unknown>, success: string): Promise<boolean> => {
		setBusy(true);
		setNotice(null);
		let ok = false;
		try {
			await action();
			setNotice({ type: 'ok', text: success });
			ok = true;
		} catch (err) {
			setNotice({ type: 'danger', text: errorText(err) });
		}
		await onChanged();
		setBusy(false);
		return ok;
	};

	const add = async (event: FormEvent) => {
		event.preventDefault();
		const clean = label.trim();
		if (!clean) return setNotice({ type: 'danger', text: 'متن گزینه را بنویس.' });
		if (await run(() => adminApi(`/api/admin/tag-groups/${group.id}/options`, { method: 'POST', body: { label: clean } }), `«${clean}» اضافه شد.`)) {
			setLabel('');
		}
	};

	const rename = async (event: FormEvent, option: TagOptionRow) => {
		event.preventDefault();
		const clean = (drafts[option.id] ?? option.label).trim();
		if (!clean) return setNotice({ type: 'danger', text: 'متن گزینه نمی‌تواند خالی باشد.' });
		if (clean === option.label) return;
		if (await run(() => adminApi(`/api/admin/tag-options/${option.id}`, { method: 'PATCH', body: { label: clean } }), `«${option.label}» شد «${clean}».`)) {
			setDrafts((d) => {
				const next = { ...d };
				delete next[option.id];
				return next;
			});
		}
	};

	const move = (index: number, delta: -1 | 1) => {
		const target = index + delta;
		if (target < 0 || target >= options.length) return;
		const next = options.slice();
		[next[index], next[target]] = [next[target], next[index]];
		setOptions(next);
		void run(() => adminApi(`/api/admin/tag-groups/${group.id}/options/order`, { method: 'PUT', body: { ids: next.map((o) => o.id) } }), 'ترتیب گزینه‌ها ذخیره شد.');
	};

	const remove = async (option: TagOptionRow) => {
		const where = usageText(option.productCount, option.categoryCount);
		if (!window.confirm(where ? `«${option.label}» روی ${where} زده شده و با حذفش از همه‌شان برداشته می‌شود. حذف شود؟` : `گزینه‌ی «${option.label}» حذف شود؟`)) return;
		setBusy(true);
		setNotice(null);
		try {
			try {
				await adminApi(`/api/admin/tag-options/${option.id}${where ? '?force=1' : ''}`, { method: 'DELETE' });
			} catch (err) {
				// tagged since this list was read: ask again with the server's numbers
				if (where || !(err instanceof ApiError && err.status === 409)) throw err;
				const now = usageText(Number(err.data.productCount) || 0, Number(err.data.categoryCount) || 0);
				if (!window.confirm(`«${option.label}» همین حالا روی ${now} زده شده و با حذفش از همه‌شان برداشته می‌شود. حذف شود؟`)) return;
				await adminApi(`/api/admin/tag-options/${option.id}?force=1`, { method: 'DELETE' });
			}
			setNotice({ type: 'ok', text: `«${option.label}» حذف شد.` });
		} catch (err) {
			setNotice({ type: 'danger', text: errorText(err) });
		} finally {
			await onChanged();
			setBusy(false);
		}
	};

	const implications = options.flatMap((option) =>
		impliedBy({ ...group, options }, option.id).map((id) => [option.label, options.find((o) => o.id === id)?.label ?? ''] as const),
	);

	return (
		<MenuModal title={`گزینه‌های «${group.name}»`} onClose={onClose}>
			<p className="hint tag-field-hint">هر تغییر همین لحظه ذخیره می‌شود. متن گزینه را توصیفی بنویس (مثلاً «با کافئین»)؛ همین متن در دلیل پیشنهاد به مشتری نشان داده می‌شود.</p>
			{options.length ? (
				<ul className="tag-option-list">
					{options.map((option, index) => {
						const draft = drafts[option.id] ?? option.label;
						const changed = draft.trim() !== option.label;
						const where = usageText(option.productCount, option.categoryCount);
						return (
							<li key={option.id}>
								<form className="tag-option-row" noValidate onSubmit={(e) => rename(e, option)}>
									<div className="menu-order-btns">
										<button type="button" className="menu-order-btn" aria-label={`«${option.label}» یکی بالاتر`} disabled={busy || index === 0} onClick={() => move(index, -1)}>
											{ICONS.up}
										</button>
										<button
											type="button"
											className="menu-order-btn"
											aria-label={`«${option.label}» یکی پایین‌تر`}
											disabled={busy || index === options.length - 1}
											onClick={() => move(index, 1)}
										>
											{ICONS.down}
										</button>
									</div>
									<input
										aria-label={`متن گزینه‌ی «${option.label}»`}
										maxLength={OPTION_MAX}
										value={draft}
										onChange={(e) => setDrafts((d) => ({ ...d, [option.id]: e.target.value }))}
									/>
									{changed && (
										<button type="submit" className="secondary-btn" disabled={busy}>
											ذخیره
										</button>
									)}
									<button type="button" className="menu-order-btn tag-option-delete" aria-label={`حذف «${option.label}»`} disabled={busy} onClick={() => remove(option)}>
										{ICONS.trash}
									</button>
								</form>
								<small className="tag-option-usage">{where ? `روی ${where}` : 'هنوز روی چیزی زده نشده'}</small>
							</li>
						);
					})}
				</ul>
			) : (
				<p className="hint">هنوز گزینه‌ای ندارد.</p>
			)}
			{implications.map(([from, to]) => (
				<p className="hint" key={`${from}-${to}`}>{`هر چیزی که «${from}» بگیرد، «${to}» را هم خودکار می‌گیرد.`}</p>
			))}
			<form className="tag-option-row tag-option-add" noValidate onSubmit={add}>
				<input
					aria-label="گزینه‌ی تازه"
					maxLength={OPTION_MAX}
					placeholder="گزینه‌ی تازه"
					value={label}
					disabled={options.length >= OPTIONS_MAX}
					onChange={(e) => setLabel(e.target.value)}
				/>
				<button type="submit" className="primary-btn" disabled={busy || options.length >= OPTIONS_MAX}>
					{ICONS.plus}
					<span>افزودن</span>
				</button>
			</form>
			{options.length >= OPTIONS_MAX && <p className="hint">{`حداکثر ${fa(OPTIONS_MAX)} گزینه برای هر گروه.`}</p>}
			{soft && options.length < 2 && <p className="tag-group-warn">با کمتر از دو گزینه این سوال هیچ‌وقت پرسیده نمی‌شود.</p>}
			<div className={notice ? `notice ${notice.type}` : undefined} aria-live="polite">
				{notice?.text}
			</div>
		</MenuModal>
	);
}

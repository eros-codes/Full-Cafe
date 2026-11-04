import { useEffect, useState } from 'react';
import { api, errorText } from '../../shared/api';
import { toman } from '../../shared/format';
import { DurationChips, fitDuration } from '../../reserve/common/DurationChips';
import type { PublicConfig } from '../../reserve/common/types';
import type { MapTable } from '../../reserve/map/types';
import { adminApi } from '../common/adminApi';
import { Notice, ZONE_FA, type NoticeState } from '../common/ui';

function todayLocal(): string {
	const now = new Date();
	return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Phone / walk-in booking: confirmed and paid at once, no online payment. */
export function ManualBooking({ tables, onCreated }: { tables: MapTable[]; onCreated: () => void }) {
	const [name, setName] = useState('');
	const [phone, setPhone] = useState('');
	const [date, setDate] = useState(todayLocal);
	const [time, setTime] = useState('15:00');
	const [guests, setGuests] = useState('2');
	const [duration, setDuration] = useState(60);
	const [selected, setSelected] = useState<string[]>([]);
	const [decoration, setDecoration] = useState(false);
	const [decorationNote, setDecorationNote] = useState('');
	const [notice, setNotice] = useState<NoticeState>(null);
	const [busy, setBusy] = useState(false);
	// the booking rules (durations, decoration price) are the café's settings, as on the booking page
	const [rules, setRules] = useState<PublicConfig['settings'] | null>(null);

	useEffect(() => {
		let current = true;
		api<PublicConfig>('/api/config')
			.then(({ settings }) => {
				if (!current) return;
				setRules(settings);
				setDuration((d) => fitDuration(d, settings.minDurationMinutes, settings.maxDurationMinutes));
			})
			.catch(() => undefined);
		return () => {
			current = false;
		};
	}, []);
	const decorationPrice = rules?.decorationPrice ?? 0;

	const activeTables = tables.filter((t) => t.isActive);
	// a table that was deactivated in the meantime is dropped from the selection
	const selectedIds = selected.filter((id) => activeTables.some((t) => t.id === id));

	const step = (delta: number) => setGuests((g) => String(Math.min(20, Math.max(1, Number(g || 1) + delta))));

	const toggleTable = (id: string) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

	const create = async () => {
		setBusy(true);
		try {
			if (!selectedIds.length) throw new Error('حداقل یک میز رو انتخاب کن.');
			const { reservation } = await adminApi<{ reservation: { trackingCode: string } }>('/api/admin/reservations/manual', {
				method: 'POST',
				body: {
					tableIds: selectedIds,
					date,
					startTime: time,
					durationMinutes: duration,
					guestCount: Number(guests),
					customerName: name.trim(),
					customerPhone: phone.trim(),
					decoration: decoration && decorationPrice > 0,
					decorationNote: decorationNote.trim() || null,
				},
			});
			setNotice({ type: 'ok', text: `رزرو دستی ثبت شد: ${reservation.trackingCode}` });
			setSelected([]);
			onCreated();
		} catch (error) {
			setNotice({ type: 'danger', text: errorText(error) });
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="form-grid">
			<div className="row">
				<div className="field">
					<label>نام مشتری</label>
					<input id="mName" placeholder="نام و نام خانوادگی" value={name} onChange={(e) => setName(e.target.value)} />
				</div>
				<div className="field">
					<label>موبایل</label>
					<input id="mPhone" placeholder="09..." value={phone} onChange={(e) => setPhone(e.target.value)} />
				</div>
			</div>
			<div className="row">
				<div className="field">
					<label>تاریخ</label>
					<input id="mDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
				</div>
				<div className="field">
					<label>ساعت شروع</label>
					<input id="mTime" type="time" step="900" value={time} onChange={(e) => setTime(e.target.value)} />
				</div>
			</div>
			<div className="row">
				<div className="field">
					<label>تعداد نفرات</label>
					<div className="stepper">
						<button type="button" onClick={() => step(-1)}>
							−
						</button>
						<input id="mGuests" type="number" min="1" value={guests} onChange={(e) => setGuests(e.target.value)} />
						<button type="button" onClick={() => step(1)}>
							+
						</button>
					</div>
				</div>
				<div className="field">
					<label>مدت رزرو</label>
					<DurationChips id="mDurationRow" min={rules?.minDurationMinutes} max={rules?.maxDurationMinutes} value={duration} onChange={setDuration} />
				</div>
			</div>
			<div className="field">
				<label>میز (برای ترکیبی، بیش از یکی انتخاب کن)</label>
				<div id="mTables" className="chip-row">
					{activeTables.map((table) => (
						<button key={table.id} type="button" className={`chip${selectedIds.includes(table.id) ? ' active' : ''}`} onClick={() => toggleTable(table.id)}>
							{`میز ${table.displayNumber} · ${ZONE_FA[table.zone] || table.zone} · ${table.capacity} نفره`}
						</button>
					))}
				</div>
			</div>
			{/* a decoration price of zero means decoration is switched off (the server would ignore the box) */}
			<div className="field" hidden={decorationPrice <= 0}>
				<label className="checkbox-row">
					<input
						type="checkbox"
						id="mDecoration"
						checked={decoration}
						onChange={(e) => {
							setDecoration(e.target.checked);
							if (!e.target.checked) setDecorationNote('');
						}}
					/>{' '}
					<span>{`تزئین میز (+${toman(decorationPrice)})`}</span>
				</label>
			</div>
			<div className="field" id="mDecorationNoteField" hidden={!decoration || decorationPrice <= 0}>
				<label htmlFor="mDecorationNote">چه تزئینی؟ (اختیاری)</label>
				<input id="mDecorationNote" maxLength={200} value={decorationNote} onChange={(e) => setDecorationNote(e.target.value)} />
			</div>
			<button id="createManual" className="primary-btn" disabled={busy} onClick={create}>
				ثبت رزرو دستی
			</button>
			<Notice id="manualNotice" notice={notice} />
		</div>
	);
}

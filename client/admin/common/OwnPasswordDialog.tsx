import { useState } from 'react';
import { adminApi } from './adminApi';
import { MenuModal } from './MenuModal';
import type { Admin } from './roles';

/**
 * «تغییر رمز من»: every admin, staff included, with the current password. The other open sessions of the account
 * end; this one stays signed in.
 */
export function OwnPasswordDialog({ me, onClose, onSaved }: { me: Admin; onClose: () => void; onSaved: () => void }) {
	const [current, setCurrent] = useState('');
	const [next, setNext] = useState('');
	const [repeat, setRepeat] = useState('');
	return (
		<MenuModal
			title="تغییر رمز من"
			submitLabel="تغییر رمز"
			onClose={onClose}
			onSubmit={async () => {
				if (!current) throw new Error('رمز فعلی را وارد کن.');
				if (next.length < 8) throw new Error('رمز جدید باید حداقل ۸ کاراکتر باشد.');
				if (next !== repeat) throw new Error('تکرار رمز جدید با خودش یکی نیست.');
				if (next === current) throw new Error('رمز جدید باید با رمز فعلی فرق داشته باشد.');
				await adminApi('/api/admin/me/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
				onSaved();
			}}
		>
			{/* lets a password manager save the new password for the right account */}
			<input type="text" name="username" autoComplete="username" value={me.username} readOnly hidden />
			<div className="field">
				<label htmlFor="opCurrent">رمز فعلی</label>
				<input
					id="opCurrent"
					type="password"
					autoComplete="current-password"
					maxLength={128}
					value={current}
					onChange={(e) => setCurrent(e.target.value)}
				/>
			</div>
			<div className="field">
				<label htmlFor="opNew">رمز جدید (حداقل ۸ کاراکتر)</label>
				<input
					id="opNew"
					type="password"
					autoComplete="new-password"
					maxLength={128}
					value={next}
					onChange={(e) => setNext(e.target.value)}
				/>
			</div>
			<div className="field">
				<label htmlFor="opRepeat">تکرار رمز جدید</label>
				<input
					id="opRepeat"
					type="password"
					autoComplete="new-password"
					maxLength={128}
					value={repeat}
					onChange={(e) => setRepeat(e.target.value)}
				/>
			</div>
			<p className="hint">بعد از تغییر، حساب تو روی دستگاه‌های دیگر از پنل خارج می‌شود؛ اینجا وارد می‌مانی.</p>
		</MenuModal>
	);
}

import { useEffect, useState } from 'react';
import { errorText } from '../../shared/api';
import { adminApi } from '../common/adminApi';
import { MenuModal } from '../common/MenuModal';
import { ROLE_FA, assignableRoles, type Admin, type AdminRole } from '../common/roles';
import { ErrorNotice, Notice, Skeleton, type NoticeState } from '../common/ui';

interface AdminRow extends Admin {
	isActive: boolean;
}

const USERNAME = /^[a-z0-9._-]{3,32}$/;

const fetchAdmins = () => adminApi<{ admins: AdminRow[] }>('/api/admin/admins').then((r) => r.admins);

/** Admin accounts: create, change role, reset password, activate / deactivate, delete. */
export function Admins({ me }: { me: Admin }) {
	const roles = assignableRoles(me);
	const [admins, setAdmins] = useState<AdminRow[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<NoticeState>(null);
	const [name, setName] = useState('');
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	// پیش‌فرض کم‌دسترسی‌ترین نقش است
	const [role, setRole] = useState<AdminRole | ''>(roles[roles.length - 1] ?? '');
	const [creating, setCreating] = useState(false);
	const [passwordFor, setPasswordFor] = useState<AdminRow | null>(null);

	useEffect(() => {
		let current = true;
		fetchAdmins()
			.then((list) => current && setAdmins(list))
			.catch((err) => current && setError(errorText(err)));
		return () => {
			current = false;
		};
	}, []);

	const refresh = () =>
		fetchAdmins()
			.then(setAdmins)
			.catch((err) => setNotice({ type: 'danger', text: errorText(err) }));

	/** Every change reads the list again, also on error (so a role select that failed snaps back). */
	const run = async (action: () => Promise<unknown>, success?: string) => {
		try {
			await action();
			setNotice(success ? { type: 'ok', text: success } : null);
		} catch (err) {
			setNotice({ type: 'danger', text: errorText(err) });
		}
		await refresh();
	};

	const create = async () => {
		const body = { name: name.trim(), username: username.trim().toLowerCase(), password, role };
		if (!body.name || !body.username) return setNotice({ type: 'danger', text: 'نام و نام کاربری لازم است.' });
		if (!USERNAME.test(body.username)) {
			return setNotice({ type: 'danger', text: 'نام کاربری باید ۳ تا ۳۲ کاراکتر و فقط شامل حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد.' });
		}
		if (body.password.length < 8) return setNotice({ type: 'danger', text: 'رمز عبور باید حداقل ۸ کاراکتر باشد.' });
		setCreating(true);
		try {
			await adminApi('/api/admin/admins', { method: 'POST', body });
			setName('');
			setUsername('');
			setPassword('');
			setNotice({ type: 'ok', text: 'ادمین جدید ساخته شد.' });
			await refresh();
		} catch (err) {
			setNotice({ type: 'danger', text: errorText(err) });
		} finally {
			setCreating(false);
		}
	};

	return (
		<>
			<Notice id="adminNotice" notice={notice} />
			<div className="card" style={{ marginBottom: '14px' }}>
				<h4>افزودن ادمین جدید</h4>
				<div className="row">
					<div className="field">
						<label htmlFor="aName">نام</label>
						<input id="aName" value={name} onChange={(e) => setName(e.target.value)} />
					</div>
					<div className="field">
						<label htmlFor="aUsername">نام کاربری (انگلیسی)</label>
						<input
							id="aUsername"
							type="text"
							dir="ltr"
							autoComplete="off"
							autoCapitalize="none"
							spellCheck={false}
							maxLength={32}
							value={username}
							onChange={(e) => setUsername(e.target.value)}
						/>
					</div>
				</div>
				<div className="row">
					<div className="field">
						<label htmlFor="aPassword">رمز عبور (حداقل ۸ کاراکتر)</label>
						<input id="aPassword" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
					</div>
					<div className="field">
						<label htmlFor="aRole">نقش</label>
						<select id="aRole" value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
							{roles
								.slice()
								.reverse()
								.map((r) => (
									<option key={r} value={r}>
										{ROLE_FA[r]}
									</option>
								))}
						</select>
					</div>
				</div>
				<button type="button" className="primary-btn" id="createAdminBtn" disabled={creating} onClick={create}>
					ثبت ادمین
				</button>
			</div>
			<div id="adminsBox">
				{error ? (
					<ErrorNotice message={error} />
				) : !admins ? (
					<Skeleton height={140} />
				) : (
					<div className="table-scroll">
						<table className="table-list">
							<thead>
								<tr>
									<th>نام</th>
									<th>نام کاربری</th>
									<th>نقش</th>
									<th>وضعیت</th>
									<th>عملیات</th>
								</tr>
							</thead>
							<tbody>
								{admins.map((admin) => {
									const isSelf = admin.id === me.id;
									// مدیر کافه حساب‌های توسعه‌دهنده را فقط می‌بیند، تغییر نمی‌دهد
									const editable = roles.includes(admin.role);
									return (
										<tr key={admin.id}>
											<td className="fw-bold">
												{isSelf ? `${admin.name} ` : admin.name}
												{isSelf && <span className="chip">شما</span>}
											</td>
											<td dir="ltr">{admin.username}</td>
											<td>
												{editable && !isSelf ? (
													<select
														aria-label={`نقش ${admin.name}`}
														value={admin.role}
														onChange={(e) => run(() => adminApi(`/api/admin/admins/${admin.id}`, { method: 'PATCH', body: { role: e.target.value } }), 'نقش تغییر کرد.')}
													>
														{roles.map((r) => (
															<option key={r} value={r}>
																{ROLE_FA[r]}
															</option>
														))}
													</select>
												) : (
													ROLE_FA[admin.role] || admin.role
												)}
											</td>
											<td>
												<span className={`status ${admin.isActive ? 'CONFIRMED' : 'CANCELLED'}`}>{admin.isActive ? 'فعال' : 'غیرفعال'}</span>
											</td>
											<td>
												{editable ? (
													<>
														<button type="button" className="secondary-btn" onClick={() => setPasswordFor(admin)}>
															تغییر رمز
														</button>
														{!isSelf && (
															<>
																{' '}
																<button
																	type="button"
																	className="secondary-btn"
																	onClick={() => run(() => adminApi(`/api/admin/admins/${admin.id}`, { method: 'PATCH', body: { isActive: !admin.isActive } }))}
																>
																	{admin.isActive ? 'غیرفعال' : 'فعال'}
																</button>{' '}
																<button
																	type="button"
																	className="danger-btn"
																	onClick={() => {
																		if (window.confirm('این ادمین برای همیشه حذف بشه؟')) void run(() => adminApi(`/api/admin/admins/${admin.id}`, { method: 'DELETE' }), 'ادمین حذف شد.');
																	}}
																>
																	حذف
																</button>
															</>
														)}
													</>
												) : (
													<span className="hint">—</span>
												)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</div>
			{passwordFor && (
				<PasswordForm
					admin={passwordFor}
					onClose={() => setPasswordFor(null)}
					onSaved={() => {
						setNotice({ type: 'ok', text: 'رمز عبور تغییر کرد.' });
						void refresh();
					}}
				/>
			)}
		</>
	);
}

/** Replaces the old window.prompt(), which showed the new password in plain text. */
function PasswordForm({ admin, onClose, onSaved }: { admin: AdminRow; onClose: () => void; onSaved: () => void }) {
	const [password, setPassword] = useState('');
	return (
		<MenuModal
			title={`تغییر رمز «${admin.name}»`}
			submitLabel="تغییر رمز"
			onClose={onClose}
			onSubmit={async () => {
				if (password.length < 8) throw new Error('رمز عبور باید حداقل ۸ کاراکتر باشد.');
				await adminApi(`/api/admin/admins/${admin.id}`, { method: 'PATCH', body: { password } });
				onSaved();
			}}
		>
			<div className="field">
				<label htmlFor="npPassword">رمز عبور جدید (حداقل ۸ کاراکتر)</label>
				<input id="npPassword" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
			</div>
		</MenuModal>
	);
}

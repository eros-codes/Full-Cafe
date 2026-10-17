import { useState, type FormEvent } from 'react';
import { api, errorText } from '../../shared/api';
import { ROOF_MONOGRAM } from '../../shared/icons';

export function LoginPage() {
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!username.trim() || !password) {
			setError('نام کاربری و رمز عبور رو وارد کن.');
			return;
		}
		setBusy(true);
		try {
			await api('/api/admin/login', { method: 'POST', body: { username: username.trim(), password } });
			window.location.href = '/admin';
		} catch (err) {
			setError(errorText(err));
			setBusy(false);
		}
	};

	return (
		<main className="shell" style={{ display: 'flex', minHeight: '80vh', alignItems: 'center', justifyContent: 'center' }}>
			<section className="card card-pad" style={{ maxWidth: '420px', width: '100%' }}>
				<div style={{ textAlign: 'center', marginBottom: '20px' }}>
					<span className="brand-mark" style={{ margin: '0 auto 14px' }}>
						{ROOF_MONOGRAM}
					</span>
					<span className="brand-word" style={{ fontSize: '24px' }}>
						Roof
					</span>
					<p style={{ color: 'var(--deep-taupe)', fontSize: '12.5px', marginTop: '4px', opacity: 0.8 }}>پنل مدیریت</p>
				</div>
				<form id="loginForm" className="form-grid" onSubmit={submit}>
					<div className="field">
						<label htmlFor="username">نام کاربری</label>
						<input
							id="username"
							type="text"
							dir="ltr"
							autoComplete="username"
							autoCapitalize="none"
							spellCheck={false}
							maxLength={64}
							value={username}
							onChange={(event) => setUsername(event.target.value)}
						/>
					</div>
					<div className="field">
						<label htmlFor="password">رمز عبور</label>
						<input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
					</div>
					<button id="login" type="submit" className="primary-btn" disabled={busy}>
						ورود به پنل
					</button>
					<div id="notice" className={error ? 'notice danger' : undefined}>
						{error}
					</div>
				</form>
				<div style={{ textAlign: 'center', marginTop: '16px' }}>
					<a href="/" className="login" style={{ color: 'var(--deep-taupe)', fontSize: '13px', opacity: 0.75 }}>
						بازگشت به سایت
					</a>
				</div>
			</section>
		</main>
	);
}

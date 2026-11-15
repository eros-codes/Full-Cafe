import { useState, type FormEvent } from 'react';
import { api, errorText } from '../../shared/api';
import { BRAND } from '../../shared/brand';

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
		// cleared first, so the same message said again is announced again
		setError(null);
		try {
			await api('/api/admin/login', { method: 'POST', body: { username: username.trim(), password } });
			window.location.href = '/admin';
		} catch (err) {
			setError(errorText(err));
			setBusy(false);
		}
	};

	return (
		<main className="login-page">
			<section className="login-card" aria-labelledby="loginTitle">
				<div className="login-head">
					<span className="login-mark">
						<img src={BRAND.logo.light} alt="" />
					</span>
					<h1 id="loginTitle">{`ورود به پنل ${BRAND.nameFa}`}</h1>
					<p>{`مدیریت رزروها، منو و سایت ${BRAND.cafeFa}`}</p>
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
						<input id="password" type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
					</div>
					{/* role="alert": a screen reader says the error (before, a wrong password was silent) */}
					<div id="notice" role="alert" className={error ? 'notice danger' : undefined}>
						{error}
					</div>
					<button id="login" type="submit" className="primary-btn" disabled={busy}>
						{busy ? 'در حال ورود...' : 'ورود به پنل'}
					</button>
				</form>
				<a href="/" className="login-back">
					بازگشت به سایت
				</a>
			</section>
		</main>
	);
}

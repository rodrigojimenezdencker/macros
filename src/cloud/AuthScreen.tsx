import { useState, type FormEvent } from 'react';
import type { AuthError } from '@supabase/supabase-js';
import { Segmented } from '../components/Field';
import { appUrl, supabase } from './supabase';
import { dismissLinkNotice, finishRecovery, useLinkNotice } from './session';

type Mode = 'signin' | 'signup' | 'reset';

const MIN_PASSWORD = 8;

/** Supabase's messages are English and technical; say what to do instead. */
export function authMessage(err: Pick<AuthError, 'message'> & { status?: number; code?: string; name?: string }): string {
  const m = err.message.toLowerCase();
  // Network failures: Chrome says "Failed to fetch", Safari "Load failed", Firefox "NetworkError…".
  if (err.name === 'AuthRetryableFetchError' || err.status === 0 || /failed to fetch|load failed|networkerror|network/.test(m))
    return 'No hay conexión. Comprueba tu red y vuelve a intentarlo.';
  if (err.code === 'invalid_credentials' || m.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.';
  if (err.code === 'email_not_confirmed' || m.includes('email not confirmed'))
    return 'Aún no has confirmado tu correo. Busca el enlace que te enviamos al crear la cuenta.';
  if (err.code === 'user_already_exists' || m.includes('already registered')) return 'Ya existe una cuenta con ese correo. Entra con tu contraseña.';
  if (err.code === 'weak_password' || m.includes('password should be'))
    return `La contraseña es demasiado débil: usa al menos ${MIN_PASSWORD} caracteres.`;
  if (err.code === 'same_password') return 'La contraseña nueva debe ser distinta de la anterior.';
  if (err.status === 429 || m.includes('rate limit')) return 'Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.';
  if (err.code === 'otp_expired' || (m.includes('token') && (m.includes('expired') || m.includes('invalid'))))
    return 'El código no es válido o ha caducado. Pide uno nuevo.';
  if (
    err.code === 'email_address_invalid' ||
    err.code === 'validation_failed' ||
    m.includes('invalid email') ||
    m.includes('unable to validate email') ||
    (m.includes('email address') && m.includes('invalid'))
  )
    return 'Ese correo no parece válido.';
  return `No se ha podido completar: ${err.message}`;
}

function Brand() {
  return (
    <div className="auth-brand">
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={56} height={56} />
      <h1>Macros</h1>
      <p className="muted">Tu diario de comidas y macros, guardado en tu cuenta.</p>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
          minLength={autoComplete === 'new-password' ? MIN_PASSWORD : undefined}
        />
        <button type="button" className="link-btn" onClick={() => setShow((s) => !s)} aria-pressed={show}>
          {show ? 'Ocultar' : 'Mostrar'}
        </button>
      </span>
    </label>
  );
}

/** Sign in, create an account, or ask for a password-reset email. */
export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [code, setCode] = useState('');
  const notice = useLinkNotice();

  const verifyCode = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    setError(null);
    // On success the SDK reports a password recovery and the "new password" screen opens.
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'recovery' });
    setBusy(false);
    if (error) setError(authMessage(error));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || busy) return;
    if (mode === 'reset' && resetSent) return void verifyCode();
    setBusy(true);
    setError(null);
    setInfo(null);
    dismissLinkNotice();
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) setError(authMessage(error));
      } else if (mode === 'signup') {
        if (password.length < MIN_PASSWORD) {
          setError(`Usa una contraseña de al menos ${MIN_PASSWORD} caracteres.`);
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: appUrl() },
        });
        if (error) setError(authMessage(error));
        // Supabase hides whether an email is registered: an existing account comes back with no identities.
        else if (data.user && data.user.identities?.length === 0)
          setError('Ya existe una cuenta con ese correo. Entra con tu contraseña o recupérala.');
        else if (!data.session)
          setInfo(`Te hemos enviado un correo a ${email.trim()}. Pulsa el enlace para activar tu cuenta y después entra aquí.`);
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() });
        if (error) setError(authMessage(error));
        else {
          setResetSent(true);
          setInfo(
            'Si existe una cuenta con ese correo, te llegará un mensaje. Escribe aquí el código que trae, o abre su enlace en este mismo navegador.',
          );
        }
      }
    } catch (err) {
      setError(authMessage({ message: String((err as Error)?.message ?? err) }));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
    setResetSent(false);
    setCode('');
    dismissLinkNotice();
  };

  return (
    <main className="auth">
      <Brand />
      <form className="card form auth-card" onSubmit={(e) => void submit(e)}>
        {mode !== 'reset' ? (
          <Segmented
            label="Acceso"
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'signin', label: 'Entrar' },
              { value: 'signup', label: 'Crear cuenta' },
            ]}
          />
        ) : (
          <h2 className="card-title">Recuperar contraseña</h2>
        )}
        <label className="field">
          <span className="field-label">Correo electrónico</span>
          <span className="field-input">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </span>
        </label>
        {notice && (
          <p className={notice.kind === 'error' ? 'auth-error' : 'auth-info'} role={notice.kind === 'error' ? 'alert' : 'status'}>
            {notice.text}
          </p>
        )}
        {mode === 'reset' && resetSent && (
          <label className="field">
            <span className="field-label">Código del correo</span>
            <span className="field-input">
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))}
                required
              />
            </span>
          </label>
        )}
        {mode !== 'reset' && (
          <PasswordField
            label="Contraseña"
            value={password}
            onChange={setPassword}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        {info && (
          <p className="auth-info" role="status">
            {info}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy}>
          {busy
            ? 'Un momento…'
            : mode === 'signin'
              ? 'Entrar'
              : mode === 'signup'
                ? 'Crear cuenta'
                : resetSent
                  ? 'Comprobar código'
                  : 'Enviar código'}
        </button>
        {mode === 'signin' && (
          <button type="button" className="link-btn center" onClick={() => switchMode('reset')}>
            ¿Has olvidado tu contraseña?
          </button>
        )}
        {mode === 'reset' && (
          <button type="button" className="link-btn center" onClick={() => switchMode('signin')}>
            Volver a entrar
          </button>
        )}
      </form>
      <p className="muted small center">
        Tus datos se guardan en tu cuenta y en este dispositivo, así que también funciona sin conexión.
      </p>
    </main>
  );
}

/** Shown after opening a password-reset link: choose the new password. */
export function NewPasswordScreen() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || busy) return;
    if (password.length < MIN_PASSWORD) {
      setError(`Usa una contraseña de al menos ${MIN_PASSWORD} caracteres.`);
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(authMessage(error));
    else finishRecovery();
  };

  return (
    <main className="auth">
      <Brand />
      <form className="card form auth-card" onSubmit={(e) => void submit(e)}>
        <h2 className="card-title">Elige una contraseña nueva</h2>
        <PasswordField label="Contraseña nueva" value={password} onChange={setPassword} autoComplete="new-password" />
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Un momento…' : 'Guardar contraseña'}
        </button>
      </form>
    </main>
  );
}

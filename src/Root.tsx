import { App } from './App';
import { AuthScreen, NewPasswordScreen } from './cloud/AuthScreen';
import { useAuth } from './cloud/session';
import { cloudEnabled } from './cloud/supabase';

/** With an account backend configured, the app sits behind sign-in; without one it runs local-only. */
export function Root() {
  const auth = useAuth();
  if (!cloudEnabled) return <App />;
  if (auth.status === 'loading') {
    return (
      <main className="auth" aria-busy="true">
        <p className="muted center">Cargando…</p>
      </main>
    );
  }
  if (auth.session && auth.recovery) return <NewPasswordScreen />;
  if (auth.status !== 'signedIn') return <AuthScreen />;
  return <App />;
}

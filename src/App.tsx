import { useEffect, useState } from 'react';
import { useRoute, navigate } from './router';
import { today } from './lib/dates';
import { isMealId, mealForHour } from './lib/meals';
import { DiaryPage } from './pages/DiaryPage';
import { AddFoodPage } from './pages/AddFoodPage';
import { FoodsPage } from './pages/FoodsPage';
import { FoodFormPage } from './pages/FoodFormPage';
import { RecipePage } from './pages/RecipePage';
import { ProgressPage } from './pages/ProgressPage';
import { SettingsPage } from './pages/SettingsPage';
import { Icon, type IconName } from './components/Icon';
import { ToastHost } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useStorageFailure } from './storage';

const TABS: { path: string; label: string; icon: IconName }[] = [
  { path: '/', label: 'Diario', icon: 'diary' },
  { path: '/foods', label: 'Alimentos', icon: 'foods' },
  { path: '/progress', label: 'Progreso', icon: 'progress' },
  { path: '/settings', label: 'Ajustes', icon: 'settings' },
];

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function App() {
  const route = useRoute();
  // Re-tapping a tab after a screen failed gives it another try.
  const [retry, setRetry] = useState(0);
  const [first, second] = route.segments;
  const date = isDate(route.params.get('d')) ? route.params.get('d')! : today();

  useEffect(() => window.scrollTo(0, 0), [route.path]);

  let page;
  let tab = '/';
  switch (first) {
    case undefined:
      page = <DiaryPage date={date} />;
      break;
    case 'add': {
      const meal = route.params.get('meal');
      page = <AddFoodPage date={date} meal={isMealId(meal) ? meal : mealForHour()} />;
      break;
    }
    case 'foods':
      tab = '/foods';
      page = <FoodsPage initialTab={route.params.get('tab')} />;
      break;
    case 'food':
      tab = '/foods';
      page = (
        <FoodFormPage
          key={route.path}
          id={second && second !== 'new' ? Number(second) : undefined}
          barcode={route.params.get('barcode') ?? undefined}
          pick={route.params.get('pick') === '1'}
        />
      );
      break;
    case 'recipe':
      tab = '/foods';
      page = <RecipePage key={route.path} id={second && second !== 'new' ? Number(second) : undefined} />;
      break;
    case 'progress':
      tab = '/progress';
      page = <ProgressPage />;
      break;
    case 'settings':
      tab = '/settings';
      page = <SettingsPage />;
      break;
    default:
      page = <DiaryPage date={date} />;
  }

  return (
    <>
      <StorageBanner />
      <main className="app-main">
        <ErrorBoundary resetKey={`${route.path}?${route.params}#${retry}`}>{page}</ErrorBoundary>
      </main>
      <nav className="tabbar" aria-label="Secciones">
        {TABS.map((t) => (
          <button
            key={t.path}
            className={tab === t.path ? 'active' : ''}
            aria-current={tab === t.path ? 'page' : undefined}
            onClick={() => {
              setRetry((r) => r + 1);
              navigate(t.path, { replace: true });
            }}
          >
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <ToastHost />
    </>
  );
}

function StorageBanner() {
  const failure = useStorageFailure();
  if (!failure) return null;
  return (
    <div className="storage-banner" role="alert">
      <p>
        <strong>No se pueden leer tus datos ahora mismo.</strong> Suele pasar en Safari al volver a la app tras un rato;
        recargar lo arregla. Tus datos no se han perdido.
      </p>
      <small>{failure}</small>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>
        Recargar
      </button>
    </div>
  );
}

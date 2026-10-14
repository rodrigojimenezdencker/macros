import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Changing this (e.g. the route) clears the error so the new screen gets a fresh try. */
  resetKey?: string;
}

interface State {
  error: Error | null;
  componentStack: string;
  copied: boolean;
}

/** Everything needed to locate a crash in the published build, as plain text. */
function report(error: Error, componentStack: string): string {
  return [
    `${error.name}: ${error.message}`,
    `Versión: ${__APP_VERSION__}`,
    `Pantalla: ${window.location.hash || '#/'}`,
    `Navegador: ${navigator.userAgent}`,
    '',
    (error.stack ?? '').split('\n').slice(0, 12).join('\n'),
    '',
    'Componentes:',
    componentStack.trim().split('\n').slice(0, 12).join('\n'),
  ].join('\n');
}

/**
 * Without a boundary, one render error unmounts the whole app and leaves an
 * empty screen (black in dark mode). This shows what went wrong instead, so
 * the rest of the app stays usable and the details can be reported.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: '', copied: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)), copied: false };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? '' });
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, componentStack: '' });
  }

  render() {
    const { error, componentStack, copied } = this.state;
    if (!error) return this.props.children;
    const details = report(error, componentStack);
    return (
      <div className="page">
        <section className="card crash" role="alert">
          <h1>Algo ha fallado</h1>
          <p>Esta pantalla no se ha podido mostrar. Tus datos siguen guardados en este dispositivo.</p>
          <pre className="crash-detail">{`${error.name}: ${error.message}`}</pre>
          <details className="crash-more">
            <summary>Detalles técnicos</summary>
            <pre className="crash-detail">{details}</pre>
          </details>
          <div className="btn-row">
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(details).then(
                  () => this.setState({ copied: true }),
                  () => this.setState({ copied: false }),
                );
              }}
            >
              {copied ? 'Copiado' : 'Copiar detalles'}
            </button>
            <button className="btn" onClick={() => window.location.reload()}>
              Recargar
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                window.location.hash = '#/';
                this.setState({ error: null, componentStack: '' });
              }}
            >
              Ir al diario
            </button>
          </div>
        </section>
      </div>
    );
  }
}

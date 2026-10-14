import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Changing this (e.g. the route) clears the error so the new screen gets a fresh try. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * Without a boundary, one render error unmounts the whole app and leaves an
 * empty screen (black in dark mode). This shows what went wrong instead, so
 * the rest of the app stays usable and the message can be reported.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page">
        <section className="card crash" role="alert">
          <h1>Algo ha fallado</h1>
          <p>Esta pantalla no se ha podido mostrar. Tus datos siguen guardados en este dispositivo.</p>
          <pre className="crash-detail">{`${error.name}: ${error.message}`}</pre>
          <div className="btn-row">
            <button className="btn" onClick={() => window.location.reload()}>
              Recargar
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                window.location.hash = '#/';
                this.setState({ error: null });
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

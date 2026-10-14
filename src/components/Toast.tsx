import { useEffect, useSyncExternalStore } from 'react';

interface ToastState {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

let current: ToastState | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(message: string, action?: ToastState['action']) {
  current = { id: nextId++, message, action };
  emit();
}

function dismiss(id: number) {
  if (current?.id === id) {
    current = null;
    emit();
  }
}

export function ToastHost() {
  const state = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );

  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => dismiss(state.id), state.action ? 5000 : 2500);
    return () => clearTimeout(t);
  }, [state]);

  if (!state) return null;
  return (
    <div className="toast" role="status" key={state.id}>
      <span>{state.message}</span>
      {state.action && (
        <button
          onClick={() => {
            state.action!.run();
            dismiss(state.id);
          }}
        >
          {state.action.label}
        </button>
      )}
    </div>
  );
}

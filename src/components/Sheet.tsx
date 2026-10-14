import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * How many sheets are open. Shared so nested sheets lock page scroll once and
 * release it when the last one closes, in whatever order React unmounts them.
 */
let openSheets = 0;

/** A bottom sheet on phones, a centred dialog on wider screens. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  full = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  full?: boolean;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    openSheets++;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only the top sheet closes: nested sheets come later in document order.
      const all = document.querySelectorAll('.sheet');
      if (all[all.length - 1] === dialog.current) onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (--openSheets === 0) document.body.style.overflow = '';
    };
  }, []);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className={`sheet${full ? ' sheet-full' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-header">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-footer">{footer}</footer>}
      </div>
    </div>
  );
}

import { useEffect, useRef, type ReactElement } from 'react';
import './focus-mode.css';

export type FocusModeProps = {
  text: string;
  completed: boolean;
  completedLabel: string;
  exitLabel: string;
  toastMessage: string | null;
  queueCount?: number;
  queuedLabel?: string;
  onToggleCompleted: () => void;
  onExit: () => void;
};

const MAX_FONT_SIZE = 22;
const MIN_FONT_SIZE = 12;

export function FocusMode(props: FocusModeProps): ReactElement {
  const { text, completed, completedLabel, exitLabel, toastMessage, queueCount, queuedLabel, onToggleCompleted, onExit } = props;
  const textRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;

    el.style.fontSize = `${MAX_FONT_SIZE}px`;

    let size = MAX_FONT_SIZE;
    while (size > MIN_FONT_SIZE && el.scrollHeight > el.clientHeight) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }
  }, [text, completed]);

  return (
    <div className="focus-panel" role="dialog" aria-modal="true" aria-label="Focus mode">
      <div className="focus-panel__aurora" aria-hidden="true" />

      <div className="focus-panel__content">
        {completed && (
          <span className="focus-panel__badge">
            <svg className="focus-panel__badge-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{completedLabel}</span>
          </span>
        )}

        <p
          ref={textRef}
          className={`focus-panel__text${completed ? ' focus-panel__text--completed' : ''}`}
          title={text}
        >
          {text}
        </p>
      </div>

      {queueCount && queueCount > 0 && queuedLabel ? (
        <p className="focus-panel__queue" role="status">{queuedLabel}</p>
      ) : null}

      <div className="focus-panel__buttons">
        {toastMessage ? (
          <p className="focus-panel__toast" role="alert">{toastMessage}</p>
        ) : (
          <></>
        )}

        <button
          type="button"
          className={`focus-panel__button focus-panel__button--primary${completed ? ' focus-panel__button--primary-active' : ''}`}
          onClick={onToggleCompleted}
        >
          <svg className="focus-panel__button-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{completedLabel}</span>
        </button>

        <button
          type="button"
          className="focus-panel__button focus-panel__button--secondary"
          onClick={onExit}
        >
          <svg className="focus-panel__button-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{exitLabel}</span>
        </button>
      </div>
    </div>
  );
}

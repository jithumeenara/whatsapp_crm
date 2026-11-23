'use client';

import { useEffect } from 'react';
import { describeClientError, reportClientError } from '@/lib/errors/report-client';

/**
 * Catches browser errors nobody else catches — a script error, a promise
 * nobody awaited — and keeps them in app_errors (Settings → Errors).
 * Renders nothing.
 */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      // Errors from browser extensions and cross-origin scripts arrive as
      // a bare "Script error." with nothing to act on.
      if (!e.message || e.message === 'Script error.') return;
      reportClientError(e.error ? describeClientError(e.error) : e.message);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      // A request the page itself cancelled is not an error.
      if (reason && typeof reason === 'object' && (reason as { name?: string }).name === 'AbortError') return;
      reportClientError(`Unhandled promise: ${describeClientError(reason)}`);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}

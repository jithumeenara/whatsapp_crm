'use client'

/**
 * The last resort: an error in the root layout itself, where even the
 * dashboard's own error page cannot render. It replaces the whole
 * document, so it brings its own <html>, <body> and inline styles — the
 * app's stylesheet is not loaded here.
 */

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f8fafc', color: '#1e293b' }}>
        <title>Something went wrong</title>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 24 }}>
            <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>The app could not load</h2>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: '#64748b', margin: 0 }}>
              Nothing you saved has been lost. Try again in a moment.
            </p>
            {error.digest && (
              <p style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', marginTop: 8 }}>Reference: {error.digest}</p>
            )}
            <button
              type="button"
              onClick={() => retry()}
              style={{ marginTop: 16, height: 36, padding: '0 16px', border: 0, borderRadius: 8, background: '#4f46e5', color: '#fff', fontSize: 13, cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}

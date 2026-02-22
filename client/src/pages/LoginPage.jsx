import { useEffect, useState } from 'react';

export default function LoginPage() {
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error') === 'not-allowed') {
      setError('Your Google account is not authorized to access this system. Contact an administrator to get access.');
      // Clean up URL
      window.history.replaceState({}, '', '/login');
    }
  }, []);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'var(--color-bg-light)',
    }}>
      <div className="card" style={{ width: 400, textAlign: 'center', padding: 40 }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>Backbeat</h2>
        <span className="module-badge" style={{ marginBottom: 24, display: 'inline-block' }}>Stash</span>

        {error && (
          <div className="alert alert-error" style={{ marginTop: 20, textAlign: 'left' }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 24 }}>
          <a href="/auth/google" className="btn btn-primary" style={{
            display: 'inline-block',
            padding: '12px 24px',
            fontSize: '0.95rem',
            textDecoration: 'none',
          }}>
            Sign in with Google
          </a>
        </div>

        <p style={{ marginTop: 20, fontSize: '0.8rem', color: '#888' }}>
          Only authorized accounts can sign in.
        </p>
      </div>
    </div>
  );
}

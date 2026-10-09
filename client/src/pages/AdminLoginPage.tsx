import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Button, Field } from '../components/ui';

/**
 * Staff-only entry point. Uses the same login system underneath — the server
 * rejects non-admin accounts with a clear message instead of a blank screen.
 */
export function AdminLoginPage() {
  const { user, loading, login, logout } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user?.role === 'admin') return <Navigate to="/admin" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const account = await login(email.trim(), password, 'admin');
      if (account.role !== 'admin') {
        await logout();
        setError("You don't have admin access.");
        return;
      }
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth__panel">
        <Link to="/" className="auth__brand">
          FoodFlow
        </Link>
        <h1 className="auth__title">Kitchen sign in</h1>
        <p className="auth__sub">Staff accounts only. Students sign in on the main page.</p>

        <form className="auth__form" onSubmit={submit}>
          <Field label="Email" type="email" name="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Field
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <div className="alert alert--error">{error}</div>}
          <Button type="submit" full size="lg" loading={busy}>
            Sign in to console
          </Button>
        </form>

        <p className="auth__switch">
          Not staff? <Link to="/login">Student sign in</Link>
        </p>
      </div>
    </div>
  );
}

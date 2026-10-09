import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button, Field } from '../components/ui';
import type { Role } from '../types';

export function LoginPage() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [role, setRole] = useState<Role>('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(email.trim(), password, role);
      toast.success(`Welcome back, ${user.name.split(' ')[0]}!`);
      const fallback = user.role === 'admin' ? '/admin' : '/scan';
      navigate(from ?? fallback, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign you in.');
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
        <h1 className="auth__title">Sign in</h1>
        <p className="auth__sub">Use the account you registered with.</p>

        <div className="segmented" role="tablist" aria-label="Account type">
          <button type="button" role="tab" aria-selected={role === 'student'} className={role === 'student' ? 'is-active' : ''} onClick={() => setRole('student')}>
            Student
          </button>
          <button type="button" role="tab" aria-selected={role === 'admin'} className={role === 'admin' ? 'is-active' : ''} onClick={() => setRole('admin')}>
            Staff
          </button>
        </div>

        <form className="auth__form" onSubmit={submit} noValidate>
          <Field
            label="College email"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@college.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
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
            Sign in
          </Button>
        </form>

        <p className="auth__switch">
          No account yet? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}
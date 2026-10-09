import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, authApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Avatar, Button, Card, Field } from '../components/ui';
import { formatDate } from '../lib/format';

export function ProfilePage() {
  const { user, updateProfile, logout, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [profile, setProfile] = useState({ name: user?.name ?? '', phone: user?.phone ?? '', studentId: user?.studentId ?? '' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setSavingProfile(true);
    setError(null);
    try {
      await updateProfile({
        name: profile.name.trim(),
        phone: profile.phone.trim() || undefined,
        studentId: profile.studentId.trim() || undefined,
      });
      await refresh();
      toast.success('Profile updated.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (passwords.newPassword !== passwords.confirm) {
      setError('New passwords do not match.');
      return;
    }
    setSavingPassword(true);
    setError(null);
    try {
      await authApi.changePassword(passwords.currentPassword, passwords.newPassword);
      setPasswords({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success('Password changed.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change your password.');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="page__stack page__stack--narrow">
      <header className="profile-head">
        <Avatar name={user.name} color={user.avatarColor} />
        <div>
          <h1 className="page__title">{user.name}</h1>
          <p className="page__sub">{user.email}</p>
          <p className="muted">{user.role === 'student' ? `College ID · ${user.studentId || 'Not set'}` : 'Administrator'}</p>
        </div>
      </header>

      {error && <div className="alert alert--error">{error}</div>}

      <Card title="Account info">
        <dl className="kv">
          <div>
            <dt>Name</dt>
            <dd>{user.name}</dd>
          </div>
          <div>
            <dt>College Student ID</dt>
            <dd>{user.studentId || 'Not set'}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
        </dl>
      </Card>

      <Card title="Personal details">
        <form className="stack" onSubmit={saveProfile}>
          <Field label="Full name" name="name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} required />
          <Field
            label="College Student ID"
            name="studentId"
            value={profile.studentId}
            onChange={(e) => setProfile({ ...profile, studentId: e.target.value })}
            hint="Used by the counter to identify your orders."
          />
          <Field label="Phone" name="phone" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
          <Field label="College email" name="email" value={user.email} disabled hint="Email is your login and cannot be changed here." />
          <Button type="submit" loading={savingProfile}>
            Save changes
          </Button>
        </form>
      </Card>

      <Card title="Security" subtitle="Use at least 8 characters with upper, lower case and a number.">
        <form className="stack" onSubmit={savePassword}>
          <Field
            label="Current password"
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            value={passwords.currentPassword}
            onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
            required
          />
          <Field
            label="New password"
            type="password"
            name="newPassword"
            autoComplete="new-password"
            value={passwords.newPassword}
            onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
            required
          />
          <Field
            label="Confirm new password"
            type="password"
            name="confirm"
            autoComplete="new-password"
            value={passwords.confirm}
            onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
            required
          />
          <Button type="submit" loading={savingPassword}>
            Update password
          </Button>
        </form>
      </Card>

      <Card title="Account">
        <dl className="kv">
          <div>
            <dt>Member since</dt>
            <dd>{formatDate(user.createdAt)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{user.isBlocked ? 'Suspended' : 'Active'}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{user.role}</dd>
          </div>
        </dl>
        <Button
          variant="danger"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
        >
          Sign out
        </Button>
      </Card>
    </div>
  );
}

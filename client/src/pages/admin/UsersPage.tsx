import { useCallback, useEffect, useState } from 'react';
import { ApiError, adminApi } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { Avatar, Badge, Button, Card, EmptyState, ErrorNote, Field, Select, Skeleton, Toggle } from '../../components/ui';
import { formatDate, formatMoney } from '../../lib/format';
import type { User } from '../../types';

type AdminUser = User & { orders: number; spend: number; walletBalance: number };

export function UsersPage() {
  const toast = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staffOpen, setStaffOpen] = useState(false);
  const [staff, setStaff] = useState({ name: '', email: '', password: '', phone: '' });
  const [savingStaff, setSavingStaff] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminApi.users({ search: search || undefined, role: role || undefined, page, limit: 20 });
      setUsers(result.users);
      setPages(result.pages);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load users.');
    } finally {
      setLoading(false);
    }
  }, [search, role, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (user: AdminUser, body: Record<string, unknown>) => {
    try {
      await adminApi.updateUser(user.id, body);
      toast.success(`${user.name} updated.`);
      setEditing(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed.');
    }
  };

  const adjustWallet = async (user: AdminUser, amount: number) => {
    if (!amount) return;
    try {
      await adminApi.adjustWallet({ user: user.id, amount: Math.abs(amount), type: amount > 0 ? 'credit' : 'debit', reason: 'Adjusted by admin' });
      toast.success('Wallet adjusted.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Wallet adjustment failed.');
    }
  };

  const createStaff = async () => {
    setSavingStaff(true);
    try {
      await adminApi.createStaff({ name: staff.name.trim(), email: staff.email.trim(), password: staff.password, phone: staff.phone.trim() || undefined });
      toast.success('Staff account created.');
      setStaffOpen(false);
      setStaff({ name: '', email: '', password: '', phone: '' });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create that account.');
    } finally {
      setSavingStaff(false);
    }
  };

  return (
    <div className="admin-stack">
      <header className="page__head">
        <div>
          <h1 className="page__title">Users</h1>
          <p className="page__sub">{total} accounts across students and staff.</p>
        </div>
        <Button onClick={() => setStaffOpen(true)}>+ Staff account</Button>
      </header>

      <Card padded={false}>
        <div className="filters">
          <input
            className="input filters__search"
            placeholder="Search name, email or student ID"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
          <div className="filters__sort">
            <Select
              value={role}
              onChange={(e) => {
                setPage(1);
                setRole(e.target.value);
              }}
            >
              <option value="">All roles</option>
              <option value="student">Students</option>
              <option value="admin">Staff</option>
            </Select>
          </div>
        </div>
      </Card>

      {error && <ErrorNote message={error} onRetry={() => void load()} />}
      {loading && <Skeleton rows={6} />}

      {!loading && users.length === 0 && <EmptyState title="No accounts found" />}

      {users.length > 0 && (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Orders</th>
                  <th>Spent</th>
                  <th>Wallet</th>
                  <th>Status</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="cell-item">
                        <Avatar name={user.name} color={user.avatarColor} />
                        <div>
                          <strong>{user.name}</strong>
                          <small>
                            {user.email}
                            {user.studentId ? ` · ${user.studentId}` : ''}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge tone={user.role === 'admin' ? 'indigo' : 'slate'}>{user.role}</Badge>
                    </td>
                    <td className="muted">{user.orders ?? 0}</td>
                    <td className="muted">{formatMoney(user.spend ?? 0)}</td>
                    <td className="muted">{formatMoney(user.walletBalance)}</td>
                    <td>
                      <Badge tone={user.isBlocked !== true ? 'emerald' : 'rose'}>{user.isBlocked !== true ? 'Active' : 'Blocked'}</Badge>
                    </td>
                    <td className="right">
                      <div className="row-actions">
                        <button type="button" className="linkish" onClick={() => setEditing(user)}>
                          Manage
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {pages > 1 && (
        <div className="pager">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}

      {editing && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal__panel">
            <header className="modal__head">
              <h2>Manage {editing.name}</h2>
              <button type="button" className="modal__close" onClick={() => setEditing(null)} aria-label="Close">
                ×
              </button>
            </header>
            <div className="modal__body">
              <dl className="kv">
                <div>
                  <dt>Email</dt>
                  <dd>{editing.email}</dd>
                </div>
                <div>
                  <dt>Joined</dt>
                  <dd>{formatDate(editing.createdAt)}</dd>
                </div>
                <div>
                  <dt>Orders</dt>
                  <dd>{editing.orders ?? 0}</dd>
                </div>
                <div>
                  <dt>Total spent</dt>
                  <dd>{formatMoney(editing.spend ?? 0)}</dd>
                </div>
              </dl>
              <Toggle
                checked={(editing.isBlocked !== true)}
                onChange={(next) => patch(editing, { isBlocked: !next })}
                label={(editing.isBlocked !== true) ? 'Account active' : 'Account blocked'}
                hint="Blocked accounts cannot sign in or place orders."
              />
              <div className="grid-2">
                <Button variant="secondary" onClick={() => adjustWallet(editing, 100)}>
                  Credit ₹100
                </Button>
                <Button variant="secondary" onClick={() => adjustWallet(editing, -100)}>
                  Debit ₹100
                </Button>
              </div>
            </div>
            <footer className="modal__foot">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Close
              </Button>
            </footer>
          </div>
        </div>
      )}

      {staffOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal__panel modal__panel--sm">
            <header className="modal__head">
              <h2>New staff account</h2>
              <button type="button" className="modal__close" onClick={() => setStaffOpen(false)} aria-label="Close">
                ×
              </button>
            </header>
            <div className="modal__body">
              <Field label="Name" value={staff.name} onChange={(e) => setStaff({ ...staff, name: e.target.value })} />
              <Field label="Email" type="email" value={staff.email} onChange={(e) => setStaff({ ...staff, email: e.target.value })} />
              <Field label="Password" type="password" hint="At least 8 characters with a letter and a number." value={staff.password} onChange={(e) => setStaff({ ...staff, password: e.target.value })} />
              <Field label="Phone" value={staff.phone} onChange={(e) => setStaff({ ...staff, phone: e.target.value })} />
            </div>
            <footer className="modal__foot">
              <Button variant="ghost" onClick={() => setStaffOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createStaff} loading={savingStaff}>
                Create account
              </Button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

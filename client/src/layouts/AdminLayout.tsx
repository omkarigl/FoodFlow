import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/SocketContext';
import { canteenApi } from '../lib/api';
import type { Canteen } from '../types';

const NAV = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/queue', label: 'Live queue' },
  { to: '/admin/orders', label: 'Orders' },
  { to: '/admin/menu', label: 'Menu' },
  { to: '/admin/inventory', label: 'Inventory' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/analytics', label: 'Analytics' },
  { to: '/admin/settings', label: 'Settings' },
];

export function AdminLayout() {
  const { user, logout } = useAuth();
  const { connected, subscribe } = useRealtime();
  const navigate = useNavigate();
  const [canteens, setCanteens] = useState<Canteen[]>([]);
  const [activeCanteen, setActiveCanteen] = useState<string>('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await canteenApi.status();
        if (active) setCanteens(result.canteens);
      } catch {
        /* dashboard handles its own error state */
      }
    })();
    const unsubscribe = subscribe((event) => {
      if (event.type !== 'canteen:status') return;
      canteenApi
        .status()
        .then((result) => setCanteens(result.canteens))
        .catch(() => undefined);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [subscribe]);

  const current = canteens.find((c) => c.id === activeCanteen) ?? null;

  const toggleCanteen = async (canteen: Canteen) => {
    try {
      await canteenApi.setStatus(canteen.id, {
        isOpen: !canteen.isOpen,
        statusReason: canteen.isOpen ? 'Closed by admin' : undefined,
        closedMessage: canteen.isOpen ? 'The counter is paused right now. Please try again shortly.' : undefined,
      });
      const result = await canteenApi.status();
      setCanteens(result.canteens);
    } catch {
      /* toast surfaces on the settings page */
    }
  };

  return (
    <div className="app-shell app-shell--admin">
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="sidebar__brand">
          <div>
            <strong>FoodFlow</strong>
            <small>Kitchen console</small>
          </div>
        </div>

        <nav className="sidebar__nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) => `sidebar__link ${isActive ? 'is-active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__foot">
          <span className="sidebar__user">
            <strong>{user?.name}</strong>
            <small>{user?.email}</small>
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-top">
          <button type="button" className="admin-top__burger" onClick={() => setOpen((v) => !v)} aria-label="Toggle navigation">
            Menu
          </button>
          <div className="admin-top__canteens">
            {canteens.map((canteen) => (
              <button
                key={canteen.id}
                type="button"
                className={`pill ${activeCanteen === canteen.id ? 'is-active' : ''}`}
                onClick={() => setActiveCanteen(activeCanteen === canteen.id ? '' : canteen.id)}
              >
                {canteen.name}
                <span className={`pill__dot pill__dot--${canteen.canOrder ? 'open' : 'closed'}`} />
              </button>
            ))}
          </div>

          <div className="admin-top__right">
            {current && (
              <button
                type="button"
                className={`btn btn--sm ${current.canOrder ? 'btn--danger' : 'btn--success'}`}
                onClick={() => toggleCanteen(current)}
              >
                {current.canOrder ? 'Pause orders' : 'Resume orders'}
              </button>
            )}
            <span className={`conn conn--${connected ? 'on' : 'off'}`}>
              <span className="conn__dot" aria-hidden="true" />
              {connected ? 'Live' : 'Polling'}
            </span>
          </div>
        </header>

        <main className="page page--admin">
          <Outlet context={{ canteens, activeCanteen, setActiveCanteen, refreshCanteens: () => canteenApi.status().then((r) => setCanteens(r.canteens)) }} />
        </main>
      </div>
    </div>
  );
}

export interface AdminOutletContext {
  canteens: Canteen[];
  activeCanteen: string;
  setActiveCanteen: (id: string) => void;
  refreshCanteens: () => Promise<void>;
}

export function useAdminContext(): AdminOutletContext {
  return useOutletContext() as AdminOutletContext;
}
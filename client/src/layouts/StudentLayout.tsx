import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useRealtime } from '../context/SocketContext';
import { orderApi } from '../lib/api';
import { CURRENCY } from '../lib/format';

const STUDENT_NAV = [
  { to: '/scan', label: 'Scan' },
  { to: '/order', label: 'Menu' },
  { to: '/orders', label: 'Orders' },
  { to: '/wallet', label: 'Wallet' },
  { to: '/profile', label: 'Profile' },
];

const GUEST_NAV = [
  { to: '/scan', label: 'Scan' },
  { to: '/order', label: 'Menu' },
  { to: '/track', label: 'Track order' },
];

export function StudentLayout() {
  const { user, logout } = useAuth();
  const { count, total } = useCart();
  const { connected, subscribe } = useRealtime();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeOrders, setActiveOrders] = useState(0);

  const NAV = user ? STUDENT_NAV : GUEST_NAV;

  // Live order count with a polling fallback so the badge is never stale offline.
  // Guests have no account history — skip silently instead of polling a 401.
  useEffect(() => {
    if (!user) {
      setActiveOrders(0);
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const result = await orderApi.current();
        if (active) setActiveOrders(result.orders.length);
      } catch {
        /* keep the last known count */
      }
    };
    load();
    const poll = window.setInterval(load, connected ? 30000 : 12000);
    const unsubscribe = subscribe((event) => {
      if (event.type === 'order:new' || event.type === 'order:status' || event.type === 'order:updated') load();
    });
    return () => {
      active = false;
      window.clearInterval(poll);
      unsubscribe();
    };
  }, [connected, subscribe, user]);

  const isCartPage = location.pathname === '/cart' || location.pathname === '/checkout';

  return (
    <div className="app-shell">
      <header className="topbar">
        <button type="button" className="topbar__brand" onClick={() => navigate('/')}>
          <span className="topbar__name">FoodFlow</span>
        </button>

        <nav className="topbar__nav" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `topbar__link ${isActive ? 'is-active' : ''}`}>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="topbar__right">
          <span className={`conn conn--${connected ? 'on' : 'off'}`} title={connected ? 'Live updates connected' : 'Reconnecting — polling every few seconds'}>
            <span className="conn__dot" aria-hidden="true" />
            {connected ? 'Live' : 'Offline'}
          </span>
          {user ? (
            <span className="topbar__user">{user.name.split(' ')[0]}</span>
          ) : (
            <Link to="/login" className="topbar__link">
              Log in
            </Link>
          )}
        </div>
      </header>

      <main className={`page ${isCartPage ? 'page--with-cart' : ''}`}>
        <Outlet />
      </main>

      {!isCartPage && count > 0 && (
        <button type="button" className="cart-fab" onClick={() => navigate('/cart')}>
          <span className="cart-fab__count">{count}</span>
          <span>View cart</span>
          <strong>
            {CURRENCY}
            {total.toFixed(2)}
          </strong>
        </button>
      )}

      {user && activeOrders > 0 && !isCartPage && (
        <button type="button" className="active-fab" onClick={() => navigate('/orders')}>
          {activeOrders} active order{activeOrders > 1 ? 's' : ''}
        </button>
      )}

      <nav className="tabbar" aria-label="Mobile navigation">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => `tabbar__link ${isActive ? 'is-active' : ''}`}>
            <span className="tabbar__label">{item.label}</span>
          </NavLink>
        ))}
        {user ? (
          <button
            type="button"
            className="tabbar__link"
            onClick={() => {
              void logout();
            }}
          >
            <span className="tabbar__label">Exit</span>
          </button>
        ) : (
          <NavLink to="/login" className="tabbar__link">
            <span className="tabbar__label">Log in</span>
          </NavLink>
        )}
      </nav>
    </div>
  );
}

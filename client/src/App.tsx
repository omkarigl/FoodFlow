import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Spinner } from './components/ui';
import { StudentLayout } from './layouts/StudentLayout';
import { AdminLayout } from './layouts/AdminLayout';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { ScanPage } from './pages/ScanPage';
import { MenuPage } from './pages/MenuPage';
import { CartPage } from './pages/CartPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { OrderSuccessPage } from './pages/OrderSuccessPage';
import { TrackPage } from './pages/TrackPage';
import { MyOrdersPage } from './pages/MyOrdersPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { WalletPage } from './pages/WalletPage';
import { ProfilePage } from './pages/ProfilePage';
import { DashboardPage } from './pages/admin/DashboardPage';
import { QueuePage } from './pages/admin/QueuePage';
import { AdminOrdersPage } from './pages/admin/AdminOrdersPage';
import { MenuManagerPage } from './pages/admin/MenuManagerPage';
import { InventoryPage } from './pages/admin/InventoryPage';
import { UsersPage } from './pages/admin/UsersPage';
import { AnalyticsPage } from './pages/admin/AnalyticsPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';

function Protected({ children, role }: { children: JSX.Element; role: 'student' | 'admin' }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner label="Restoring your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : '/scan'} replace />;
  return children;
}

function GuestOnly({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Loading…" />;
  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/scan'} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <GuestOnly>
            <LandingPage />
          </GuestOnly>
        }
      />
      <Route
        path="/login"
        element={
          <GuestOnly>
            <LoginPage />
          </GuestOnly>
        }
      />
      <Route
        path="/register"
        element={
          <GuestOnly>
            <RegisterPage />
          </GuestOnly>
        }
      />
      {/* Spec alias */}
      <Route path="/signup" element={<Navigate to="/register" replace />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />

      {/* Guest ordering — no account required: QR → menu → cart → checkout → token → tracking */}
      <Route element={<StudentLayout />}>
        <Route path="/scan" element={<ScanPage />} />
        <Route path="/order" element={<MenuPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/order-success" element={<OrderSuccessPage />} />
        <Route path="/track" element={<TrackPage />} />
        <Route path="/track/:id" element={<TrackPage />} />
        {/* Spec aliases */}
        <Route path="/menu" element={<Navigate to="/order" replace />} />
        <Route path="/confirmation" element={<Navigate to="/order-success" replace />} />
      </Route>

      <Route
        element={
          <Protected role="student">
            <StudentLayout />
          </Protected>
        }
      >
        <Route path="/orders" element={<MyOrdersPage />} />
        <Route path="/orders/:id" element={<OrderDetailPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        {/* Spec alias */}
        <Route path="/account" element={<Navigate to="/profile" replace />} />
      </Route>

      <Route
        element={
          <Protected role="admin">
            <AdminLayout />
          </Protected>
        }
      >
        <Route path="/admin" element={<DashboardPage />} />
        <Route path="/admin/queue" element={<QueuePage />} />
        <Route path="/admin/orders" element={<AdminOrdersPage />} />
        <Route path="/admin/menu" element={<MenuManagerPage />} />
        <Route path="/admin/inventory" element={<InventoryPage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/analytics" element={<AnalyticsPage />} />
        <Route path="/admin/settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

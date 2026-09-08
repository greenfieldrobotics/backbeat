import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { AuthProvider, useAuth } from './core/context/AuthContext';
import LoginPage from './core/pages/LoginPage';
import LocationsPage from './core/pages/LocationsPage';
import UsersPage from './core/pages/UsersPage';
import { modules } from './modules/registry';
import GlobalScanListener from './core/scanning/GlobalScanListener';
import './App.css';

function AppShell() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="app">
      <GlobalScanListener />
      <nav className="sidebar">
        <div className="logo">
          <h2>Backbeat</h2>
        </div>
        <div className="nav-scroll">
          {modules.map(m => (
            <div className="nav-section" key={m.key}>
              <div className="nav-section-title">{m.label}</div>
              <ul>
                {m.nav.filter(item => !item.adminOnly || user.role === 'admin').map(item => (
                  <li key={item.to}>
                    <NavLink to={item.to} end={item.end}>{item.label}</NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="nav-section">
            <div className="nav-section-title">Admin</div>
            <ul>
              <li><NavLink to="/locations">Locations</NavLink></li>
              {user.role === 'admin' && <li><NavLink to="/users">User Management</NavLink></li>}
            </ul>
          </div>
        </div>
        <div className="sidebar-user">
          <div className="sidebar-user-name">{user.name || user.email}</div>
          <button className="sidebar-signout" onClick={logout}>Sign out</button>
        </div>
      </nav>
      <main className="content">
        <Routes>
          {modules.flatMap(m => m.routes).map(r => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
          {/* Shared / core routes */}
          <Route path="/locations" element={<LocationsPage />} />
          <Route path="/users" element={<UsersPage />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

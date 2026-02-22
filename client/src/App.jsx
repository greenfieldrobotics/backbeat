import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import PartsPage from './pages/PartsPage';
import LocationsPage from './pages/LocationsPage';
import PurchaseOrdersPage from './pages/PurchaseOrdersPage';
import PurchaseOrderDetail from './pages/PurchaseOrderDetail';
import InventoryPage from './pages/InventoryPage';
import IssuePage from './pages/IssuePage';
import MovePage from './pages/MovePage';
import DisposePage from './pages/DisposePage';
import ReturnPage from './pages/ReturnPage';
import AdjustPage from './pages/AdjustPage';
import ValuationPage from './pages/ValuationPage';
import TransactionsPage from './pages/TransactionsPage';
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
      <nav className="sidebar">
        <div className="logo">
          <h2>Backbeat</h2>
          <span className="module-badge">Stash</span>
        </div>
        <ul>
          <li><NavLink to="/">Inventory</NavLink></li>
          <li><NavLink to="/parts">Parts Catalog</NavLink></li>
          <li><NavLink to="/locations">Locations</NavLink></li>
          <li><NavLink to="/purchase-orders">Purchase Orders</NavLink></li>
          <li><NavLink to="/issue">Issue Parts</NavLink></li>
          <li><NavLink to="/move">Move Inventory</NavLink></li>
          <li><NavLink to="/dispose">Dispose</NavLink></li>
          <li><NavLink to="/return">Return Parts</NavLink></li>
          <li><NavLink to="/adjust">Adjust Inventory</NavLink></li>
          <li><NavLink to="/valuation">FIFO Valuation</NavLink></li>
          <li><NavLink to="/transactions">Audit Trail</NavLink></li>
        </ul>
        <div className="sidebar-user">
          <div className="sidebar-user-name">{user.name || user.email}</div>
          <button className="sidebar-signout" onClick={logout}>Sign out</button>
        </div>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<InventoryPage />} />
          <Route path="/parts" element={<PartsPage />} />
          <Route path="/locations" element={<LocationsPage />} />
          <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
          <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
          <Route path="/issue" element={<IssuePage />} />
          <Route path="/move" element={<MovePage />} />
          <Route path="/dispose" element={<DisposePage />} />
          <Route path="/return" element={<ReturnPage />} />
          <Route path="/adjust" element={<AdjustPage />} />
          <Route path="/valuation" element={<ValuationPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
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

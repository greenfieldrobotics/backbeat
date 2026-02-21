import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import PartsPage from './pages/PartsPage';
import LocationsPage from './pages/LocationsPage';
import PurchaseOrdersPage from './pages/PurchaseOrdersPage';
import PurchaseOrderDetail from './pages/PurchaseOrderDetail';
import InventoryPage from './pages/InventoryPage';
import IssuePage from './pages/IssuePage';
import MovePage from './pages/MovePage';
import DisposePage from './pages/DisposePage';
import ValuationPage from './pages/ValuationPage';
import TransactionsPage from './pages/TransactionsPage';
import './App.css';

function App() {
  return (
    <BrowserRouter>
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
            <li><NavLink to="/valuation">FIFO Valuation</NavLink></li>
            <li><NavLink to="/transactions">Audit Trail</NavLink></li>
          </ul>
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
            <Route path="/valuation" element={<ValuationPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;

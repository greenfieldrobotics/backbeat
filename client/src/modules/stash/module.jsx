// Stash module — client registration (inventory management).
// `nav` drives the sidebar section; `routes` are mounted by App.jsx.
// To add a page: add a component under ./pages, then add a nav + route entry here.
import InventoryPage from './pages/InventoryPage';
import PartsPage from './pages/PartsPage';
import PurchaseOrdersPage from './pages/PurchaseOrdersPage';
import PurchaseOrderDetail from './pages/PurchaseOrderDetail';
import IssuePage from './pages/IssuePage';
import MovePage from './pages/MovePage';
import DisposePage from './pages/DisposePage';
import ReturnPage from './pages/ReturnPage';
import AdjustPage from './pages/AdjustPage';
import ValuationPage from './pages/ValuationPage';
import TransactionsPage from './pages/TransactionsPage';

export default {
  key: 'stash',
  label: 'Stash',
  nav: [
    { to: '/', label: 'Inventory', end: true },
    { to: '/parts', label: 'Parts Catalog' },
    { to: '/purchase-orders', label: 'Purchase Orders' },
    { to: '/issue', label: 'Issue Parts' },
    { to: '/move', label: 'Move Inventory' },
    { to: '/dispose', label: 'Dispose' },
    { to: '/return', label: 'Return Parts' },
    { to: '/adjust', label: 'Adjust Inventory' },
    { to: '/valuation', label: 'FIFO Valuation' },
    { to: '/transactions', label: 'Audit Trail' },
  ],
  routes: [
    { path: '/', element: <InventoryPage /> },
    { path: '/parts', element: <PartsPage /> },
    { path: '/purchase-orders', element: <PurchaseOrdersPage /> },
    { path: '/purchase-orders/:id', element: <PurchaseOrderDetail /> },
    { path: '/issue', element: <IssuePage /> },
    { path: '/move', element: <MovePage /> },
    { path: '/dispose', element: <DisposePage /> },
    { path: '/return', element: <ReturnPage /> },
    { path: '/adjust', element: <AdjustPage /> },
    { path: '/valuation', element: <ValuationPage /> },
    { path: '/transactions', element: <TransactionsPage /> },
  ],
};

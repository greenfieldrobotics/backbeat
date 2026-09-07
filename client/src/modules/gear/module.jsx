// Gear module — client registration (asset management).
// Client routes are namespaced under /gear (mirrors the /api/gear API namespace).
import AssetsPage from './pages/AssetsPage';

export default {
  key: 'gear',
  label: 'Gear',
  nav: [
    { to: '/gear/assets', label: 'Assets' },
  ],
  routes: [
    { path: '/gear/assets', element: <AssetsPage /> },
  ],
};

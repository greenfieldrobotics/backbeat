// Gear module — client registration (asset management).
// Client routes are namespaced under /gear (mirrors the /api/gear API namespace).
import type { ReactNode } from 'react';
import AssetsPage from './pages/AssetsPage';
import AssetLookupPage from './pages/AssetLookupPage';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

interface RouteItem {
  path: string;
  element: ReactNode;
}

interface GearModule {
  key: string;
  label: string;
  nav: NavItem[];
  routes: RouteItem[];
}

const gearModule: GearModule = {
  key: 'gear',
  label: 'Gear',
  nav: [
    { to: '/gear/assets', label: 'Assets' },
  ],
  routes: [
    { path: '/gear/assets', element: <AssetsPage /> },
    // Label landing route (G2.2) — reached only via a scanned/printed URL, never
    // from the nav, so it isn't in `nav` above.
    { path: '/a/:serial', element: <AssetLookupPage /> },
  ],
};

export default gearModule;

// Gear module — client registration (asset management).
// Client routes are namespaced under /gear (mirrors the /api/gear API namespace).
import type { ReactNode } from 'react';
import AssetsPage from './pages/AssetsPage';
import AssetLookupPage from './pages/AssetLookupPage';
import ScanPage from './pages/ScanPage';
import PhotoResolvePage from './pages/PhotoResolvePage';
import LocatePage from './pages/LocatePage';
import LinkPage from './pages/LinkPage';
import MaintenancePage from './pages/MaintenancePage';
import LabelsPage from './pages/LabelsPage';
import LabelSheetPage from './pages/LabelSheetPage';
import GearSetupPage from './pages/GearSetupPage';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  // Hidden from the sidebar for non-admins (App.jsx filters on this) — the route
  // itself still renders for anyone who navigates there directly; requireAdmin on
  // the underlying mutation endpoints is the real gate (Phase 12).
  adminOnly?: boolean;
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
    { to: '/gear/scan', label: 'Scan' },
    { to: '/gear/photo-resolve', label: 'Resolve Photo' },
    { to: '/gear/locate', label: 'Locate' },
    { to: '/gear/link', label: 'Link' },
    { to: '/gear/maintenance', label: 'Maintenance' },
    { to: '/gear/labels', label: 'Labels' },
    { to: '/gear/setup', label: 'Gear Setup', adminOnly: true },
  ],
  routes: [
    { path: '/gear/assets', element: <AssetsPage /> },
    { path: '/gear/scan', element: <ScanPage /> },
    { path: '/gear/photo-resolve', element: <PhotoResolvePage /> },
    { path: '/gear/locate', element: <LocatePage /> },
    { path: '/gear/link', element: <LinkPage /> },
    { path: '/gear/maintenance', element: <MaintenancePage /> },
    { path: '/gear/labels', element: <LabelsPage /> },
    { path: '/gear/setup', element: <GearSetupPage /> },
    // Print-sheet route (Phase 7, G2.4) — reached only via LabelsPage's "Print
    // Sheet" button, never from the nav, so it isn't in `nav` above.
    { path: '/gear/labels/print', element: <LabelSheetPage /> },
    // Label landing route (G2.2) — reached only via a scanned/printed URL, never
    // from the nav, so it isn't in `nav` above.
    { path: '/a/:serial', element: <AssetLookupPage /> },
  ],
};

export default gearModule;

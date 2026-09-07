import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import LabelsPage from './LabelsPage';

vi.mock('../api', () => ({
  gearApi: {
    getAssets: vi.fn(),
    getAssetLabel: vi.fn(),
  },
}));

import { gearApi } from '../api';

const LABELABLE = {
  id: 1,
  serial_number: 'GFR-0001',
  asset_type_id: 1,
  asset_type_name: 'Robot',
  lifecycle_state_id: 1,
  lifecycle_state_name: 'Available',
  location_id: null,
  location_name: null,
  owner_party_name: null,
  custodian_party_name: null,
  notes: null,
};

const NO_SERIAL = { ...LABELABLE, id: 2, serial_number: null };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/gear/labels']}>
      <Routes>
        <Route path="/gear/labels" element={<LabelsPage />} />
        <Route path="/gear/labels/print" element={<div>PRINT SHEET PAGE</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('LabelsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only lists assets that have a serial number — a label needs one to encode', async () => {
    vi.mocked(gearApi.getAssets).mockResolvedValue({ ok: true, data: [LABELABLE, NO_SERIAL] as any });

    renderPage();

    expect(await screen.findByText('GFR-0001')).toBeTruthy();
    expect(screen.queryByText('Robot')).toBeTruthy();
    // Only one row for the labelable asset — the unserialed one is excluded.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('previews a label, showing the SVG and the serial alongside it', async () => {
    vi.mocked(gearApi.getAssets).mockResolvedValue({ ok: true, data: [LABELABLE] as any });
    vi.mocked(gearApi.getAssetLabel).mockResolvedValue({
      ok: true,
      data: {
        asset_id: 1,
        serial_number: 'GFR-0001',
        asset_type_name: 'Robot',
        symbology: 'qr',
        url: 'http://localhost:5173/a/GFR-0001',
        svg: '<svg data-testid="fake-qr"></svg>',
      },
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));

    await waitFor(() => expect(gearApi.getAssetLabel).toHaveBeenCalledWith(1, undefined));
    expect(await screen.findByTestId('fake-qr')).toBeTruthy();
    expect(screen.getAllByText('GFR-0001').length).toBeGreaterThan(0);
  });

  it('changing the symbology dropdown re-fetches with the override', async () => {
    vi.mocked(gearApi.getAssets).mockResolvedValue({ ok: true, data: [LABELABLE] as any });
    vi.mocked(gearApi.getAssetLabel).mockImplementation((_id, symbology) => Promise.resolve({
      ok: true,
      data: {
        asset_id: 1,
        serial_number: 'GFR-0001',
        asset_type_name: 'Robot',
        symbology: symbology || 'qr',
        url: 'http://localhost:5173/a/GFR-0001',
        svg: `<svg data-testid="${symbology || 'qr'}"></svg>`,
      },
    }));

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    await screen.findByTestId('qr');

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'datamatrix' } });

    await waitFor(() => expect(gearApi.getAssetLabel).toHaveBeenCalledWith(1, 'datamatrix'));
    expect(await screen.findByTestId('datamatrix')).toBeTruthy();
  });

  it('navigates to the print sheet with the selected asset ids', async () => {
    vi.mocked(gearApi.getAssets).mockResolvedValue({ ok: true, data: [LABELABLE] as any });

    renderPage();
    fireEvent.click(await screen.findByLabelText('Select GFR-0001'));
    fireEvent.click(screen.getByRole('button', { name: /Print Sheet/ }));

    expect(await screen.findByText('PRINT SHEET PAGE')).toBeTruthy();
  });
});

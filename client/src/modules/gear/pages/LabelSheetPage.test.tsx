import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import LabelSheetPage from './LabelSheetPage';

vi.mock('../api', () => ({
  gearApi: {
    getAssetLabels: vi.fn(),
  },
}));

import { gearApi } from '../api';

function renderAtIds(ids: string) {
  return render(
    <MemoryRouter initialEntries={[`/gear/labels/print?ids=${ids}`]}>
      <Routes>
        <Route path="/gear/labels/print" element={<LabelSheetPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('LabelSheetPage', () => {
  it('renders a label card per asset, each with its serial alongside the code', async () => {
    vi.mocked(gearApi.getAssetLabels).mockResolvedValue({
      ok: true,
      data: {
        labels: [
          { asset_id: 1, serial_number: 'GFR-0001', asset_type_name: 'Robot', symbology: 'qr', url: 'http://localhost:5173/a/GFR-0001', svg: '<svg data-testid="label-1"></svg>' },
          { asset_id: 2, serial_number: 'GFR-0002', asset_type_name: 'VCU', symbology: 'datamatrix', url: 'http://localhost:5173/a/GFR-0002', svg: '<svg data-testid="label-2"></svg>' },
        ],
        errors: [],
      },
    });

    renderAtIds('1,2');

    expect(await screen.findByTestId('label-1')).toBeTruthy();
    expect(screen.getByTestId('label-2')).toBeTruthy();
    expect(screen.getByText('GFR-0001')).toBeTruthy();
    expect(screen.getByText('GFR-0002')).toBeTruthy();
    expect(gearApi.getAssetLabels).toHaveBeenCalledWith([1, 2]);
  });

  it('surfaces per-asset errors without blocking the labels that did generate', async () => {
    vi.mocked(gearApi.getAssetLabels).mockResolvedValue({
      ok: true,
      data: {
        labels: [
          { asset_id: 1, serial_number: 'GFR-0001', asset_type_name: 'Robot', symbology: 'qr', url: 'http://localhost:5173/a/GFR-0001', svg: '<svg data-testid="label-1"></svg>' },
        ],
        errors: [{ asset_id: 3, error: 'Asset has no serial number — nothing to encode on a label' }],
      },
    });

    renderAtIds('1,3');

    expect(await screen.findByTestId('label-1')).toBeTruthy();
    expect(screen.getByText(/could not be labelled/)).toBeTruthy();
  });
});

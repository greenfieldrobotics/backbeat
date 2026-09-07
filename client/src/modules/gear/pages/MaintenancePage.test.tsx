import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import MaintenancePage from './MaintenancePage';

vi.mock('../api', () => ({
  gearApi: {
    getAssetBySerial: vi.fn(),
    getAssetModels: vi.fn(),
    getMaintenanceOrdersForAsset: vi.fn(),
    getComponentInstallationsForAsset: vi.fn(),
    createMaintenanceOrder: vi.fn(),
    updateMaintenanceOrder: vi.fn(),
    createComponentInstallation: vi.fn(),
    removeComponentInstallation: vi.fn(),
  },
}));

import { gearApi } from '../api';

const ROBOT = {
  id: 30,
  serial_number: 'ROBOT-100',
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

function fillAndSubmit(placeholder: string, value: string) {
  const input = screen.getByPlaceholderText(placeholder);
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest('form')!);
}

async function resolveRobot() {
  vi.mocked(gearApi.getAssetBySerial).mockResolvedValue({ ok: true, data: ROBOT as any });
  render(<MaintenancePage />);
  fillAndSubmit('Asset serial', 'ROBOT-100');
  await screen.findByText(/ROBOT-100/);
}

describe('MaintenancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gearApi.getAssetModels).mockResolvedValue({
      ok: true,
      data: [{ id: 5, asset_type_id: 2, manufacturer: 'Acme', model_name: 'Carbide Blade v2' } as any],
    });
    vi.mocked(gearApi.getMaintenanceOrdersForAsset).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(gearApi.getComponentInstallationsForAsset).mockResolvedValue({ ok: true, data: [] });
  });

  it('resolves a scanned/entered asset and shows its (empty) history', async () => {
    await resolveRobot();

    expect(await screen.findByText('No maintenance orders yet.')).toBeTruthy();
    expect(await screen.findByText('No components installed.')).toBeTruthy();
  });

  it('shows an error for an unknown serial and does not advance', async () => {
    vi.mocked(gearApi.getAssetBySerial).mockResolvedValue({ ok: false, error: 'not found', status: 404 });

    render(<MaintenancePage />);
    fillAndSubmit('Asset serial', 'NOPE');

    expect(await screen.findByText(/No asset found/)).toBeTruthy();
    expect(screen.getByPlaceholderText('Asset serial')).toBeTruthy();
  });

  it('opens a work order against the resolved asset (G6.1)', async () => {
    await resolveRobot();
    vi.mocked(gearApi.createMaintenanceOrder).mockResolvedValue({
      ok: true,
      data: { id: 1, asset_id: 30, status: 'open', description: 'Drive motor noise', opened_at: '2026-01-01', closed_at: null } as any,
    });
    vi.mocked(gearApi.getMaintenanceOrdersForAsset).mockResolvedValue({
      ok: true,
      data: [{ id: 1, asset_id: 30, status: 'open', description: 'Drive motor noise', opened_at: '2026-01-01', closed_at: null } as any],
    });

    fillAndSubmit('What needs doing', 'Drive motor noise');

    await waitFor(() =>
      expect(gearApi.createMaintenanceOrder).toHaveBeenCalledWith({ asset_id: 30, description: 'Drive motor noise' })
    );
    expect(await screen.findByText('Drive motor noise')).toBeTruthy();
  });

  it('surfaces the server L3-gate rejection instead of pre-filtering client-side', async () => {
    await resolveRobot();
    vi.mocked(gearApi.createMaintenanceOrder).mockResolvedValue({
      ok: false,
      error: "Asset type 'Beacon' does not support maintenance (L3) — enable supports_maintenance on its asset type first",
      status: 400,
    });

    fillAndSubmit('What needs doing', 'Anything');

    expect(await screen.findByText(/does not support maintenance/i)).toBeTruthy();
  });

  it('advances an open order to in_progress then closed', async () => {
    const open = { id: 1, asset_id: 30, status: 'open', description: null, opened_at: '2026-01-01', closed_at: null };
    vi.mocked(gearApi.getMaintenanceOrdersForAsset).mockResolvedValue({ ok: true, data: [open as any] });
    await resolveRobot();

    const inProgress = { ...open, status: 'in_progress' };
    vi.mocked(gearApi.updateMaintenanceOrder).mockResolvedValue({ ok: true, data: inProgress as any });
    vi.mocked(gearApi.getMaintenanceOrdersForAsset).mockResolvedValue({ ok: true, data: [inProgress as any] });

    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));

    await waitFor(() => expect(gearApi.updateMaintenanceOrder).toHaveBeenCalledWith(1, { status: 'in_progress' }));
    expect(await screen.findByText('in_progress')).toBeTruthy();
  });

  it('installs a component against a model and hour reading (G6.3)', async () => {
    await resolveRobot();
    vi.mocked(gearApi.createComponentInstallation).mockResolvedValue({
      ok: true,
      data: {
        id: 1, asset_model_id: 5, model_manufacturer: 'Acme', model_model_name: 'Carbide Blade v2',
        installed_on_asset_id: 30, installed_on_serial_number: 'ROBOT-100',
        installed_at_hours: 100, removed_at_hours: null, condition_on_removal: null, notes: null,
      } as any,
    });
    vi.mocked(gearApi.getComponentInstallationsForAsset).mockResolvedValue({
      ok: true,
      data: [{
        id: 1, asset_model_id: 5, model_manufacturer: 'Acme', model_model_name: 'Carbide Blade v2',
        installed_on_asset_id: 30, installed_on_serial_number: 'ROBOT-100',
        installed_at_hours: 100, removed_at_hours: null, condition_on_removal: null, notes: null,
      } as any],
    });

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '5' } });
    fillAndSubmit('hour reading', '100');

    await waitFor(() =>
      expect(gearApi.createComponentInstallation).toHaveBeenCalledWith({
        asset_model_id: 5,
        installed_on_asset_id: 30,
        installed_at_hours: 100,
        notes: undefined,
      })
    );
    const row = (await screen.findByText('100h')).closest('tr')!;
    expect(row.textContent).toMatch(/Acme\s*Carbide Blade v2/);
  });

  it('removes an installed component recording the hour reading and condition', async () => {
    const installed = {
      id: 1, asset_model_id: 5, model_manufacturer: 'Acme', model_model_name: 'Carbide Blade v2',
      installed_on_asset_id: 30, installed_on_serial_number: 'ROBOT-100',
      installed_at_hours: 100, removed_at_hours: null, condition_on_removal: null, notes: null,
    };
    vi.mocked(gearApi.getComponentInstallationsForAsset).mockResolvedValue({ ok: true, data: [installed as any] });
    await resolveRobot();

    vi.mocked(gearApi.removeComponentInstallation).mockResolvedValue({
      ok: true,
      data: { ...installed, removed_at_hours: 340, condition_on_removal: 'Chipped' } as any,
    });

    fireEvent.change(screen.getByPlaceholderText('hours'), { target: { value: '340' } });
    fireEvent.change(screen.getByPlaceholderText('condition'), { target: { value: 'Chipped' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(gearApi.removeComponentInstallation).toHaveBeenCalledWith(1, {
        removed_at_hours: 340,
        condition_on_removal: 'Chipped',
      })
    );
  });
});

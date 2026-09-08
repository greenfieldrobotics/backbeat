import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GearSetupPage from './GearSetupPage';

vi.mock('../api', () => ({
  gearApi: {
    getAssetTypes: vi.fn(),
    createAssetType: vi.fn(),
    updateAssetType: vi.fn(),
    deleteAssetType: vi.fn(),
    getLifecycleStates: vi.fn(),
    createLifecycleState: vi.fn(),
    updateLifecycleState: vi.fn(),
    deleteLifecycleState: vi.fn(),
    getAssetModels: vi.fn(),
    createAssetModel: vi.fn(),
    updateAssetModel: vi.fn(),
    deleteAssetModel: vi.fn(),
    getParties: vi.fn(),
    createParty: vi.fn(),
    updateParty: vi.fn(),
    deleteParty: vi.fn(),
  },
}));

import { gearApi } from '../api';

const ROBOT_TYPE = {
  id: 1, name: 'Robot', description: null,
  supports_location: true, supports_linking: false, supports_maintenance: false, active: true,
};

describe('GearSetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gearApi.getAssetTypes).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(gearApi.getLifecycleStates).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(gearApi.getAssetModels).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(gearApi.getParties).mockResolvedValue({ ok: true, data: [] });
  });

  it('renders the Asset Types tab by default, listing types from the typed API', async () => {
    vi.mocked(gearApi.getAssetTypes).mockResolvedValue({ ok: true, data: [ROBOT_TYPE as any] });

    render(<GearSetupPage />);

    expect(await screen.findByText('Robot')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Asset Types' })).toBeTruthy();
  });

  it('shows an empty state when there are no asset types yet', async () => {
    render(<GearSetupPage />);

    expect(await screen.findByText('No asset types yet.')).toBeTruthy();
  });

  it('adds a new asset type with its capability flags', async () => {
    vi.mocked(gearApi.createAssetType).mockResolvedValue({ ok: true, data: ROBOT_TYPE as any });
    render(<GearSetupPage />);
    await screen.findByText('No asset types yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Add Type' }));
    const nameInput = screen.getAllByRole('textbox')[0];
    fireEvent.change(nameInput, { target: { value: 'Robot' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /lets this type be moved between sites/ }));
    fireEvent.submit(nameInput.closest('form')!);

    await waitFor(() => expect(gearApi.createAssetType).toHaveBeenCalled());
    const call = vi.mocked(gearApi.createAssetType).mock.calls[0][0];
    expect(call.name).toBe('Robot');
    expect(call.supports_location).toBe(true);
  });

  it('explains what each capability flag unlocks, not just three bare booleans', async () => {
    render(<GearSetupPage />);
    await screen.findByText('No asset types yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Add Type' }));

    expect(screen.getByText(/lets this type be moved between sites/)).toBeTruthy();
    expect(screen.getByText(/lets this type be linked to another asset/)).toBeTruthy();
    expect(screen.getByText(/lets work orders be opened against this type/)).toBeTruthy();
  });

  it('switches to the Lifecycle States tab and lists states', async () => {
    vi.mocked(gearApi.getLifecycleStates).mockResolvedValue({
      ok: true,
      data: [{ id: 1, name: 'Available', sort_order: 1, is_terminal: false, active: true } as any],
    });

    render(<GearSetupPage />);
    await screen.findByText('No asset types yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Lifecycle States' }));

    expect(await screen.findByText('Available')).toBeTruthy();
  });

  it('switches to the Models tab and resolves the asset type name', async () => {
    vi.mocked(gearApi.getAssetTypes).mockResolvedValue({ ok: true, data: [ROBOT_TYPE as any] });
    vi.mocked(gearApi.getAssetModels).mockResolvedValue({
      ok: true,
      data: [{ id: 1, asset_type_id: 1, manufacturer: 'Acme', model_name: 'R-100', specs: null, active: true } as any],
    });

    render(<GearSetupPage />);
    await screen.findByText('Robot'); // Types tab loaded
    fireEvent.click(screen.getByRole('button', { name: 'Models' }));

    expect(await screen.findByText('Acme')).toBeTruthy();
    expect(screen.getByText('R-100')).toBeTruthy();
    expect(screen.getByText('Robot')).toBeTruthy(); // resolved from asset_type_id, not a raw id
  });

  it('switches to the Parties tab and adds a party', async () => {
    vi.mocked(gearApi.createParty).mockResolvedValue({
      ok: true,
      data: { id: 1, name: 'Acme Robotics', party_type: 'vendor', active: true } as any,
    });

    render(<GearSetupPage />);
    await screen.findByText('No asset types yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Parties' }));
    expect(await screen.findByText('No parties yet.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add Party' }));
    const nameInput = screen.getAllByRole('textbox')[0];
    fireEvent.change(nameInput, { target: { value: 'Acme Robotics' } });
    fireEvent.submit(nameInput.closest('form')!);

    await waitFor(() =>
      expect(gearApi.createParty).toHaveBeenCalledWith({ name: 'Acme Robotics', party_type: 'internal_entity' })
    );
  });

  it('a create failure surfaces the server error instead of crashing', async () => {
    vi.mocked(gearApi.createAssetType).mockResolvedValue({ ok: false, error: 'An asset type with that name already exists' });
    render(<GearSetupPage />);
    await screen.findByText('No asset types yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Add Type' }));
    const nameInput = screen.getAllByRole('textbox')[0];
    fireEvent.change(nameInput, { target: { value: 'Robot' } });
    fireEvent.submit(nameInput.closest('form')!);

    expect(await screen.findByText('An asset type with that name already exists')).toBeTruthy();
  });
});

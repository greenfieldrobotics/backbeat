import { useEffect, useState } from 'react';
import { gearApi } from '../api';
import { isApiFailure } from '../../../core/httpClient';
import ErrorBoundary from '../components/ErrorBoundary';
import type {
  AssetType, AssetTypeInput, LifecycleState, LifecycleStateInput,
  AssetModel, AssetModelInput, Party, PartyInput, PartyType,
} from '../types';

// Gear Setup (Phase 12) — the admin screen behind G1.2-G1.5. Four reference tables
// (asset_types, lifecycle_states, asset_models, parties) each had a working API
// since Phase 1 and no way for an admin to reach it without a curl call, which is
// exactly what "add a type without a code change or a migration" (G1.2) rules out.
// One page with tabs, not four pages — this is configuration a user visits rarely.
const PARTY_TYPES: PartyType[] = ['internal_entity', 'employee', 'customer', 'vendor'];

type TabKey = 'types' | 'states' | 'models' | 'parties';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'types', label: 'Asset Types' },
  { key: 'states', label: 'Lifecycle States' },
  { key: 'models', label: 'Models' },
  { key: 'parties', label: 'Parties' },
];

function AssetTypesTab() {
  const [rows, setRows] = useState<AssetType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const EMPTY: AssetTypeInput = {
    name: '', description: '', supports_location: false, supports_linking: false, supports_maintenance: false,
  };
  const [form, setForm] = useState<AssetTypeInput>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<AssetTypeInput>(EMPTY);

  const load = async () => {
    setLoading(true);
    const result = await gearApi.getAssetTypes();
    if (!isApiFailure(result)) setRows(result.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const result = await gearApi.createAssetType(form);
    if (isApiFailure(result)) { setError(result.error); return; }
    setForm(EMPTY);
    setShowAdd(false);
    load();
  };

  const startEdit = (t: AssetType) => {
    setEditingId(t.id);
    setEditForm({
      name: t.name, description: t.description ?? '',
      supports_location: t.supports_location, supports_linking: t.supports_linking,
      supports_maintenance: t.supports_maintenance, active: t.active,
    });
    setError('');
  };

  const saveEdit = async (id: number) => {
    setError('');
    const result = await gearApi.updateAssetType(id, editForm);
    if (isApiFailure(result)) { setError(result.error); return; }
    setEditingId(null);
    load();
  };

  const remove = async (t: AssetType) => {
    if (!confirm(`Delete asset type "${t.name}"?`)) return;
    const result = await gearApi.deleteAssetType(t.id);
    if (isApiFailure(result)) { alert(result.error); return; }
    load();
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Asset Types</h2>
        <button className="btn-primary" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? 'Cancel' : 'Add Type'}
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      {showAdd && (
        <form className="form-group" onSubmit={handleAdd}>
          <label>Name</label>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          <label>Description</label>
          <input value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })} />
          <label>
            <input
              type="checkbox"
              checked={!!form.supports_location}
              onChange={e => setForm({ ...form, supports_location: e.target.checked })}
            />{' '}
            Track location — lets this type be moved between sites and scanned to a location (Locate).
          </label>
          <label>
            <input
              type="checkbox"
              checked={!!form.supports_linking}
              onChange={e => setForm({ ...form, supports_linking: e.target.checked })}
            />{' '}
            Support linking — lets this type be linked to another asset (Link), e.g. a battery in a robot.
          </label>
          <label>
            <input
              type="checkbox"
              checked={!!form.supports_maintenance}
              onChange={e => setForm({ ...form, supports_maintenance: e.target.checked })}
            />{' '}
            Track maintenance — lets work orders be opened against this type (Maintenance).
          </label>
          <button className="btn-primary btn-sm" type="submit">Save</button>
        </form>
      )}

      <table>
        <thead>
          <tr><th>Name</th><th>Description</th><th>Location</th><th>Linking</th><th>Maintenance</th><th>Active</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {rows.map(t => (
            <tr key={t.id}>
              {editingId === t.id ? (
                <>
                  <td><input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} /></td>
                  <td><input value={editForm.description ?? ''} onChange={e => setEditForm({ ...editForm, description: e.target.value })} /></td>
                  <td><input type="checkbox" checked={!!editForm.supports_location} onChange={e => setEditForm({ ...editForm, supports_location: e.target.checked })} /></td>
                  <td><input type="checkbox" checked={!!editForm.supports_linking} onChange={e => setEditForm({ ...editForm, supports_linking: e.target.checked })} /></td>
                  <td><input type="checkbox" checked={!!editForm.supports_maintenance} onChange={e => setEditForm({ ...editForm, supports_maintenance: e.target.checked })} /></td>
                  <td><input type="checkbox" checked={editForm.active !== false} onChange={e => setEditForm({ ...editForm, active: e.target.checked })} /></td>
                  <td>
                    <button className="btn-primary btn-sm" onClick={() => saveEdit(t.id)}>Save</button>{' '}
                    <button className="btn-secondary btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  </td>
                </>
              ) : (
                <>
                  <td><strong>{t.name}</strong></td>
                  <td>{t.description || '—'}</td>
                  <td>{t.supports_location ? 'Yes' : 'No'}</td>
                  <td>{t.supports_linking ? 'Yes' : 'No'}</td>
                  <td>{t.supports_maintenance ? 'Yes' : 'No'}</td>
                  <td>{t.active ? 'Yes' : 'No'}</td>
                  <td>
                    <button className="btn-secondary btn-sm" onClick={() => startEdit(t)}>Edit</button>{' '}
                    <button className="btn-danger btn-sm" onClick={() => remove(t)}>Delete</button>
                  </td>
                </>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: 'center', color: '#888' }}>No asset types yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function LifecycleStatesTab() {
  const [rows, setRows] = useState<LifecycleState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const EMPTY: LifecycleStateInput = { name: '', sort_order: 0, is_terminal: false };
  const [form, setForm] = useState<LifecycleStateInput>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<LifecycleStateInput>(EMPTY);

  const load = async () => {
    setLoading(true);
    const result = await gearApi.getLifecycleStates();
    if (!isApiFailure(result)) setRows(result.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const result = await gearApi.createLifecycleState(form);
    if (isApiFailure(result)) { setError(result.error); return; }
    setForm(EMPTY);
    setShowAdd(false);
    load();
  };

  const startEdit = (s: LifecycleState) => {
    setEditingId(s.id);
    setEditForm({ name: s.name, sort_order: s.sort_order, is_terminal: s.is_terminal, active: s.active });
    setError('');
  };

  const saveEdit = async (id: number) => {
    setError('');
    const result = await gearApi.updateLifecycleState(id, editForm);
    if (isApiFailure(result)) { setError(result.error); return; }
    setEditingId(null);
    load();
  };

  const remove = async (s: LifecycleState) => {
    if (!confirm(`Delete lifecycle state "${s.name}"?`)) return;
    const result = await gearApi.deleteLifecycleState(s.id);
    if (isApiFailure(result)) { alert(result.error); return; }
    load();
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Lifecycle States</h2>
        <button className="btn-primary" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? 'Cancel' : 'Add State'}
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      {showAdd && (
        <form className="form-group" onSubmit={handleAdd}>
          <label>Name</label>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          <label>Sort order</label>
          <input
            type="number"
            value={form.sort_order ?? 0}
            onChange={e => setForm({ ...form, sort_order: Number(e.target.value) })}
          />
          <label>
            <input
              type="checkbox"
              checked={!!form.is_terminal}
              onChange={e => setForm({ ...form, is_terminal: e.target.checked })}
            />{' '}
            Terminal — an asset in this state is at the end of its life (e.g. Retired).
          </label>
          <button className="btn-primary btn-sm" type="submit">Save</button>
        </form>
      )}

      <table>
        <thead>
          <tr><th>Name</th><th>Sort Order</th><th>Terminal</th><th>Active</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {rows.map(s => (
            <tr key={s.id}>
              {editingId === s.id ? (
                <>
                  <td><input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} /></td>
                  <td>
                    <input
                      type="number"
                      value={editForm.sort_order ?? 0}
                      onChange={e => setEditForm({ ...editForm, sort_order: Number(e.target.value) })}
                    />
                  </td>
                  <td><input type="checkbox" checked={!!editForm.is_terminal} onChange={e => setEditForm({ ...editForm, is_terminal: e.target.checked })} /></td>
                  <td><input type="checkbox" checked={editForm.active !== false} onChange={e => setEditForm({ ...editForm, active: e.target.checked })} /></td>
                  <td>
                    <button className="btn-primary btn-sm" onClick={() => saveEdit(s.id)}>Save</button>{' '}
                    <button className="btn-secondary btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  </td>
                </>
              ) : (
                <>
                  <td><strong>{s.name}</strong></td>
                  <td>{s.sort_order}</td>
                  <td>{s.is_terminal ? 'Yes' : 'No'}</td>
                  <td>{s.active ? 'Yes' : 'No'}</td>
                  <td>
                    <button className="btn-secondary btn-sm" onClick={() => startEdit(s)}>Edit</button>{' '}
                    <button className="btn-danger btn-sm" onClick={() => remove(s)}>Delete</button>
                  </td>
                </>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5} style={{ textAlign: 'center', color: '#888' }}>No lifecycle states yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AssetModelsTab() {
  const [rows, setRows] = useState<AssetModel[]>([]);
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const EMPTY: AssetModelInput = { asset_type_id: '', manufacturer: '', model_name: '' };
  const [form, setForm] = useState<AssetModelInput>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<AssetModelInput>(EMPTY);

  const load = async () => {
    setLoading(true);
    const [modelsResult, typesResult] = await Promise.all([gearApi.getAssetModels(), gearApi.getAssetTypes()]);
    if (!isApiFailure(modelsResult)) setRows(modelsResult.data);
    if (!isApiFailure(typesResult)) setAssetTypes(typesResult.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const typeName = (id: number) => assetTypes.find(t => t.id === id)?.name ?? `#${id}`;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.asset_type_id) { setError('asset_type_id is required'); return; }
    // manufacturer is required (§6.5 item 3) — a model with no manufacturer is
    // unrecoverable, so this is checked before the request goes out, not just server-side.
    if (!form.manufacturer.trim()) { setError('manufacturer is required'); return; }
    const result = await gearApi.createAssetModel({ ...form, asset_type_id: Number(form.asset_type_id) });
    if (isApiFailure(result)) { setError(result.error); return; }
    setForm(EMPTY);
    setShowAdd(false);
    load();
  };

  const startEdit = (m: AssetModel) => {
    setEditingId(m.id);
    setEditForm({ asset_type_id: m.asset_type_id, manufacturer: m.manufacturer, model_name: m.model_name, active: m.active });
    setError('');
  };

  const saveEdit = async (id: number) => {
    setError('');
    if (!editForm.manufacturer.trim()) { setError('manufacturer is required'); return; }
    const result = await gearApi.updateAssetModel(id, { ...editForm, asset_type_id: Number(editForm.asset_type_id) });
    if (isApiFailure(result)) { setError(result.error); return; }
    setEditingId(null);
    load();
  };

  const remove = async (m: AssetModel) => {
    if (!confirm(`Delete model "${m.manufacturer} ${m.model_name}"?`)) return;
    const result = await gearApi.deleteAssetModel(m.id);
    if (isApiFailure(result)) { alert(result.error); return; }
    load();
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Models</h2>
        <button className="btn-primary" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? 'Cancel' : 'Add Model'}
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      {showAdd && (
        <form className="form-group" onSubmit={handleAdd}>
          <label>Asset Type</label>
          <select value={form.asset_type_id} onChange={e => setForm({ ...form, asset_type_id: e.target.value })} required>
            <option value="">— Select —</option>
            {assetTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <label>Manufacturer</label>
          <input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} required />
          <label>Model Name</label>
          <input value={form.model_name} onChange={e => setForm({ ...form, model_name: e.target.value })} required />
          <button className="btn-primary btn-sm" type="submit">Save</button>
        </form>
      )}

      <table>
        <thead>
          <tr><th>Type</th><th>Manufacturer</th><th>Model Name</th><th>Active</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {rows.map(m => (
            <tr key={m.id}>
              {editingId === m.id ? (
                <>
                  <td>
                    <select value={editForm.asset_type_id} onChange={e => setEditForm({ ...editForm, asset_type_id: e.target.value })}>
                      {assetTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </td>
                  <td><input value={editForm.manufacturer} onChange={e => setEditForm({ ...editForm, manufacturer: e.target.value })} /></td>
                  <td><input value={editForm.model_name} onChange={e => setEditForm({ ...editForm, model_name: e.target.value })} /></td>
                  <td><input type="checkbox" checked={editForm.active !== false} onChange={e => setEditForm({ ...editForm, active: e.target.checked })} /></td>
                  <td>
                    <button className="btn-primary btn-sm" onClick={() => saveEdit(m.id)}>Save</button>{' '}
                    <button className="btn-secondary btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  </td>
                </>
              ) : (
                <>
                  <td>{typeName(m.asset_type_id)}</td>
                  <td>{m.manufacturer}</td>
                  <td>{m.model_name}</td>
                  <td>{m.active ? 'Yes' : 'No'}</td>
                  <td>
                    <button className="btn-secondary btn-sm" onClick={() => startEdit(m)}>Edit</button>{' '}
                    <button className="btn-danger btn-sm" onClick={() => remove(m)}>Delete</button>
                  </td>
                </>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5} style={{ textAlign: 'center', color: '#888' }}>No models yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PartiesTab() {
  const [rows, setRows] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const EMPTY: PartyInput = { name: '', party_type: 'internal_entity' };
  const [form, setForm] = useState<PartyInput>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<PartyInput>(EMPTY);

  const load = async () => {
    setLoading(true);
    const result = await gearApi.getParties();
    if (!isApiFailure(result)) setRows(result.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const result = await gearApi.createParty(form);
    if (isApiFailure(result)) { setError(result.error); return; }
    setForm(EMPTY);
    setShowAdd(false);
    load();
  };

  const startEdit = (p: Party) => {
    setEditingId(p.id);
    setEditForm({ name: p.name, party_type: p.party_type, active: p.active });
    setError('');
  };

  const saveEdit = async (id: number) => {
    setError('');
    const result = await gearApi.updateParty(id, editForm);
    if (isApiFailure(result)) { setError(result.error); return; }
    setEditingId(null);
    load();
  };

  const remove = async (p: Party) => {
    if (!confirm(`Delete party "${p.name}"?`)) return;
    const result = await gearApi.deleteParty(p.id);
    if (isApiFailure(result)) { alert(result.error); return; }
    load();
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Parties</h2>
        <button className="btn-primary" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? 'Cancel' : 'Add Party'}
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      {showAdd && (
        <form className="form-group" onSubmit={handleAdd}>
          <label>Name</label>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          <label>Party Type</label>
          <select value={form.party_type} onChange={e => setForm({ ...form, party_type: e.target.value as PartyType })}>
            {PARTY_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
          </select>
          <button className="btn-primary btn-sm" type="submit">Save</button>
        </form>
      )}

      <table>
        <thead>
          <tr><th>Name</th><th>Type</th><th>Active</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.id}>
              {editingId === p.id ? (
                <>
                  <td><input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} /></td>
                  <td>
                    <select value={editForm.party_type} onChange={e => setEditForm({ ...editForm, party_type: e.target.value as PartyType })}>
                      {PARTY_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                    </select>
                  </td>
                  <td><input type="checkbox" checked={editForm.active !== false} onChange={e => setEditForm({ ...editForm, active: e.target.checked })} /></td>
                  <td>
                    <button className="btn-primary btn-sm" onClick={() => saveEdit(p.id)}>Save</button>{' '}
                    <button className="btn-secondary btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  </td>
                </>
              ) : (
                <>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.party_type}</td>
                  <td>{p.active ? 'Yes' : 'No'}</td>
                  <td>
                    <button className="btn-secondary btn-sm" onClick={() => startEdit(p)}>Edit</button>{' '}
                    <button className="btn-danger btn-sm" onClick={() => remove(p)}>Delete</button>
                  </td>
                </>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={4} style={{ textAlign: 'center', color: '#888' }}>No parties yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function GearSetupPageContent() {
  const [tab, setTab] = useState<TabKey>('types');

  return (
    <div>
      <div className="page-header">
        <h1>Gear Setup</h1>
      </div>
      <p>
        Configuration for the Gear module — asset types, lifecycle states, the model catalog and
        the shared party list. Visited rarely; changes here take effect immediately everywhere
        else in Gear.
      </p>
      <div className="form-group" style={{ display: 'flex', gap: '0.5rem' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            className={tab === t.key ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'types' && <AssetTypesTab />}
      {tab === 'states' && <LifecycleStatesTab />}
      {tab === 'models' && <AssetModelsTab />}
      {tab === 'parties' && <PartiesTab />}
    </div>
  );
}

export default function GearSetupPage() {
  return (
    <ErrorBoundary>
      <GearSetupPageContent />
    </ErrorBoundary>
  );
}

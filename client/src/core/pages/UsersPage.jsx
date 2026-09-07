import { useState, useEffect } from 'react';
import { api } from '../api';

const ROLES = ['admin', 'warehouse', 'procurement', 'viewer'];

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', name: '', role: 'viewer' });
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});

  const loadUsers = () => {
    setLoading(true);
    api.getUsers()
      .then(setUsers)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadUsers(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.createUser(newUser);
      setNewUser({ email: '', name: '', role: 'viewer' });
      setShowAddForm(false);
      loadUsers();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEdit = (user) => {
    setEditingId(user.id);
    setEditValues({ name: user.name, role: user.role });
  };

  const handleSaveEdit = async (id) => {
    setError(null);
    try {
      await api.updateUser(id, editValues);
      setEditingId(null);
      loadUsers();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (user) => {
    if (!window.confirm(`Remove ${user.email} from the system?`)) return;
    setError(null);
    try {
      await api.deleteUser(user.id);
      loadUsers();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>User Management</h1>
        <button onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Cancel' : 'Add User'}
        </button>
      </div>

      {error && <div style={{ color: '#dc2626', marginBottom: '1rem' }}>{error}</div>}

      {showAddForm && (
        <form onSubmit={handleAdd} style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'end' }}>
            <label>
              Email *
              <input
                type="email"
                value={newUser.email}
                onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                required
                placeholder="user@example.com"
              />
            </label>
            <label>
              Name
              <input
                type="text"
                value={newUser.name}
                onChange={e => setNewUser({ ...newUser, name: e.target.value })}
                placeholder="Full Name"
              />
            </label>
            <label>
              Role
              <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <button type="submit">Add</button>
          </div>
        </form>
      )}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Last Login</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr><td colSpan="5" className="empty-state">No users</td></tr>
          ) : (
            users.map(user => (
              <tr key={user.id}>
                <td>
                  {editingId === user.id ? (
                    <input
                      type="text"
                      value={editValues.name}
                      onChange={e => setEditValues({ ...editValues, name: e.target.value })}
                    />
                  ) : (
                    user.name || '—'
                  )}
                </td>
                <td>{user.email}</td>
                <td>
                  {editingId === user.id ? (
                    <select value={editValues.role} onChange={e => setEditValues({ ...editValues, role: e.target.value })}>
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    user.role
                  )}
                </td>
                <td>{user.last_login_at ? new Date(user.last_login_at).toLocaleDateString() : 'Never'}</td>
                <td>
                  {editingId === user.id ? (
                    <>
                      <button onClick={() => handleSaveEdit(user.id)}>Save</button>{' '}
                      <button onClick={() => setEditingId(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => handleEdit(user)}>Edit</button>{' '}
                      <button onClick={() => handleDelete(user)} style={{ color: '#dc2626' }}>Remove</button>
                    </>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// src/pages/ConnectionsPage.jsx
import React, { useContext, useEffect, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserContext } from '../context/UserContext';
import { authHeader } from '../utils/auth';
import Button from '../components/ui/Button';
import Input, { Select } from '../components/ui/Input';
import Modal, { ModalBody, ModalFooter } from '../components/ui/Modal';
import EmptyState from '../components/ui/EmptyState';

const ADMIN_ROLES = new Set(['Admin', 'SystemAdmin']);
const SYSTEM_ADMIN_ROLES = new Set(['Admin', 'SystemAdmin']);

const ODBC_DRIVERS = ['ODBC Driver 17 for SQL Server', 'ODBC Driver 18 for SQL Server'];

const DEFAULT_FORM = {
  name: '',
  host: '',
  port: '1433',
  database: '',
  db_user: '',
  db_password: '',
  odbc_driver: ODBC_DRIVERS[0],
};

function hasRole(user, roleSet) {
  if (!user?.roles) return false;
  return user.roles.some((r) => roleSet.has(r));
}

// ---------------------------------------------------------------------------
// Form modal (add / edit)
// ---------------------------------------------------------------------------

function ConnectionModal({ mode, initial, onClose, onSaved }) {
  const [form, setForm] = useState(
    mode === 'edit' ? { ...DEFAULT_FORM, ...initial } : DEFAULT_FORM
  );
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const firstInputRef = useRef(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const port = parseInt(form.port, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      setSaving(false);
      setError('Port must be a number between 1 and 65535.');
      return;
    }

    const payload = {
      name: form.name,
      host: form.host,
      port,
      database: form.database,
      db_user: form.db_user,
      odbc_driver: form.odbc_driver,
    };

    if (form.db_password) {
      payload.db_password = form.db_password;
    } else if (mode === 'add') {
      setSaving(false);
      setError('Password is required.');
      return;
    }

    const url = mode === 'add' ? '/api/connections' : `/api/connections/${initial.id}`;
    const method = mode === 'add' ? 'POST' : 'PATCH';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? 'An error occurred.');
        setSaving(false);
        return;
      }
      setSaving(false);
      onSaved(data);
    } catch {
      setError('Network error. Please try again.');
      setSaving(false);
    }
  }

  const title = mode === 'add' ? 'Add connection' : 'Edit connection';

  return (
    <Modal title={title} onClose={onClose} size="lg" disableClose={saving}>
      <form onSubmit={handleSubmit}>
        <ModalBody className="space-y-4">
          {error && (
            <div className="rounded bg-danger-50 border border-danger-200 px-3 py-2 text-sm text-danger-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Display name <span className="text-danger-600">*</span>
            </label>
            <Input
              ref={firstInputRef}
              type="text"
              required
              maxLength={255}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Production ERP"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Host <span className="text-danger-600">*</span>
              </label>
              <Input
                type="text"
                required
                value={form.host}
                onChange={(e) => set('host', e.target.value)}
                placeholder="e.g. 192.168.1.10"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Port <span className="text-danger-600">*</span>
              </label>
              <Input
                type="number"
                required
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => set('port', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Database name <span className="text-danger-600">*</span>
            </label>
            <Input
              type="text"
              required
              value={form.database}
              onChange={(e) => set('database', e.target.value)}
              placeholder="e.g. MyDatabase"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username <span className="text-danger-600">*</span>
              </label>
              <Input
                type="text"
                required
                value={form.db_user}
                onChange={(e) => set('db_user', e.target.value)}
                placeholder="SQL login"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password{mode === 'add' && <span className="text-danger-600"> *</span>}
                {mode === 'edit' && (
                  <span className="text-gray-400 font-normal"> (leave blank to keep)</span>
                )}
              </label>
              <Input
                type="password"
                required={mode === 'add'}
                value={form.db_password}
                onChange={(e) => set('db_password', e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ODBC driver</label>
            <Select value={form.odbc_driver} onChange={(e) => set('odbc_driver', e.target.value)}>
              {ODBC_DRIVERS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </div>
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : mode === 'add' ? 'Add connection' : 'Save changes'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation modal
// ---------------------------------------------------------------------------

function DeleteModal({ connection, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/connections/${connection.id}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? 'Failed to delete connection.');
        setDeleting(false);
        return;
      }
      onDeleted(connection.id);
    } catch {
      setError('Network error. Please try again.');
      setDeleting(false);
    }
  }

  return (
    <Modal title="Delete connection" onClose={onClose} disableClose={deleting}>
      <ModalBody>
        {error && (
          <div className="mb-3 rounded bg-danger-50 border border-danger-200 px-3 py-2 text-sm text-danger-700">
            {error}
          </div>
        )}
        <p className="text-sm text-gray-700">
          Are you sure you want to delete <span className="font-semibold">{connection.name}</span>?
          This will deactivate the connection. Historical data is preserved.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={deleting}>
          Cancel
        </Button>
        <Button variant="danger" onClick={handleDelete} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Delete'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function connectionsReducer(state, action) {
  switch (action.type) {
    case 'LOADING':
      return { ...state, loading: true, error: null };
    case 'LOADED':
      return { ...state, loading: false, connections: action.payload };
    case 'ERROR':
      return { ...state, loading: false, error: action.payload };
    case 'ADD':
      return { ...state, connections: [...state.connections, action.payload] };
    case 'UPDATE':
      return {
        ...state,
        connections: state.connections.map((c) =>
          c.id === action.payload.id ? { ...c, ...action.payload } : c
        ),
      };
    case 'REMOVE':
      return {
        ...state,
        connections: state.connections.filter((c) => c.id !== action.payload),
      };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ConnectionsPage() {
  const user = useContext(UserContext);
  const isAdmin = hasRole(user, ADMIN_ROLES);
  const isSystemAdmin = hasRole(user, SYSTEM_ADMIN_ROLES);

  const [state, dispatch] = useReducer(connectionsReducer, {
    loading: true,
    error: null,
    connections: [],
  });

  const [modal, setModal] = useState(null);

  useEffect(() => {
    dispatch({ type: 'LOADING' });
    fetch('/api/connections', { headers: authHeader() })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => dispatch({ type: 'LOADED', payload: data }))
      .catch((err) => dispatch({ type: 'ERROR', payload: err.message }));
  }, []);

  function handleSaved(data) {
    if (modal?.type === 'add') {
      dispatch({ type: 'ADD', payload: { created_date: null, modified_date: null, ...data } });
    } else {
      dispatch({ type: 'UPDATE', payload: data });
    }
    setModal(null);
  }

  function handleDeleted(id) {
    dispatch({ type: 'REMOVE', payload: id });
    setModal(null);
  }

  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Connections</h1>
          {isAdmin && (
            <Button onClick={() => setModal({ type: 'add' })}>
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add connection
            </Button>
          )}
        </div>

        <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
          {state.loading && (
            <div className="py-16 text-center text-sm text-gray-400">Loading connections…</div>
          )}
          {state.error && (
            <div className="py-16 text-center text-sm text-danger-600">
              Failed to load connections: {state.error}
            </div>
          )}
          {!state.loading && !state.error && state.connections.length === 0 && (
            <EmptyState
              message="No connections yet."
              action={
                isAdmin && (
                  <button
                    onClick={() => setModal({ type: 'add' })}
                    className="text-sm text-brand-600 hover:underline"
                  >
                    Add connection
                  </button>
                )
              }
            />
          )}
          {!state.loading && !state.error && state.connections.length > 0 && (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Added
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last modified
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {state.connections.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{c.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {formatDate(c.created_date)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {formatDate(c.modified_date)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          to={`/connections/${c.id}/browse`}
                          className="text-sm text-brand-600 hover:text-brand-800 transition-colors"
                        >
                          Browse
                        </Link>
                        {isAdmin && (
                          <button
                            onClick={() => setModal({ type: 'edit', connection: c })}
                            className="text-sm text-brand-600 hover:text-brand-800 transition-colors"
                          >
                            Edit
                          </button>
                        )}
                        {isSystemAdmin && (
                          <button
                            onClick={() => setModal({ type: 'delete', connection: c })}
                            className="text-sm text-danger-600 hover:text-danger-800 transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modal?.type === 'add' && (
        <ConnectionModal mode="add" onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
      {modal?.type === 'edit' && (
        <ConnectionModal
          mode="edit"
          initial={modal.connection}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
      {modal?.type === 'delete' && (
        <DeleteModal
          connection={modal.connection}
          onClose={() => setModal(null)}
          onDeleted={handleDeleted}
        />
      )}
    </>
  );
}

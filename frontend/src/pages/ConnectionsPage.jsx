// src/pages/ConnectionsPage.jsx
import React, { useContext, useEffect, useReducer, useRef, useState } from 'react';
import { UserContext } from '../context/UserContext';

const ADMIN_ROLES = new Set(['Admin', 'SystemAdmin']);
const SYSTEM_ADMIN_ROLES = new Set(['SystemAdmin']);

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

function authHeader() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
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

    const payload = {
      name: form.name,
      host: form.host,
      port: parseInt(form.port, 10),
      database: form.database,
      db_user: form.db_user,
      odbc_driver: form.odbc_driver,
    };

    // Only include password if provided (edit: blank means "keep existing")
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
      onSaved(data);
    } catch {
      setError('Network error. Please try again.');
      setSaving(false);
    }
  }

  const title = mode === 'add' ? 'Add connection' : 'Edit connection';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form — footer is inside so Save is a proper submit control */}
        <form id="connection-form" onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && (
            <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Display name <span className="text-red-500">*</span>
            </label>
            <input
              ref={firstInputRef}
              type="text"
              required
              maxLength={255}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Production ERP"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Host <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={form.host}
                onChange={(e) => set('host', e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. 192.168.1.10"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Port <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                required
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => set('port', e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Database name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={form.database}
              onChange={(e) => set('database', e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. MyDatabase"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={form.db_user}
                onChange={(e) => set('db_user', e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="SQL login"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password{mode === 'add' && <span className="text-red-500"> *</span>}
                {mode === 'edit' && (
                  <span className="text-gray-400 font-normal"> (leave blank to keep)</span>
                )}
              </label>
              <input
                type="password"
                required={mode === 'add'}
                value={form.db_password}
                onChange={(e) => set('db_password', e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoComplete="new-password"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ODBC driver</label>
            <select
              value={form.odbc_driver}
              onChange={(e) => set('odbc_driver', e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {ODBC_DRIVERS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* Footer — inside the form so Save is a native submit button */}
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-200 -mx-6 px-6 pb-0 mt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : mode === 'add' ? 'Add connection' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Delete connection</h2>
        </div>
        <div className="px-6 py-4">
          {error && (
            <div className="mb-3 rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <p className="text-sm text-gray-700">
            Are you sure you want to delete <span className="font-semibold">{connection.name}</span>
            ? This will deactivate the connection. Historical data is preserved.
          </p>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <button
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connections state reducer
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

  const [modal, setModal] = useState(null); // null | { type: 'add' } | { type: 'edit', connection } | { type: 'delete', connection }

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
      // Re-fetch to get the full row including server-set dates.
      fetch('/api/connections', { headers: authHeader() })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((list) => dispatch({ type: 'LOADED', payload: list }))
        .catch((err) => dispatch({ type: 'ERROR', payload: err.message }));
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
        {/* Page header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Connections</h1>
          {isAdmin && (
            <button
              onClick={() => setModal({ type: 'add' })}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
            >
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
            </button>
          )}
        </div>

        {/* Table card */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          {state.loading && (
            <div className="py-16 text-center text-sm text-gray-400">Loading connections…</div>
          )}

          {state.error && (
            <div className="py-16 text-center text-sm text-red-500">
              Failed to load connections: {state.error}
            </div>
          )}

          {!state.loading && !state.error && state.connections.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-sm text-gray-400 mb-1">No connections yet.</p>
              {isAdmin && (
                <p className="text-sm text-gray-400">
                  Click{' '}
                  <button
                    onClick={() => setModal({ type: 'add' })}
                    className="text-blue-600 hover:underline"
                  >
                    Add connection
                  </button>{' '}
                  to get started.
                </p>
              )}
            </div>
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
                  {isAdmin && (
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  )}
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
                    {isAdmin && (
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => setModal({ type: 'edit', connection: c })}
                            className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
                          >
                            Edit
                          </button>
                          {isSystemAdmin && (
                            <button
                              onClick={() => setModal({ type: 'delete', connection: c })}
                              className="text-sm text-red-500 hover:text-red-700 transition-colors"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modals */}
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

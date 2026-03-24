// src/pages/UsersPage.jsx
import React, { useContext, useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../context/UserContext';

const ADMIN_ROLES = new Set(['Admin', 'SystemAdmin']);
const SYSTEM_ADMIN_ROLES = new Set(['SystemAdmin']);

const ALL_ROLES = ['EndUser', 'Admin', 'SystemAdmin'];

function hasRole(user, roleSet) {
  if (!user?.roles) return false;
  return user.roles.some((r) => roleSet.has(r));
}

function authHeader() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function callerMaxPrecedence(user) {
  const prec = { EndUser: 1, Admin: 2, SystemAdmin: 3 };
  if (!user?.roles) return 0;
  return Math.max(...user.roles.map((r) => prec[r] ?? 0), 0);
}

// Roles the calling user is allowed to assign (cannot escalate above own level).
function assignableRoles(user) {
  const maxPrec = callerMaxPrecedence(user);
  const prec = { EndUser: 1, Admin: 2, SystemAdmin: 3 };
  return ALL_ROLES.filter((r) => (prec[r] ?? 0) <= maxPrec);
}

// ---------------------------------------------------------------------------
// Add user modal
// ---------------------------------------------------------------------------

const DEFAULT_ADD_FORM = { username: '', email: '', password: '', role: 'EndUser' };

function AddUserModal({ user: callerUser, onClose, onAdded }) {
  const [form, setForm] = useState(DEFAULT_ADD_FORM);
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

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? 'An error occurred.');
        setSaving(false);
        return;
      }
      setSaving(false);
      onAdded(data);
    } catch {
      setError('Network error. Please try again.');
      setSaving(false);
    }
  }

  const roles = assignableRoles(callerUser);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Add user</h2>
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

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && (
            <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username <span className="text-red-500">*</span>
            </label>
            <input
              ref={firstInputRef}
              type="text"
              required
              maxLength={100}
              value={form.username}
              onChange={(e) => set('username', e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              required
              maxLength={255}
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              required
              minLength={12}
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="new-password"
            />
            <p className="mt-1 text-xs text-gray-400">Minimum 12 characters</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={form.role}
              onChange={(e) => set('role', e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

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
              {saving ? 'Adding…' : 'Add user'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit role modal
// ---------------------------------------------------------------------------

function EditRoleModal({ target, callerUser, onClose, onSaved }) {
  const roles = assignableRoles(callerUser);
  const initialRole = roles.includes(target.roles[0]) ? target.roles[0] : (roles[0] ?? 'EndUser');
  const [role, setRole] = useState(initialRole);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/users/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? 'An error occurred.');
        setSaving(false);
        return;
      }
      setSaving(false);
      onSaved({ ...target, roles: [role] });
    } catch {
      setError('Network error. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Edit role</h2>
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

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && (
            <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <p className="text-sm text-gray-700">
            Changing role for <span className="font-semibold">{target.username}</span>
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

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
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deactivate confirmation modal
// ---------------------------------------------------------------------------

function DeactivateModal({ target, onClose, onDeactivated }) {
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState(null);

  async function handleDeactivate() {
    setDeactivating(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${target.id}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? 'Failed to deactivate user.');
        setDeactivating(false);
        return;
      }
      onDeactivated(target.id);
    } catch {
      setError('Network error. Please try again.');
      setDeactivating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Deactivate user</h2>
        </div>
        <div className="px-6 py-4">
          {error && (
            <div className="mb-3 rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <p className="text-sm text-gray-700">
            Are you sure you want to deactivate{' '}
            <span className="font-semibold">{target.username}</span>? They will no longer be able to
            sign in.
          </p>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <button
            onClick={onClose}
            disabled={deactivating}
            className="px-4 py-2 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleDeactivate}
            disabled={deactivating}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            {deactivating ? 'Deactivating…' : 'Deactivate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users state reducer
// ---------------------------------------------------------------------------

function usersReducer(state, action) {
  switch (action.type) {
    case 'LOADING':
      return { ...state, loading: true, error: null };
    case 'LOADED':
      return { ...state, loading: false, users: action.payload };
    case 'ERROR':
      return { ...state, loading: false, error: action.payload };
    case 'ADD':
      return { ...state, users: [...state.users, action.payload] };
    case 'UPDATE':
      return {
        ...state,
        users: state.users.map((u) =>
          u.id === action.payload.id ? { ...u, ...action.payload } : u
        ),
      };
    case 'DEACTIVATE':
      return {
        ...state,
        users: state.users.map((u) => (u.id === action.payload ? { ...u, is_active: false } : u)),
      };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Role badge
// ---------------------------------------------------------------------------

const ROLE_BADGE_CLASSES = {
  SystemAdmin: 'bg-purple-100 text-purple-700',
  Admin: 'bg-blue-100 text-blue-700',
  EndUser: 'bg-gray-100 text-gray-600',
};

function RoleBadge({ role }) {
  const cls = ROLE_BADGE_CLASSES[role] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {role}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function UsersPage() {
  const callerUser = useContext(UserContext);
  const isAdmin = hasRole(callerUser, ADMIN_ROLES);
  const isSystemAdmin = hasRole(callerUser, SYSTEM_ADMIN_ROLES);
  const navigate = useNavigate();

  const [state, dispatch] = useReducer(usersReducer, {
    loading: true,
    error: null,
    users: [],
  });

  const [modal, setModal] = useState(null);

  useEffect(() => {
    dispatch({ type: 'LOADING' });
    fetch('/api/users', { headers: authHeader() })
      .then((r) => {
        if (r.status === 401) {
          localStorage.removeItem('token');
          navigate('/login', { replace: true });
          throw new Error('Session expired');
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => dispatch({ type: 'LOADED', payload: data }))
      .catch((err) => dispatch({ type: 'ERROR', payload: err.message }));
  }, [navigate]);

  function handleAdded(data) {
    // POST returns { id, username, email, role } — normalise to list shape
    dispatch({
      type: 'ADD',
      payload: {
        id: data.id,
        username: data.username,
        email: data.email,
        roles: [data.role],
        is_active: true,
        created_date: null,
        modified_date: null,
      },
    });
    setModal(null);
  }

  function handleRoleSaved(updated) {
    dispatch({ type: 'UPDATE', payload: updated });
    setModal(null);
  }

  function handleDeactivated(id) {
    dispatch({ type: 'DEACTIVATE', payload: id });
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

  const isSelf = (u) => u.id === callerUser?.user_id;

  return (
    <>
      <div className="space-y-6">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
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
              Add user
            </button>
          )}
        </div>

        {/* Table card */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          {state.loading && (
            <div className="py-16 text-center text-sm text-gray-400">Loading users…</div>
          )}

          {state.error && (
            <div className="py-16 text-center text-sm text-red-500">
              Failed to load users: {state.error}
            </div>
          )}

          {!state.loading && !state.error && state.users.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-sm text-gray-400">No users found.</p>
            </div>
          )}

          {!state.loading && !state.error && state.users.length > 0 && (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Username
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  {isAdmin && (
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {state.users.map((u) => (
                  <tr
                    key={u.id}
                    className={`hover:bg-gray-50 transition-colors ${!u.is_active ? 'opacity-50' : ''}`}
                  >
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {u.username}
                      {isSelf(u) && (
                        <span className="ml-2 text-xs text-gray-400 font-normal">(you)</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{u.email}</td>
                    <td className="px-6 py-4 text-sm">
                      {u.roles.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {u.roles.map((r) => (
                            <RoleBadge key={r} role={r} />
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {u.is_active ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {formatDate(u.created_date)}
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {u.is_active && (
                            <button
                              onClick={() => setModal({ type: 'edit-role', target: u })}
                              className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
                            >
                              Edit role
                            </button>
                          )}
                          {isSystemAdmin && u.is_active && !isSelf(u) && (
                            <button
                              onClick={() => setModal({ type: 'deactivate', target: u })}
                              className="text-sm text-red-500 hover:text-red-700 transition-colors"
                            >
                              Deactivate
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
        <AddUserModal user={callerUser} onClose={() => setModal(null)} onAdded={handleAdded} />
      )}
      {modal?.type === 'edit-role' && (
        <EditRoleModal
          target={modal.target}
          callerUser={callerUser}
          onClose={() => setModal(null)}
          onSaved={handleRoleSaved}
        />
      )}
      {modal?.type === 'deactivate' && (
        <DeactivateModal
          target={modal.target}
          onClose={() => setModal(null)}
          onDeactivated={handleDeactivated}
        />
      )}
    </>
  );
}

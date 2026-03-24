// src/pages/UsersPage.jsx
import React, { useContext, useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../context/UserContext';
import { authHeader } from '../utils/auth';
import Button from '../components/ui/Button';
import Input, { Select } from '../components/ui/Input';
import Modal, { ModalBody, ModalFooter } from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';

const ADMIN_ROLES = new Set(['Admin', 'SystemAdmin']);
const SYSTEM_ADMIN_ROLES = new Set(['SystemAdmin']);

const ALL_ROLES = ['EndUser', 'Admin', 'SystemAdmin'];

const ROLE_PRECEDENCE = { EndUser: 1, Admin: 2, SystemAdmin: 3 };

const ROLE_BADGE_VARIANT = {
  SystemAdmin: 'purple',
  Admin: 'blue',
  EndUser: 'default',
};

function hasRole(user, roleSet) {
  if (!user?.roles) return false;
  return user.roles.some((r) => roleSet.has(r));
}

function callerMaxPrecedence(user) {
  if (!user?.roles) return 0;
  return Math.max(...user.roles.map((r) => ROLE_PRECEDENCE[r] ?? 0), 0);
}

function assignableRoles(user) {
  const maxPrec = callerMaxPrecedence(user);
  return ALL_ROLES.filter((r) => (ROLE_PRECEDENCE[r] ?? 0) <= maxPrec);
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
    <Modal title="Add user" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <ModalBody className="space-y-4">
          {error && (
            <div className="rounded bg-danger-50 border border-danger-200 px-3 py-2 text-sm text-danger-700">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username <span className="text-danger-600">*</span>
            </label>
            <Input
              ref={firstInputRef}
              type="text"
              required
              maxLength={100}
              value={form.username}
              onChange={(e) => set('username', e.target.value)}
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="text-danger-600">*</span>
            </label>
            <Input
              type="email"
              required
              maxLength={255}
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              autoComplete="email"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password <span className="text-danger-600">*</span>
            </label>
            <Input
              type="password"
              required
              minLength={12}
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              autoComplete="new-password"
            />
            <p className="mt-1 text-xs text-gray-400">Minimum 12 characters</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <Select value={form.role} onChange={(e) => set('role', e.target.value)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
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
            {saving ? 'Adding…' : 'Add user'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
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
    <Modal title="Edit role" onClose={onClose} size="sm">
      <form onSubmit={handleSubmit}>
        <ModalBody className="space-y-4">
          {error && (
            <div className="rounded bg-danger-50 border border-danger-200 px-3 py-2 text-sm text-danger-700">
              {error}
            </div>
          )}
          <p className="text-sm text-gray-700">
            Changing role for <span className="font-semibold">{target.username}</span>
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
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
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
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
    <Modal title="Deactivate user" onClose={onClose}>
      <ModalBody>
        {error && (
          <div className="mb-3 rounded bg-danger-50 border border-danger-200 px-3 py-2 text-sm text-danger-700">
            {error}
          </div>
        )}
        <p className="text-sm text-gray-700">
          Are you sure you want to deactivate{' '}
          <span className="font-semibold">{target.username}</span>? They will no longer be able to
          sign in.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={deactivating}>
          Cancel
        </Button>
        <Button variant="danger" onClick={handleDeactivate} disabled={deactivating}>
          {deactivating ? 'Deactivating…' : 'Deactivate'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Reducer
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
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
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
              Add user
            </Button>
          )}
        </div>

        <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
          {state.loading && (
            <div className="py-16 text-center text-sm text-gray-400">Loading users…</div>
          )}
          {state.error && (
            <div className="py-16 text-center text-sm text-danger-600">
              Failed to load users: {state.error}
            </div>
          )}
          {!state.loading && !state.error && state.users.length === 0 && (
            <EmptyState message="No users found." />
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
                            <Badge key={r} variant={ROLE_BADGE_VARIANT[r] ?? 'default'}>
                              {r}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {u.is_active ? (
                        <Badge variant="green">Active</Badge>
                      ) : (
                        <Badge variant="default">Inactive</Badge>
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
                              className="text-sm text-brand-600 hover:text-brand-800 transition-colors"
                            >
                              Edit role
                            </button>
                          )}
                          {isSystemAdmin && u.is_active && !isSelf(u) && (
                            <button
                              onClick={() => setModal({ type: 'deactivate', target: u })}
                              className="text-sm text-danger-600 hover:text-danger-800 transition-colors"
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

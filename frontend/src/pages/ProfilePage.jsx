// src/pages/ProfilePage.jsx
import React, { useContext, useState } from 'react';
import { UserContext } from '../context/UserContext';

function authHeader() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function ProfilePage() {
  const user = useContext(UserContext);

  const [form, setForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setSuccess(false);
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (form.new_password !== form.confirm_password) {
      setError('New passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          current_password: form.current_password,
          new_password: form.new_password,
        }),
      });

      if (res.status === 204) {
        setSuccess(true);
        setForm({ current_password: '', new_password: '', confirm_password: '' });
        return;
      }

      const data = await res.json().catch(() => ({}));
      setError(data.detail ?? 'An error occurred.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900">Profile</h1>

      {/* User info card */}
      <div className="bg-white shadow rounded-lg divide-y divide-gray-100">
        <div className="px-6 py-4 flex justify-between items-center">
          <span className="text-sm font-medium text-gray-500">Username</span>
          <span className="text-sm text-gray-900">{user?.username ?? '—'}</span>
        </div>
        <div className="px-6 py-4 flex justify-between items-center">
          <span className="text-sm font-medium text-gray-500">Role</span>
          <span className="text-sm text-gray-900">
            {user?.roles?.length ? user.roles.join(', ') : '—'}
          </span>
        </div>
      </div>

      {/* Change password card */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Change password</h2>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && (
            <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
              Password changed successfully.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Current password <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              required
              value={form.current_password}
              onChange={(e) => set('current_password', e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="current-password"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              New password <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              required
              minLength={12}
              value={form.new_password}
              onChange={(e) => set('new_password', e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="new-password"
            />
            <p className="mt-1 text-xs text-gray-400">Minimum 12 characters</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm new password <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              required
              minLength={12}
              value={form.confirm_password}
              onChange={(e) => set('confirm_password', e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="new-password"
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

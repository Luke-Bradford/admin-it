// src/pages/SmtpSettingsPage.jsx
//
// Admin-only SMTP configuration page. Lets an admin configure outbound mail
// settings, set/replace the SMTP password, and send a test email.
//
// Role gating happens both here (UI) and on every backend route. The backend
// is the source of truth — this page assumes any failure to fetch is fatal.

import React, { useContext, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { UserContext } from '../context/UserContext';
import { authHeader } from '../utils/auth';

const ADMIN_ROLES = new Set(['Admin', 'SystemAdmin']);

function hasAdminRole(user) {
  if (!user?.roles) return false;
  return user.roles.some((r) => ADMIN_ROLES.has(r));
}

const EMPTY_FORM = {
  host: '',
  port: 587,
  tls_mode: 'starttls',
  username: '',
  from_address: '',
  from_name: '',
  reply_to_address: '',
  allowlist_enabled: false,
  allowed_domains: [],
  verify_ssl: true,
};

export default function SmtpSettingsPage() {
  const user = useContext(UserContext);
  const isAdmin = hasAdminRole(user);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [passwordSet, setPasswordSet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(null);

  const [passwordInput, setPasswordInput] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  const [domainDraft, setDomainDraft] = useState('');

  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testSending, setTestSending] = useState(false);

  useEffect(() => {
    // Wait until UserContext has populated. `user === null` means the
    // /auth/me lookup in App.jsx hasn't returned yet — don't redirect a
    // legitimate admin to /dashboard before their roles arrive.
    if (user === null) return;
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    fetch('/api/settings/smtp', { headers: authHeader() })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setForm({
          host: data.host ?? '',
          port: data.port ?? 587,
          tls_mode: data.tls_mode ?? 'starttls',
          username: data.username ?? '',
          from_address: data.from_address ?? '',
          from_name: data.from_name ?? '',
          reply_to_address: data.reply_to_address ?? '',
          allowlist_enabled: !!data.allowlist_enabled,
          allowed_domains: data.allowed_domains ?? [],
          verify_ssl: data.verify_ssl !== false,
        });
        setPasswordSet(!!data.password_set);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [isAdmin, user]);

  if (user === null) return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSavedMsg(null);
  }

  function addDomain() {
    const d = domainDraft.trim().toLowerCase();
    if (!d) {
      setDomainDraft('');
      return;
    }
    // Mirror the backend regex so the user gets immediate feedback rather
    // than a 422 from Pydantic at save time.
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) {
      setError(`Invalid domain: ${d}`);
      return;
    }
    if (form.allowed_domains.includes(d)) {
      setDomainDraft('');
      return;
    }
    setError(null);
    update('allowed_domains', [...form.allowed_domains, d]);
    setDomainDraft('');
  }

  function removeDomain(d) {
    update(
      'allowed_domains',
      form.allowed_domains.filter((x) => x !== d)
    );
  }

  async function handleSave(e) {
    e.preventDefault();
    setError(null);
    setSavedMsg(null);
    const portNum = Number(form.port);
    if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
      setError('Port must be a number between 1 and 65535.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        port: portNum,
        username: form.username || null,
        from_name: form.from_name || null,
        reply_to_address: form.reply_to_address || null,
      };
      const res = await fetch('/api/settings/smtp', {
        method: 'PUT',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ? JSON.stringify(body.detail) : `HTTP ${res.status}`);
      }
      const data = await res.json();
      setPasswordSet(!!data.password_set);
      setSavedMsg('Settings saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordSave() {
    if (!passwordInput) return;
    setPasswordSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/smtp/password', {
        method: 'PUT',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPasswordInput('');
      setPasswordSet(true);
      setSavedMsg('Password updated.');
    } catch (e) {
      setError(e.message);
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleSendTest() {
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/smtp/test', {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testTo }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTestResult({ ok: false, error: body.detail || `HTTP ${res.status}` });
      } else {
        setTestResult(body);
      }
    } catch (e) {
      setTestResult({ ok: false, error: e.message });
    } finally {
      setTestSending(false);
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading SMTP settings…</div>;

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-semibold mb-1">SMTP Settings</h1>
      <p className="text-sm text-gray-500 mb-6">
        Outbound email server used for scheduled query deliveries and test messages.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
          {error}
        </div>
      )}
      {savedMsg && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded">
          {savedMsg}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4 bg-white border rounded p-5">
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm">
            <span className="text-gray-700">Host</span>
            <input
              type="text"
              required
              value={form.host}
              onChange={(e) => update('host', e.target.value)}
              className="mt-1 w-full border rounded px-2 py-1.5"
              placeholder="smtp.example.com"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Port</span>
            <input
              type="number"
              required
              min={1}
              max={65535}
              value={form.port}
              onChange={(e) => update('port', e.target.value === '' ? '' : Number(e.target.value))}
              className="mt-1 w-full border rounded px-2 py-1.5"
            />
          </label>
        </div>

        <fieldset className="text-sm">
          <legend className="text-gray-700 mb-1">TLS mode</legend>
          <div className="flex gap-4">
            {['none', 'starttls', 'tls'].map((mode) => (
              <label key={mode} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="tls_mode"
                  value={mode}
                  checked={form.tls_mode === mode}
                  onChange={() => update('tls_mode', mode)}
                />
                {mode === 'none' ? 'None' : mode === 'starttls' ? 'STARTTLS' : 'TLS (SSL)'}
              </label>
            ))}
          </div>
        </fieldset>

        <label
          className={`flex items-start gap-2 text-sm ${form.tls_mode === 'none' ? 'opacity-50' : ''}`}
        >
          <input
            type="checkbox"
            checked={form.verify_ssl}
            disabled={form.tls_mode === 'none'}
            onChange={(e) => update('verify_ssl', e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-gray-700">
            Verify TLS certificate
            <span className="block text-xs text-gray-500">
              Disable only for self-signed internal SMTP relays. Disabling skips hostname and
              certificate validation entirely.
            </span>
          </span>
        </label>

        <label className="block text-sm">
          <span className="text-gray-700">Username (optional)</span>
          <input
            type="text"
            value={form.username}
            onChange={(e) => update('username', e.target.value)}
            className="mt-1 w-full border rounded px-2 py-1.5"
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm">
            <span className="text-gray-700">From address</span>
            <input
              type="email"
              required
              value={form.from_address}
              onChange={(e) => update('from_address', e.target.value)}
              className="mt-1 w-full border rounded px-2 py-1.5"
              placeholder="reports@example.com"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">From display name (optional)</span>
            <input
              type="text"
              value={form.from_name}
              onChange={(e) => update('from_name', e.target.value)}
              className="mt-1 w-full border rounded px-2 py-1.5"
              placeholder="admin-it Reports"
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="text-gray-700">Reply-To address (optional)</span>
          <input
            type="email"
            value={form.reply_to_address}
            onChange={(e) => update('reply_to_address', e.target.value)}
            className="mt-1 w-full border rounded px-2 py-1.5"
          />
        </label>

        <div className="border-t pt-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.allowlist_enabled}
              onChange={(e) => update('allowlist_enabled', e.target.checked)}
            />
            <span className="text-gray-700">Restrict outbound mail to allowed domains</span>
          </label>

          {form.allowlist_enabled && (
            <div className="mt-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={domainDraft}
                  onChange={(e) => setDomainDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addDomain();
                    }
                  }}
                  className="flex-1 border rounded px-2 py-1.5 text-sm"
                  placeholder="example.com"
                />
                <button
                  type="button"
                  onClick={addDomain}
                  className="px-3 py-1.5 bg-gray-200 text-sm rounded hover:bg-gray-300"
                >
                  Add
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {form.allowed_domains.map((d) => (
                  <span
                    key={d}
                    className="inline-flex items-center gap-1 bg-gray-100 border rounded px-2 py-0.5 text-xs"
                  >
                    {d}
                    <button
                      type="button"
                      onClick={() => removeDomain(d)}
                      className="text-gray-500 hover:text-red-600"
                      aria-label={`Remove ${d}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-500 border-l-2 border-gray-300 pl-3">
          If you&apos;re sending to recipients outside your organisation, ensure your DNS has SPF
          and DKIM records authorising this SMTP host to send as the From address, or recipients may
          filter messages as spam.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => setTestOpen(true)}
            className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
          >
            Send test email
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>

      <div className="mt-6 bg-white border rounded p-5">
        <h2 className="text-base font-semibold">SMTP password</h2>
        <p className="text-xs text-gray-500 mb-3">
          {passwordSet
            ? 'A password is currently set. Enter a new one to replace it.'
            : 'No password is set. Some servers require one for authentication.'}
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            className="flex-1 border rounded px-2 py-1.5 text-sm"
            placeholder="New password"
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={handlePasswordSave}
            disabled={passwordSaving || !passwordInput}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {passwordSaving ? 'Saving…' : 'Update password'}
          </button>
        </div>
        {passwordSet && (
          <span className="inline-block mt-2 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
            Password is set
          </span>
        )}
      </div>

      {testOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow-lg p-5 w-full max-w-md">
            <h3 className="text-base font-semibold mb-2">Send test email</h3>
            <p className="text-xs text-gray-500 mb-3">
              Sends a one-line test message using the currently saved settings (not the unsaved form
              values).
            </p>
            <input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              className="w-full border rounded px-2 py-1.5 text-sm"
              placeholder="recipient@example.com"
            />
            {testResult && (
              <div
                className={`mt-3 p-2 text-xs rounded ${
                  testResult.ok
                    ? 'bg-green-50 text-green-800 border border-green-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}
              >
                {testResult.ok ? 'Test email sent successfully.' : `Failed: ${testResult.error}`}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setTestOpen(false);
                  setTestResult(null);
                  setTestTo('');
                }}
                className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
              >
                Close
              </button>
              <button
                type="button"
                disabled={testSending || !testTo}
                onClick={handleSendTest}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {testSending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// src/pages/SetupPage.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Input, { Select } from '../components/ui/Input';
import { Spinner } from '../components/ui';

const ODBC_DRIVERS = ['ODBC Driver 17 for SQL Server', 'ODBC Driver 18 for SQL Server'];

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current, total }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <React.Fragment key={step}>
            {i > 0 && <div className={`h-px flex-1 ${done ? 'bg-brand-500' : 'bg-gray-200'}`} />}
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${
                done
                  ? 'bg-brand-600 text-white'
                  : active
                    ? 'bg-brand-600 text-white ring-4 ring-brand-100'
                    : 'bg-gray-100 text-gray-400'
              }`}
            >
              {done ? (
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                step
              )}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline feedback banner
// ---------------------------------------------------------------------------

function Feedback({ message, type }) {
  if (!message) return null;
  const styles =
    type === 'success'
      ? 'bg-success-50 border-success-200 text-success-700'
      : 'bg-danger-50 border-danger-200 text-danger-700';
  return <div className={`rounded border px-3 py-2 text-sm ${styles}`}>{message}</div>;
}

// ---------------------------------------------------------------------------
// Step 1 — Database connection
// ---------------------------------------------------------------------------

function StepConnection({ onSaved, initial }) {
  const [form, setForm] = useState(
    initial ?? {
      host: '',
      useLocalhostAlias: false,
      port: '1433',
      user: '',
      password: '',
      database: '',
      schema: 'adm',
      driver: ODBC_DRIVERS[0],
    }
  );
  const [availableDatabases, setAvailableDatabases] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setFeedback(null);
  }

  function buildPayload() {
    return {
      db_host: form.host,
      db_port: parseInt(form.port, 10) || 1433,
      db_user: form.user,
      db_password: form.password,
      db_name: form.database,
      schema: form.schema,
      odbc_driver: form.driver,
      use_localhost_alias: form.useLocalhostAlias,
    };
  }

  async function handleDiscover() {
    setDiscovering(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/discover/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: form.host,
          port: parseInt(form.port, 10) || 1433,
          user: form.user,
          password: form.password,
          driver: form.driver,
          use_localhost_alias: form.useLocalhostAlias,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? 'Failed to list databases.');
      setAvailableDatabases(body.databases ?? []);
      if ((body.databases ?? []).length === 0) {
        setFeedback({ type: 'error', message: 'No databases found. Check credentials and host.' });
      }
    } catch (e) {
      setFeedback({ type: 'error', message: e.message });
    } finally {
      setDiscovering(false);
    }
  }

  async function handleTest() {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/setup/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? body.message ?? 'Connection failed.');
      setFeedback({ type: 'success', message: body.message ?? 'Connection successful.' });
    } catch (e) {
      setFeedback({ type: 'error', message: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? body.message ?? 'Save failed.');
      onSaved(body.connection);
    } catch (e) {
      setFeedback({ type: 'error', message: e.message });
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <Feedback message={feedback?.message} type={feedback?.type} />

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Host <span className="text-danger-600">*</span>
          </label>
          <Input
            type="text"
            required
            value={form.host}
            onChange={(e) => set('host', e.target.value)}
            placeholder="e.g. 192.168.1.10 or sqlserver"
            autoFocus
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
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
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            checked={form.useLocalhostAlias}
            onChange={(e) => set('useLocalhostAlias', e.target.checked)}
          />
          <span>
            Resolve <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">localhost</code> as
            Docker host alias
          </span>
        </label>
        <p className="mt-1 text-xs text-gray-400 ml-6">
          Enable this when SQL Server is running in Docker and accessible via the host alias.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Username <span className="text-danger-600">*</span>
          </label>
          <Input
            type="text"
            required
            value={form.user}
            onChange={(e) => set('user', e.target.value)}
            placeholder="SQL login"
            autoComplete="username"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Password <span className="text-danger-600">*</span>
          </label>
          <Input
            type="password"
            required
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            autoComplete="current-password"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Database <span className="text-danger-600">*</span>
        </label>
        <div className="flex gap-2">
          <Select
            value={form.database}
            onChange={(e) => set('database', e.target.value)}
            className="flex-1"
          >
            <option value="">Select a database…</option>
            {availableDatabases.map((db) => (
              <option key={db} value={db}>
                {db}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleDiscover}
            disabled={discovering || loading}
          >
            {discovering ? <Spinner className="w-4 h-4" /> : 'Discover'}
          </Button>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          Fill in host and credentials first, then click Discover to list available databases.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Schema name</label>
          <Input type="text" value={form.schema} onChange={(e) => set('schema', e.target.value)} />
          <p className="mt-1 text-xs text-gray-400">
            The SQL schema where AdminIT tables are deployed. Default:{' '}
            <code className="bg-gray-100 px-1 rounded">adm</code>
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">ODBC driver</label>
          <Select value={form.driver} onChange={(e) => set('driver', e.target.value)}>
            {ODBC_DRIVERS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={handleTest} disabled={loading}>
          {loading ? <Spinner className="w-4 h-4" /> : 'Test connection'}
        </Button>
        <Button type="button" onClick={handleSave} disabled={loading}>
          Save &amp; continue
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Schema deployment
// ---------------------------------------------------------------------------

function StepDeploy({ onDeployed }) {
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleDeploy() {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/setup/deploy-schema', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? 'Deployment failed.');
      setFeedback({ type: 'success', message: body.message ?? 'Schema deployed successfully.' });
      onDeployed();
    } catch (e) {
      setFeedback({ type: 'error', message: e.message });
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600">
        AdminIT needs to deploy its core schema into the configured database. This creates the
        tables, views, and stored procedures required for the application to function. The operation
        is idempotent — running it on an existing install is safe.
      </p>

      <Feedback message={feedback?.message} type={feedback?.type} />

      <div className="flex justify-end pt-2">
        <Button type="button" onClick={handleDeploy} disabled={loading}>
          {loading ? (
            <span className="flex items-center gap-2">
              <Spinner className="w-4 h-4" /> Deploying…
            </span>
          ) : (
            'Deploy schema'
          )}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Create admin user
// ---------------------------------------------------------------------------

function StepCreateAdmin({ onCreated }) {
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' });
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(false);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setFeedback(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setFeedback({ type: 'error', message: 'Passwords do not match.' });
      return;
    }
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/setup/create-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.username,
          email: form.email,
          password: form.password,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? body.message ?? 'Failed to create admin.');
      onCreated();
    } catch (e) {
      setFeedback({ type: 'error', message: e.message });
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Feedback message={feedback?.message} type={feedback?.type} />

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Username <span className="text-danger-600">*</span>
        </label>
        <Input
          type="text"
          required
          maxLength={100}
          value={form.username}
          onChange={(e) => set('username', e.target.value)}
          autoComplete="username"
          autoFocus
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

      <div className="grid grid-cols-2 gap-4">
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
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Confirm password <span className="text-danger-600">*</span>
          </label>
          <Input
            type="password"
            required
            minLength={12}
            value={form.confirm}
            onChange={(e) => set('confirm', e.target.value)}
            autoComplete="new-password"
          />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={loading}>
          {loading ? 'Creating…' : 'Create admin user'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const STEPS = [
  { label: 'Database connection' },
  { label: 'Schema deployment' },
  { label: 'Admin user' },
];

export default function SetupPage() {
  const navigate = useNavigate();

  // null = still loading, number = current step (1-based)
  const [step, setStep] = useState(null);
  // Saved connection data — populated after step 1 completes
  const [savedConnection, setSavedConnection] = useState(null);

  const redirectToLogin = useCallback(() => navigate('/login', { replace: true }), [navigate]);
  const redirectToDashboard = useCallback(
    () => navigate('/dashboard', { replace: true }),
    [navigate]
  );

  useEffect(() => {
    // Determine which step to start on based on server state.
    async function determineStep() {
      try {
        const setupRes = await fetch('/api/setup');
        const setup = await setupRes.json();

        if (!setup.configured) {
          setStep(1);
          return;
        }

        // Configured — requires SystemAdmin token to proceed.
        const token = localStorage.getItem('token');
        if (!token) {
          redirectToLogin();
          return;
        }

        try {
          const parts = token.split('.');
          if (parts.length < 3) throw new Error();
          const payload = JSON.parse(atob(parts[1]));
          if (!payload.roles?.includes('SystemAdmin')) {
            redirectToDashboard();
            return;
          }
        } catch {
          redirectToLogin();
          return;
        }

        // Restore connection form state from saved config.
        const conn = setup.connection;
        setSavedConnection(conn);

        // Check schema and admin status.
        const [deployRes, adminRes] = await Promise.all([
          fetch('/api/setup/deploy-status').then((r) => r.json()),
          fetch('/api/setup/admin-status').then((r) => r.json()),
        ]);

        if (!deployRes.deployed) {
          setStep(2);
        } else if (!adminRes.present) {
          setStep(3);
        } else {
          // Fully configured — send to dashboard.
          redirectToDashboard();
        }
      } catch {
        // If the setup check itself fails, show step 1 so the user can try.
        setStep(1);
      }
    }

    determineStep();
  }, [redirectToLogin, redirectToDashboard]);

  function handleConnectionSaved(conn) {
    setSavedConnection(conn);
    setStep(2);
  }

  function handleDeployed() {
    setStep(3);
  }

  function handleAdminCreated() {
    setStep(4); // past the last step — show completion screen
  }

  // Loading state
  if (step === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  const isComplete = step > STEPS.length;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center py-12 px-4">
      {/* Wordmark */}
      <div className="mb-8 text-center">
        <span className="text-2xl font-bold text-brand-600 tracking-tight">AdminIT</span>
        <p className="mt-1 text-sm text-gray-500">First-time setup</p>
      </div>

      <div className="w-full max-w-xl">
        {!isComplete && (
          <>
            {/* Step indicator */}
            <div className="mb-6">
              <StepIndicator current={step} total={STEPS.length} />
              <div className="mt-3 flex justify-between">
                {STEPS.map((s, i) => (
                  <span
                    key={s.label}
                    className={`text-xs ${
                      i + 1 === step
                        ? 'text-brand-600 font-medium'
                        : i + 1 < step
                          ? 'text-gray-400'
                          : 'text-gray-300'
                    }`}
                    style={{
                      width: `${100 / STEPS.length}%`,
                      textAlign: i === 0 ? 'left' : i === STEPS.length - 1 ? 'right' : 'center',
                    }}
                  >
                    {s.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Step card */}
            <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-5">
                Step {step} of {STEPS.length} — {STEPS[step - 1].label}
              </h2>

              {step === 1 && (
                <StepConnection
                  onSaved={handleConnectionSaved}
                  initial={
                    savedConnection
                      ? {
                          host: savedConnection.db_host,
                          useLocalhostAlias: false,
                          port: String(savedConnection.db_port),
                          user: savedConnection.db_user,
                          password: '',
                          database: savedConnection.db_name,
                          schema: savedConnection.schema,
                          driver: savedConnection.odbc_driver,
                        }
                      : null
                  }
                />
              )}
              {step === 2 && <StepDeploy onDeployed={handleDeployed} />}
              {step === 3 && <StepCreateAdmin onCreated={handleAdminCreated} />}
            </div>
          </>
        )}

        {isComplete && (
          <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-success-100 flex items-center justify-center mx-auto">
              <svg
                className="w-6 h-6 text-success-600"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Setup complete</h2>
            <p className="text-sm text-gray-500">
              AdminIT is configured and ready to use. Sign in with the admin account you just
              created.
            </p>
            <Button onClick={() => navigate('/login')}>Go to sign in</Button>
          </div>
        )}
      </div>
    </div>
  );
}

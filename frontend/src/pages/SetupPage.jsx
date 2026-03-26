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

const DEFAULT_MSSQL_FORM = {
  dbType: 'mssql',
  pgMode: null,
  host: '',
  useLocalhostAlias: false,
  port: '1433',
  user: '',
  password: '',
  database: '',
  schema: 'adm',
  driver: ODBC_DRIVERS[0],
};

const DEFAULT_PG_FORM = {
  dbType: 'postgres',
  pgMode: 'existing', // 'existing' | 'create'
  host: '',
  useLocalhostAlias: false,
  port: '5432',
  user: '',
  password: '',
  database: '',
  schema: 'adm',
  // create-new fields
  superuser: '',
  superuserPassword: '',
  newDatabase: '',
  appUser: 'adminit_app',
  appUserPassword: '',
};

function initialFormFromConnection(conn) {
  if (!conn) return DEFAULT_MSSQL_FORM;
  if (conn.db_type === 'postgres') {
    return {
      ...DEFAULT_PG_FORM,
      host: conn.db_host ?? '',
      useLocalhostAlias: conn.use_localhost_alias ?? false,
      port: String(conn.db_port ?? 5432),
      user: conn.db_user ?? '',
      password: '',
      database: conn.db_name ?? '',
      schema: conn.schema ?? 'adm',
    };
  }
  return {
    ...DEFAULT_MSSQL_FORM,
    host: conn.db_host ?? '',
    useLocalhostAlias: conn.use_localhost_alias ?? false,
    port: String(conn.db_port ?? 1433),
    user: conn.db_user ?? '',
    password: '',
    database: conn.db_name ?? '',
    schema: conn.schema ?? 'adm',
    driver: conn.odbc_driver ?? ODBC_DRIVERS[0],
  };
}

function StepConnection({ onSaved, initial }) {
  const [form, setForm] = useState(initial ?? DEFAULT_MSSQL_FORM);
  const [availableDatabases, setAvailableDatabases] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setFeedback(null);
  }

  function handleDbTypeChange(newType) {
    setFeedback(null);
    setAvailableDatabases([]);
    if (newType === 'postgres') {
      setForm({ ...DEFAULT_PG_FORM });
    } else {
      setForm({ ...DEFAULT_MSSQL_FORM });
    }
  }

  function buildTestPayload() {
    const base = {
      db_type: form.dbType,
      db_host: form.host,
      db_port: parseInt(form.port, 10) || (form.dbType === 'postgres' ? 5432 : 1433),
      db_user: form.user,
      db_password: form.password,
      db_name: form.database,
      schema: form.schema,
      use_localhost_alias: form.useLocalhostAlias,
    };
    if (form.dbType === 'mssql') {
      base.odbc_driver = form.driver;
    }
    return base;
  }

  function buildCreateDbPayload() {
    return {
      db_host: form.host,
      db_port: parseInt(form.port, 10) || 5432,
      superuser: form.superuser,
      superuser_password: form.superuserPassword,
      new_db_name: form.newDatabase,
      app_user: form.appUser,
      app_user_password: form.appUserPassword,
      schema: form.schema,
      use_localhost_alias: form.useLocalhostAlias,
    };
  }

  // Only called from the Discover button, which is only rendered in !isCreateMode.
  // form.user / form.password are therefore always populated when this runs.
  function buildDiscoverPayload() {
    const payload = {
      db_type: form.dbType,
      host: form.host,
      port: parseInt(form.port, 10) || (form.dbType === 'postgres' ? 5432 : 1433),
      user: form.user,
      password: form.password,
      use_localhost_alias: form.useLocalhostAlias,
    };
    if (form.dbType === 'mssql') {
      payload.driver = form.driver ?? ODBC_DRIVERS[0];
    }
    return payload;
  }

  async function handleDiscover() {
    setDiscovering(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/discover/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildDiscoverPayload()),
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
        body: JSON.stringify(buildTestPayload()),
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

  async function handleSaveExisting() {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildTestPayload()),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? body.message ?? 'Save failed.');
      onSaved(body.connection);
    } catch (e) {
      setFeedback({ type: 'error', message: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateAndSave() {
    if (!form.superuser) {
      setFeedback({ type: 'error', message: 'Superuser username is required.' });
      return;
    }
    if (!form.superuserPassword) {
      setFeedback({ type: 'error', message: 'Superuser password is required.' });
      return;
    }
    if (!form.newDatabase) {
      setFeedback({ type: 'error', message: 'New database name is required.' });
      return;
    }
    if (!form.appUser) {
      setFeedback({ type: 'error', message: 'App username is required.' });
      return;
    }
    if (!form.appUserPassword) {
      setFeedback({ type: 'error', message: 'App user password is required.' });
      return;
    }
    setLoading(true);
    setFeedback(null);
    try {
      // Step 1: create the database and app user.
      const createRes = await fetch('/api/setup/create-postgres-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildCreateDbPayload()),
      });
      const createBody = await createRes.json();
      if (!createRes.ok) throw new Error(createBody.detail ?? 'Failed to create database.');

      // Step 2: save the app-user connection as the core config.
      // Use the connection object returned by the backend (canonical form) rather
      // than re-assembling from form state, so any server-side normalisation is
      // preserved. The app-user password must be appended as it is not echoed back.
      const connDetails = { ...createBody.connection, db_password: form.appUserPassword };
      const saveRes = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connDetails),
      });
      const saveBody = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveBody.detail ?? saveBody.message ?? 'Save failed.');
      onSaved(saveBody.connection);
    } catch (e) {
      setFeedback({ type: 'error', message: e.message });
    } finally {
      setLoading(false);
    }
  }

  const isPostgres = form.dbType === 'postgres';
  const isCreateMode = isPostgres && form.pgMode === 'create';

  return (
    <div className="space-y-5">
      {/* Database type selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Database type</label>
        <div className="flex gap-3">
          {[
            { value: 'mssql', label: 'SQL Server' },
            { value: 'postgres', label: 'PostgreSQL' },
          ].map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => handleDbTypeChange(value)}
              className={`flex-1 rounded-md border px-4 py-2.5 text-sm font-medium transition-colors ${
                form.dbType === value
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* PostgreSQL mode selector (existing vs create new) */}
      {isPostgres && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Setup mode</label>
          <div className="flex gap-3">
            {[
              { value: 'existing', label: 'Connect to existing database' },
              { value: 'create', label: 'Create new database' },
            ].map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => set('pgMode', value)}
                className={`flex-1 rounded-md border px-4 py-2.5 text-sm font-medium transition-colors ${
                  form.pgMode === value
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {isCreateMode && (
            <p className="mt-2 text-xs text-gray-400">
              AdminIT will create the database and a restricted app user. Superuser credentials are
              not stored after setup completes.
            </p>
          )}
        </div>
      )}

      <Feedback message={feedback?.message} type={feedback?.type} />

      {/* Host / Port */}
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
            placeholder={
              isPostgres ? 'e.g. 192.168.1.10 or pg-host' : 'e.g. 192.168.1.10 or sqlserver'
            }
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

      {/* Docker localhost alias */}
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
          Enable this when the database is running in Docker and accessible via the host alias.
        </p>
      </div>

      {/* Existing-DB credentials (both modes show these, but create-mode uses them as superuser) */}
      {isCreateMode ? (
        /* Create-new mode: superuser credentials + new database details */
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Superuser <span className="text-danger-600">*</span>
              </label>
              <Input
                type="text"
                required
                value={form.superuser}
                onChange={(e) => set('superuser', e.target.value)}
                placeholder="postgres"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Superuser password <span className="text-danger-600">*</span>
              </label>
              <Input
                type="password"
                required
                value={form.superuserPassword}
                onChange={(e) => set('superuserPassword', e.target.value)}
                autoComplete="current-password"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                New database name <span className="text-danger-600">*</span>
              </label>
              <Input
                type="text"
                required
                value={form.newDatabase}
                onChange={(e) => set('newDatabase', e.target.value)}
                placeholder="adminit"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Schema name</label>
              <Input
                type="text"
                value={form.schema}
                onChange={(e) => set('schema', e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-400">
                Default: <code className="bg-gray-100 px-1 rounded">adm</code>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                App username <span className="text-danger-600">*</span>
              </label>
              <Input
                type="text"
                required
                value={form.appUser}
                onChange={(e) => set('appUser', e.target.value)}
                placeholder="adminit_app"
              />
              <p className="mt-1 text-xs text-gray-400">
                A restricted database user created for AdminIT.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                App user password <span className="text-danger-600">*</span>
              </label>
              <Input
                type="password"
                required
                value={form.appUserPassword}
                onChange={(e) => set('appUserPassword', e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
        </>
      ) : (
        /* Existing-DB mode: normal credentials */
        <>
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
                placeholder={isPostgres ? 'Database user' : 'SQL login'}
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
              <Input
                type="text"
                required
                value={form.database}
                onChange={(e) => set('database', e.target.value)}
                placeholder="Type a name or use Discover"
                list="db-list"
                className="flex-1"
              />
              <datalist id="db-list">
                {availableDatabases.map((db) => (
                  <option key={db} value={db} />
                ))}
              </datalist>
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
              Type the database name directly, or fill in host and credentials then click Discover.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Schema name</label>
              <Input
                type="text"
                value={form.schema}
                onChange={(e) => set('schema', e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-400">
                The SQL schema where AdminIT tables are deployed. Default:{' '}
                <code className="bg-gray-100 px-1 rounded">adm</code>
              </p>
            </div>
            {!isPostgres && (
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
            )}
          </div>
        </>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        {!isCreateMode && (
          <Button type="button" variant="secondary" onClick={handleTest} disabled={loading}>
            {loading ? <Spinner className="w-4 h-4" /> : 'Test connection'}
          </Button>
        )}
        <Button
          type="button"
          onClick={isCreateMode ? handleCreateAndSave : handleSaveExisting}
          disabled={loading}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <Spinner className="w-4 h-4" />
              {isCreateMode ? 'Creating…' : 'Saving…'}
            </span>
          ) : isCreateMode ? (
            'Create database & continue'
          ) : (
            'Save & continue'
          )}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Schema deployment (with existing-install detection)
// ---------------------------------------------------------------------------

function StepDeploy({ onDeployed, onConnectExisting }) {
  // null = checking, true = already deployed, false = not deployed
  const [existingInstall, setExistingInstall] = useState(null);
  // 'idle' | 'confirm' — confirm state shows the re-deploy warning
  const [redeployMode, setRedeployMode] = useState('idle');
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(false);

  // On mount, detect whether the schema is already deployed.
  useEffect(() => {
    async function detect() {
      try {
        const res = await fetch('/api/setup/deploy-status');
        const body = await res.json();
        setExistingInstall(body.deployed === true);
      } catch {
        // If detection fails, fall through to normal deploy flow.
        setExistingInstall(false);
      }
    }
    detect();
  }, []);

  async function handleDeploy(force = false) {
    setLoading(true);
    setFeedback(null);
    try {
      const url = force ? '/api/setup/deploy-schema?force=true' : '/api/setup/deploy-schema';
      const res = await fetch(url, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? 'Deployment failed.');
      setFeedback({ type: 'success', message: body.message ?? 'Schema deployed successfully.' });
      onDeployed();
    } catch (e) {
      setFeedback({ type: 'error', message: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleConnectExisting() {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/setup/admin-status');
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? 'Failed to check admin status.');
      onConnectExisting(body.present === true);
    } catch (e) {
      setFeedback({ type: 'error', message: e.message });
      setLoading(false);
    }
  }

  // Still checking deploy status
  if (existingInstall === null) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="w-6 h-6" />
      </div>
    );
  }

  // Existing install detected
  if (existingInstall) {
    return (
      <div className="space-y-5">
        <div className="rounded-md border border-warning-200 bg-warning-50 px-4 py-3">
          <p className="text-sm font-medium text-warning-800">Existing install detected</p>
          <p className="mt-1 text-sm text-warning-700">
            AdminIT schema objects were found in this database. You can connect to the existing
            install, or re-deploy the schema (for disaster recovery only).
          </p>
        </div>

        <Feedback message={feedback?.message} type={feedback?.type} />

        {redeployMode === 'confirm' && (
          <div className="rounded-md border border-danger-200 bg-danger-50 px-4 py-3">
            <p className="text-sm font-medium text-danger-800">Warning — re-deployment</p>
            <p className="mt-1 text-sm text-danger-700">
              Re-deploying the schema may affect existing data. Only proceed if you are recovering
              from a corrupted or incomplete install.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          <div className="flex gap-2">
            {redeployMode === 'idle' ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRedeployMode('confirm')}
                disabled={loading}
              >
                Re-deploy schema
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setRedeployMode('idle')}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => handleDeploy(true)}
                  disabled={loading}
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <Spinner className="w-4 h-4" /> Deploying…
                    </span>
                  ) : (
                    'Confirm re-deploy'
                  )}
                </Button>
              </>
            )}
          </div>
          <Button type="button" onClick={handleConnectExisting} disabled={loading}>
            {loading ? (
              <span className="flex items-center gap-2">
                <Spinner className="w-4 h-4" /> Connecting…
              </span>
            ) : (
              'Connect to existing install'
            )}
          </Button>
        </div>
      </div>
    );
  }

  // Fresh install — normal deploy flow
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600">
        AdminIT needs to deploy its core schema into the configured database. This creates the
        tables, views, and stored procedures required for the application to function. The operation
        is idempotent — running it on an existing install is safe.
      </p>

      <Feedback message={feedback?.message} type={feedback?.type} />

      <div className="flex justify-end pt-2">
        <Button type="button" onClick={() => handleDeploy(false)} disabled={loading}>
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
    } finally {
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

// Sentinel value indicating all steps are complete.
const COMPLETE_STEP = STEPS.length + 1;

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

        // Check schema deploy status first; only check admin-status if deployed.
        const deployRes = await fetch('/api/setup/deploy-status').then((r) => r.json());

        if (!deployRes.deployed) {
          setStep(2);
          return;
        }

        const adminRes = await fetch('/api/setup/admin-status').then((r) => r.json());

        if (!adminRes.present) {
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

  // Called by StepDeploy when the user chooses "Connect to existing install".
  // hasAdmin: whether a SystemAdmin user already exists in the detected schema.
  function handleConnectExisting(hasAdmin) {
    if (hasAdmin) {
      setStep(COMPLETE_STEP);
    } else {
      setStep(3);
    }
  }

  function handleAdminCreated() {
    setStep(COMPLETE_STEP);
  }

  // Loading state
  if (step === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  const isComplete = step === COMPLETE_STEP;

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
                  initial={initialFormFromConnection(savedConnection)}
                />
              )}
              {step === 2 && (
                <StepDeploy onDeployed={handleDeployed} onConnectExisting={handleConnectExisting} />
              )}
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

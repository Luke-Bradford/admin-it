import React, { useState, useEffect } from 'react';
import './SetupPage.css';

export default function SetupPage() {
  // ─────────────────────────────────────────────────────────────
  // State
  const [host, setHost] = useState('');
  const [useLocalhostAlias, setUseLocalhostAlias] = useState(false);
  const [port, setPort] = useState(1433);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState('');
  const [availableDatabases, setAvailableDatabases] = useState([]);
  const [schema, setSchema] = useState('adm');
  const [driver, setDriver] = useState('ODBC Driver 17 for SQL Server');

  const [configured, setConfigured] = useState(false);
  const [editing, setEditing] = useState(false);
  const [connection, setConnection] = useState(null);

  const [schemaDeployed, setSchemaDeployed] = useState(false);
  const [adminCreated, setAdminCreated] = useState(false);

  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState('');
  const [loading, setLoading] = useState(false);

  const [adminUsername, setAdminUsername] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  // ─────────────────────────────────────────────────────────────
  // Fetch existing setup on mount
  useEffect(() => {
    fetch('/api/setup')
      .then(r => r.json())
      .then(data => {
        if (data.configured) {
          setConfigured(true);
          setConnection(data.connection);
          const d = data.connection;
          setHost(d.db_host);
          setPort(d.db_port);
          setUser(d.db_user);
          setPassword('');
          setDatabase(d.db_name);
          setSchema(d.schema);
          setDriver(d.odbc_driver);
          checkDeployStatus();
        }
      })
      .catch(() => { });
  }, []);

  function checkDeployStatus() {
    fetch('/api/setup/deploy-status')
      .then(r => r.json())
      .then(d => {
        setSchemaDeployed(d.deployed);
        if (d.deployed) checkAdminStatus();
      })
      .catch(() => setSchemaDeployed(false));
  }

  function checkAdminStatus() {
    fetch('/api/setup/admin-status')
      .then(r => r.json())
      .then(d => setAdminCreated(d.present))
      .catch(() => setAdminCreated(false));
  }

  // ─────────────────────────────────────────────────────────────
  // Handlers for editing DB connection
  function handleEdit() {
    setEditing(true);
  }
  function handleCancelEdit() {
    setEditing(false);
    if (connection) {
      const d = connection;
      setHost(d.db_host);
      setPort(d.db_port);
      setUser(d.db_user);
      setPassword('');
      setDatabase(d.db_name);
      setSchema(d.schema);
      setDriver(d.odbc_driver);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Discover databases dropdown
  async function fetchDatabases() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/discover/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port,
          user,
          password,
          driver,
          use_localhost_alias: useLocalhostAlias
        })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || 'Error fetching databases');
      setAvailableDatabases(body.databases);
    } catch (e) {
      alert(`Failed to list databases:\n${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Test & save connection
  async function handleTestConnection() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/setup/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          db_host: host,
          db_port: port,
          db_user: user,
          db_password: password,
          db_name: database,
          schema,
          odbc_driver: driver,
          use_localhost_alias: useLocalhostAlias
        })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || body.message);
      setMessage(body.message);
      setMessageType('success');
    } catch (e) {
      setMessage(e.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          db_host: host,
          db_port: port,
          db_user: user,
          db_password: password,
          db_name: database,
          schema,
          odbc_driver: driver,
          use_localhost_alias: useLocalhostAlias
        })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || body.message);

      setConfigured(true);
      setConnection(body.connection);
      setMessage(body.message);
      setMessageType('success');
      setEditing(false);
      checkDeployStatus();
    } catch (e) {
      setMessage(e.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Deploy schema
  async function deploySchema() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/setup/deploy-schema', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || 'Deployment failed');
      setSchemaDeployed(true);
      setMessage(body.message);
      setMessageType('success');
      checkAdminStatus();
    } catch (e) {
      setMessage(e.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Create admin user
  async function handleCreateAdmin() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/setup/create-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: adminUsername,
          email: adminEmail,
          password: adminPassword
        })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || body.message);
      setAdminCreated(true);
      setMessage(body.message);
      setMessageType('success');
    } catch (e) {
      setMessage(e.message);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Render
  return (
    <div className="setup-container">
      <h1 className="setup-title">Core Database Setup</h1>
      {message && (
        <div className={`message ${messageType}`}>{message}</div>
      )}

      {/* ────────────── The single flex row ────────────── */}
      <div className="cards-row">
        {/* 1) Connection */}
        <div className="card">
          <h2>Database Connection</h2>
          <div className="form-grid">
            {/* Host */}
            <label className="form-label">Host</label>
            {(editing || !configured)
              ? <input className="form-input" value={host} onChange={e => setHost(e.target.value)} />
              : <div className="form-value">{host}</div>}

            {/* Localhost Alias */}
            <label className="form-label">Use Localhost Alias</label>
            {(editing || !configured)
              ? (
                <div className="checkbox-row">
                  <input type="checkbox"
                    checked={useLocalhostAlias}
                    onChange={e => setUseLocalhostAlias(e.target.checked)} />
                  <span>localhost → docker</span>
                </div>
              )
              : <div className="form-value">{useLocalhostAlias ? 'Yes' : 'No'}</div>}

            {/* Port */}
            <label className="form-label">Port</label>
            {(editing || !configured)
              ? <input className="form-input" value={port} onChange={e => setPort(+e.target.value)} />
              : <div className="form-value">{port}</div>}

            {/* User */}
            <label className="form-label">User</label>
            {(editing || !configured)
              ? <input className="form-input" value={user} onChange={e => setUser(e.target.value)} />
              : <div className="form-value">{user}</div>}

            {/* Password */}
            <label className="form-label">Password</label>
            {(editing || !configured)
              ? <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} />
              : <div className="form-value">********</div>}

            {/* Database picker */}
            <label className="form-label">Database</label>
            {(editing || !configured)
              ? (
                <div className="database-picker">
                  <select className="form-select"
                    value={database}
                    onChange={e => setDatabase(e.target.value)}>
                    <option value="">-- Select Database --</option>
                    {availableDatabases.map(db => (
                      <option key={db} value={db}>{db}</option>
                    ))}
                  </select>
                  <button onClick={fetchDatabases} disabled={loading}>🔍</button>
                </div>
              )
              : <div className="form-value">{database}</div>}

            {/* Schema */}
            <label className="form-label">Schema</label>
            {(editing || !configured)
              ? <input className="form-input" value={schema} onChange={e => setSchema(e.target.value)} />
              : <div className="form-value">{schema}</div>}

            {/* Driver */}
            <label className="form-label">Driver</label>
            {(editing || !configured)
              ? (
                <select className="form-select"
                  value={driver}
                  onChange={e => setDriver(e.target.value)}>
                  <option>ODBC Driver 17 for SQL Server</option>
                  <option>ODBC Driver 18 for SQL Server</option>
                </select>
              )
              : <div className="form-value">{driver}</div>}
          </div>

          <div className="button-row">
            {(editing || !configured)
              ? (
                <>
                  <button onClick={handleTestConnection} disabled={loading}>Test</button>
                  <button onClick={handleSubmit} disabled={loading}>Submit</button>
                  {configured && (
                    <button onClick={handleCancelEdit} disabled={loading}>Cancel</button>
                  )}
                </>
              )
              : <button onClick={handleEdit}>Edit</button>}
          </div>
        </div>

        {/* 2) Schema Deployment */}
        {configured && (
          <div className="card">
            <h2>Schema Deployment</h2>
            {schemaDeployed ? (
              <p className="success-text">Schema is already deployed.</p>
            ) : (
              <>
                <p>The core schema has not been deployed yet.</p>
                <button onClick={deploySchema} disabled={loading}>
                  Deploy Schema
                </button>
              </>
            )}
          </div>
        )}

        {/* 3) Create Admin User */}
        {configured && schemaDeployed && (
          <div className="card">
            <h2>Create Admin User</h2>
            {!adminCreated ? (
              <>
                <div className="form-grid">
                  <label className="form-label">Username</label>
                  <input
                    className="form-input"
                    value={adminUsername}
                    onChange={e => setAdminUsername(e.target.value)}
                  />

                  <label className="form-label">Email</label>
                  <input
                    className="form-input"
                    value={adminEmail}
                    onChange={e => setAdminEmail(e.target.value)}
                  />

                  <label className="form-label">Password</label>
                  <input
                    className="form-input"
                    type="password"
                    value={adminPassword}
                    onChange={e => setAdminPassword(e.target.value)}
                  />
                </div>

                <div className="button-row">
                  <button onClick={handleCreateAdmin} disabled={loading}>
                    Create Admin
                  </button>
                </div>
              </>
            ) : (
              <p className="success-text">SystemAdmin user already exists.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

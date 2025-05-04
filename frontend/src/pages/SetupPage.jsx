import React, { useState, useEffect } from "react";
import "./SetupPage.css";

export default function SetupPage() {
  // form fields
  const [host, setHost] = useState("");
  const [port, setPort] = useState(1433);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
  const [schema, setSchema] = useState("adm");
  const [driver, setDriver] = useState("ODBC Driver 17 for SQL Server");

  // status
  const [configured, setConfigured] = useState(false);
  const [connection, setConnection] = useState(null);
  const [missing, setMissing] = useState({
    tables: [],
    views: [],
    procedures: [],
    functions: []
  });
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState(""); // "error" or "success"
  const [loading, setLoading] = useState(false);

  // load initial config
  useEffect(() => {
    fetch("/api/setup")
      .then((r) => r.json())
      .then((data) => {
        if (data.configured) {
          setConfigured(true);
          setConnection(data.connection);
          // prefill form in case of edit
          const d = data.connection;
          setHost(d.db_host);
          setPort(d.db_port);
          setUser(d.db_user);
          setPassword("");
          setDatabase(d.db_name);
          setSchema(d.schema);
          setDriver(d.odbc_driver);
          refreshSchemaStatus();
        }
      })
      .catch((e) => console.error("Could not load setup:", e));
  }, []);

  // fetch schema-status
  function refreshSchemaStatus() {
    fetch("/api/schema-status")
      .then((r) => {
        if (!r.ok) throw new Error(`Status ${r.status}`);
        return r.json();
      })
      .then((data) => setMissing(data.missing))
      .catch((e) => {
        console.error("schema-status error:", e);
        setMissing({ tables: [], views: [], procedures: [], functions: [] });
      });
  }

  // test connection
  function handleTest() {
    setLoading(true);
    setMessage(null);
    fetch("/api/test-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        db_host: host,
        db_port: port,
        db_user: user,
        db_password: password,
        db_name: database,
        schema,
        odbc_driver: driver,
      }),
    })
      .then(async (r) => {
        setLoading(false);
        const body = await r.json();
        if (!r.ok) throw new Error(body.detail || body.message);
        setMessage(body.message);
        setMessageType("success");
      })
      .catch((e) => {
        setLoading(false);
        setMessage(e.message);
        setMessageType("error");
      });
  }

  // submit setup
  function handleSubmit() {
    setLoading(true);
    setMessage(null);
    fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        db_host: host,
        db_port: port,
        db_user: user,
        db_password: password,
        db_name: database,
        schema,
        odbc_driver: driver,
      }),
    })
      .then(async (r) => {
        setLoading(false);
        const body = await r.json();
        if (!r.ok) throw new Error(body.detail || body.message);
        setConfigured(true);
        setConnection(body.connection);
        setMessage(body.message);
        setMessageType("success");
        refreshSchemaStatus();
      })
      .catch((e) => {
        setLoading(false);
        setMessage(e.message);
        setMessageType("error");
      });
  }

  // delete config
  function handleDelete() {
    fetch("/api/setup", { method: "DELETE" })
      .then((r) => r.json())
      .then(() => {
        setConfigured(false);
        setConnection(null);
        setMissing({ tables: [], views: [], procedures: [], functions: [] });
        setMessage("Configuration deleted.");
        setMessageType("success");
      })
      .catch((e) => {
        console.error("delete error:", e);
        setMessage("Could not delete config");
        setMessageType("error");
      });
  }

  // deploy missing objects
  async function handleDeploy() {
    setLoading(true);
    try {
      const res = await fetch("/api/deploy", { method: "POST" });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }

      setMessage("Deployed missing objects.");
      setMessageType("success");

      // now re‑fetch your status
      const status = await fetch("/api/schema-status").then(r => r.json());
      setMissing(status.missing);

    } catch (e) {
      setMessage(e.message);
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  }

  // toggle back to edit mode
  function handleEdit() {
    setConfigured(false);
    setMessage(null);
    setMessageType("");
  }

  return (
    <div className="setup-container">
      <h1 className="setup-title">Core Database Setup</h1>
      {message && (
        <div className={`message ${messageType}`}>{message}</div>
      )}
      <div className="cards">
        {/* ─── CONFIGURE CARD ───────────────────────────────────── */}
        <div className="card">
          {configured ? (
            <>
              <h2>Configured Connection</h2>
              <p><strong>Host:</strong> {connection.db_host}</p>
              <p><strong>Port:</strong> {connection.db_port}</p>
              <p><strong>User:</strong> {connection.db_user}</p>
              <p><strong>Database:</strong> {connection.db_name}</p>
              <p><strong>Schema:</strong> {connection.schema}</p>
              <p><strong>Driver:</strong> {connection.odbc_driver}</p>
              <div className="buttons">
                <button onClick={handleEdit}>Edit</button>
                <button className="danger" onClick={handleDelete}>Delete</button>
              </div>
            </>
          ) : (
            <>
              <div className="form-grid">
                <label className="form-label">Host</label>
                <input
                  className="form-input"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
                <label className="form-label">Port</label>
                <input
                  type="number"
                  className="form-input"
                  value={port}
                  onChange={(e) => setPort(+e.target.value)}
                />
                <label className="form-label">User</label>
                <input
                  className="form-input"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                />
                <label className="form-label">Password</label>
                <input
                  type="password"
                  className="form-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <label className="form-label">Database</label>
                <input
                  className="form-input"
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                />
                <label className="form-label">Schema</label>
                <input
                  className="form-input"
                  value={schema}
                  onChange={(e) => setSchema(e.target.value)}
                />
                <label className="form-label">ODBC Driver</label>
                <select
                  className="form-select"
                  value={driver}
                  onChange={(e) => setDriver(e.target.value)}
                >
                  <option>ODBC Driver 17 for SQL Server</option>
                  <option>ODBC Driver 18 for SQL Server</option>
                </select>
              </div>
              <div className="button-row">
                <button onClick={handleTest} disabled={loading}>
                  Test Connection
                </button>
                <button onClick={handleSubmit} disabled={loading}>
                  Submit
                </button>
              </div>
            </>
          )}
        </div>

        {/* ─── DEPLOY CARD ───────────────────────────────────── */}
        {configured && (
          <div className="card">
            <h2>Deploy Core Schema</h2>

            {/* all deployed */}
            {missing.tables.length === 0 &&
              missing.views.length === 0 &&
              missing.procedures.length === 0 &&
              missing.functions.length === 0 ? (
              <p>✅ All core schema objects are deployed.</p>

            ) : (
              <>
                {missing.tables.length > 0 && (
                  <p>Missing tables: {missing.tables.join(", ")}</p>
                )}
                {missing.views.length > 0 && (
                  <p>Missing views: {missing.views.join(", ")}</p>
                )}
                {missing.procedures.length > 0 && (
                  <p>Missing procs: {missing.procedures.join(", ")}</p>
                )}
                {missing.functions.length > 0 && (
                  <p>Missing functions: {missing.functions.join(", ")}</p>
                )}

                <button onClick={handleDeploy} disabled={loading}>
                  {loading ? "Deploying…" : "Deploy Missing"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

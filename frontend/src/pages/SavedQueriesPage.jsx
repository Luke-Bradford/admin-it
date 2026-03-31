// src/pages/SavedQueriesPage.jsx
import React, { useContext, useEffect, useReducer, useRef, useState } from 'react';
import { UserContext } from '../context/UserContext';
import { authHeader } from '../utils/auth';
import Button from '../components/ui/Button';
import Input, { Select } from '../components/ui/Input';
import Modal, { ModalBody, ModalFooter } from '../components/ui/Modal';
import EmptyState from '../components/ui/EmptyState';

const POWER_AND_ABOVE = new Set(['PowerUser', 'Admin', 'SystemAdmin']);

const PARAM_TYPES = ['text', 'number', 'date', 'boolean', 'select'];

function hasRole(user, roleSet) {
  if (!user?.roles) return false;
  return user.roles.some((r) => roleSet.has(r));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parameter editor row used inside the Query Editor Modal
// ---------------------------------------------------------------------------

function ParamRow({ param, index, onChange, onRemove }) {
  function set(field, value) {
    onChange(index, { ...param, [field]: value });
  }

  return (
    <div className="grid grid-cols-12 gap-2 items-start py-2 border-b border-gray-100 last:border-0">
      {/* Name */}
      <div className="col-span-3">
        <Input
          type="text"
          placeholder="param_name"
          value={param.name}
          onChange={(e) => set('name', e.target.value)}
          pattern="[a-zA-Z_][a-zA-Z0-9_]*"
          title="Letters, digits, underscores only. Must start with a letter or underscore."
          required
        />
      </div>
      {/* Label */}
      <div className="col-span-3">
        <Input
          type="text"
          placeholder="Display label"
          value={param.label}
          onChange={(e) => set('label', e.target.value)}
          required
        />
      </div>
      {/* Type */}
      <div className="col-span-2">
        <Select value={param.type} onChange={(e) => set('type', e.target.value)}>
          {PARAM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </div>
      {/* Options (only for select type) */}
      <div className="col-span-3">
        {param.type === 'select' ? (
          <Input
            type="text"
            placeholder="opt1,opt2,opt3"
            value={param.options}
            onChange={(e) => set('options', e.target.value)}
            title="Comma-separated list of allowed values"
          />
        ) : (
          <span className="text-xs text-gray-400 flex items-center h-full">—</span>
        )}
      </div>
      {/* Required toggle */}
      <div className="col-span-1 flex items-center justify-center">
        <input
          type="checkbox"
          checked={param.required}
          onChange={(e) => set('required', e.target.checked)}
          title="Required"
          className="h-4 w-4 rounded border-gray-300 text-brand-600"
        />
      </div>
      {/* Remove */}
      <div className="col-span-0 flex items-center justify-end">
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="text-gray-400 hover:text-red-500 transition-colors p-1"
          aria-label="Remove parameter"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function newParam() {
  return { name: '', label: '', type: 'text', options: '', required: true };
}

// ---------------------------------------------------------------------------
// Query Editor Modal (create / edit)
// ---------------------------------------------------------------------------

function QueryEditorModal({ mode, initial, connections, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    if (mode === 'edit' && initial) {
      return {
        name: initial.name ?? '',
        description: initial.description ?? '',
        connection_id: initial.connection_id ?? '',
        query_text: initial.query_text ?? '',
      };
    }
    return {
      name: '',
      description: '',
      connection_id: connections[0]?.id ?? '',
      query_text: '',
    };
  });

  const [params, setParams] = useState(() => {
    if (mode === 'edit' && initial?.parameters) {
      return initial.parameters.map((p) => ({
        name: p.name,
        label: p.label,
        type: p.param_type,
        options: p.select_options ? p.select_options.join(',') : '',
        required: p.is_required,
      }));
    }
    return [];
  });

  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const firstInputRef = useRef(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  function setField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleParamChange(index, updated) {
    setParams((ps) => ps.map((p, i) => (i === index ? updated : p)));
  }

  function handleParamRemove(index) {
    setParams((ps) => ps.filter((_, i) => i !== index));
  }

  function addParam() {
    setParams((ps) => [...ps, newParam()]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    // Build parameters payload
    const parameters = params.map((p, i) => {
      const base = {
        name: p.name,
        label: p.label,
        param_type: p.type,
        is_required: p.required,
        display_order: i,
      };
      if (p.type === 'select') {
        base.select_options = p.options
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      return base;
    });

    const payload = {
      name: form.name,
      connection_id: form.connection_id,
      query_text: form.query_text,
      parameters,
    };
    if (form.description.trim()) payload.description = form.description;

    const url = mode === 'add' ? '/api/queries' : `/api/queries/${initial.id}`;
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

  const title = mode === 'add' ? 'New saved query' : 'Edit saved query';

  return (
    <Modal title={title} onClose={onClose} size="lg" disableClose={saving}>
      <form onSubmit={handleSubmit}>
        <ModalBody className="space-y-4 max-h-[70vh] overflow-y-auto">
          <ErrorBanner message={error} />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Name <span className="text-red-600">*</span>
              </label>
              <Input
                ref={firstInputRef}
                type="text"
                required
                maxLength={255}
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="e.g. Monthly Sales Report"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Connection <span className="text-red-600">*</span>
              </label>
              <Select
                required
                value={form.connection_id}
                onChange={(e) => setField('connection_id', e.target.value)}
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <Input
              type="text"
              maxLength={500}
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              placeholder="Optional short description visible to users"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              SQL query <span className="text-red-600">*</span>
            </label>
            <textarea
              required
              value={form.query_text}
              onChange={(e) => setField('query_text', e.target.value)}
              rows={8}
              placeholder={'SELECT * FROM [schema].[table]\nWHERE column = :param_name'}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono text-gray-900 placeholder-gray-400 bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              spellCheck={false}
            />
            <p className="mt-1 text-xs text-gray-400">
              Use <code className="bg-gray-100 px-1 rounded">:param_name</code> placeholders for
              parameters defined below. Only SELECT statements are permitted.
            </p>
          </div>

          {/* Parameters */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">Parameters</label>
              <button
                type="button"
                onClick={addParam}
                className="text-xs text-brand-600 hover:text-brand-800 transition-colors"
              >
                + Add parameter
              </button>
            </div>

            {params.length === 0 && (
              <p className="text-xs text-gray-400">
                No parameters — this query runs with no user input.
              </p>
            )}

            {params.length > 0 && (
              <div>
                {/* Header row */}
                <div className="grid grid-cols-12 gap-2 mb-1">
                  <div className="col-span-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Name
                  </div>
                  <div className="col-span-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Label
                  </div>
                  <div className="col-span-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Type
                  </div>
                  <div className="col-span-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Options
                  </div>
                  <div className="col-span-1 text-xs font-medium text-gray-500 uppercase tracking-wide text-center">
                    Req.
                  </div>
                </div>
                {params.map((p, i) => (
                  <ParamRow
                    key={i}
                    param={p}
                    index={i}
                    onChange={handleParamChange}
                    onRemove={handleParamRemove}
                  />
                ))}
              </div>
            )}
          </div>
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : mode === 'add' ? 'Create query' : 'Save changes'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation modal
// ---------------------------------------------------------------------------

function DeleteModal({ query, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/queries/${query.id}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? 'Failed to delete query.');
        setDeleting(false);
        return;
      }
      onDeleted(query.id);
    } catch {
      setError('Network error. Please try again.');
      setDeleting(false);
    }
  }

  return (
    <Modal title="Delete query" onClose={onClose} disableClose={deleting}>
      <ModalBody>
        <ErrorBanner message={error} />
        {!error && (
          <p className="text-sm text-gray-700">
            Are you sure you want to delete <span className="font-semibold">{query.name}</span>?
            This cannot be undone.
          </p>
        )}
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
// Run Panel Modal
// ---------------------------------------------------------------------------

function RunModal({ query, onClose }) {
  // Initialise form values from parameter defaults
  const [values, setValues] = useState(() => {
    const init = {};
    for (const p of query.parameters ?? []) {
      init[p.name] = p.param_type === 'boolean' ? false : '';
    }
    return init;
  });

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const [result, setResult] = useState(null); // { columns, rows, total, truncated }
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [exporting, setExporting] = useState(false);

  function setValue(name, value) {
    setValues((v) => ({ ...v, [name]: value }));
  }

  function stringifyValues(vals) {
    const out = {};
    for (const [k, v] of Object.entries(vals)) {
      out[k] = String(v);
    }
    return out;
  }

  async function runQuery(targetPage) {
    setRunning(true);
    setRunError(null);

    const payload = {
      parameters: stringifyValues(values),
      page: targetPage,
      page_size: PAGE_SIZE,
    };

    try {
      const res = await fetch(`/api/queries/${query.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setRunError(data.detail ?? 'Query failed.');
        setRunning(false);
        return;
      }
      setResult(data);
      setPage(targetPage);
    } catch {
      setRunError('Network error. Please try again.');
    } finally {
      setRunning(false);
    }
  }

  async function handleExport(format) {
    setExporting(true);
    try {
      const payload = { parameters: stringifyValues(values), format };
      const res = await fetch(`/api/queries/${query.id}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRunError(data.detail ?? 'Export failed.');
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : `query-export.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setRunError('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    runQuery(1);
  }

  const params = query.parameters ?? [];
  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  return (
    <Modal title={query.name} onClose={onClose} size="lg">
      <div className="flex flex-col max-h-[80vh]">
        {query.description && (
          <div className="px-6 pt-4 pb-0">
            <p className="text-sm text-gray-500">{query.description}</p>
          </div>
        )}

        {/* Parameter form */}
        {params.length > 0 && (
          <form onSubmit={handleSubmit}>
            <div className="px-6 py-4 border-b border-gray-200 grid grid-cols-2 gap-3">
              {params.map((p) => (
                <div key={p.name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {p.label}
                    {p.required && <span className="text-red-600 ml-0.5">*</span>}
                  </label>
                  <ParamInput
                    param={p}
                    value={values[p.name]}
                    onChange={(v) => setValue(p.name, v)}
                  />
                </div>
              ))}
            </div>
            <div className="px-6 py-3 flex items-center gap-3">
              <Button type="submit" disabled={running}>
                {running ? 'Running…' : 'Run query'}
              </Button>
            </div>
          </form>
        )}

        {/* If no params, show run button directly */}
        {params.length === 0 && (
          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
            <Button onClick={() => runQuery(1)} disabled={running}>
              {running ? 'Running…' : 'Run query'}
            </Button>
          </div>
        )}

        {/* Error */}
        {runError && (
          <div className="px-6 py-3">
            <ErrorBanner message={runError} />
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="flex flex-col overflow-hidden flex-1">
            {/* Toolbar */}
            <div className="px-6 py-2 flex items-center justify-between border-b border-gray-100 bg-gray-50 shrink-0">
              <span className="text-xs text-gray-500">
                {result.total.toLocaleString()} row{result.total !== 1 ? 's' : ''}
                {result.truncated && (
                  <span className="ml-1 text-amber-600">(export truncated at 10,000)</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExport('csv')}
                  disabled={exporting}
                  className="text-xs text-brand-600 hover:text-brand-800 disabled:opacity-50"
                >
                  CSV
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => handleExport('xlsx')}
                  disabled={exporting}
                  className="text-xs text-brand-600 hover:text-brand-800 disabled:opacity-50"
                >
                  XLSX
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-auto flex-1">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {result.columns.map((col) => (
                      <th
                        key={col}
                        className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={result.columns.length}
                        className="px-3 py-6 text-center text-gray-400"
                      >
                        No results.
                      </td>
                    </tr>
                  )}
                  {result.rows.map((row, ri) => (
                    <tr key={ri} className="hover:bg-gray-50">
                      {result.columns.map((col) => {
                        const cell = row[col];
                        return (
                          <td
                            key={col}
                            className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-xs truncate"
                          >
                            {cell === null || cell === undefined ? (
                              <span className="text-gray-300">NULL</span>
                            ) : (
                              String(cell)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-6 py-3 flex items-center justify-between border-t border-gray-200 bg-gray-50 shrink-0">
                <Button
                  variant="secondary"
                  disabled={page <= 1 || running}
                  onClick={() => runQuery(page - 1)}
                >
                  Previous
                </Button>
                <span className="text-xs text-gray-500">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="secondary"
                  disabled={page >= totalPages || running}
                  onClick={() => runQuery(page + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// Render a single parameter input appropriate for the param type
function ParamInput({ param, value, onChange }) {
  if (param.param_type === 'boolean') {
    return (
      <div className="flex items-center h-9">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-brand-600"
        />
      </div>
    );
  }
  if (param.param_type === 'select' && param.options?.length > 0) {
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)} required={param.required}>
        <option value="">— select —</option>
        {param.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </Select>
    );
  }
  if (param.param_type === 'date') {
    return (
      <Input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={param.required}
      />
    );
  }
  if (param.param_type === 'number') {
    return (
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={param.required}
        step="any"
      />
    );
  }
  return (
    <Input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={param.required}
      placeholder={param.label}
    />
  );
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function queriesReducer(state, action) {
  switch (action.type) {
    case 'LOADING':
      return { ...state, loading: true, error: null };
    case 'LOADED':
      return { ...state, loading: false, queries: action.payload };
    case 'ERROR':
      return { ...state, loading: false, error: action.payload };
    case 'ADD':
      return { ...state, queries: [...state.queries, action.payload] };
    case 'UPDATE':
      return {
        ...state,
        queries: state.queries.map((q) =>
          q.id === action.payload.id ? { ...q, ...action.payload } : q
        ),
      };
    case 'REMOVE':
      return { ...state, queries: state.queries.filter((q) => q.id !== action.payload) };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function SavedQueriesPage() {
  const user = useContext(UserContext);
  const canManage = hasRole(user, POWER_AND_ABOVE);

  const [state, dispatch] = useReducer(queriesReducer, {
    loading: true,
    error: null,
    queries: [],
  });

  const [connections, setConnections] = useState([]);
  const [modal, setModal] = useState(null);

  // Load queries list
  useEffect(() => {
    dispatch({ type: 'LOADING' });
    fetch('/api/queries', { headers: authHeader() })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => dispatch({ type: 'LOADED', payload: data }))
      .catch((err) => dispatch({ type: 'ERROR', payload: err.message }));
  }, []);

  // Load connections for the editor modal (only needed if the user can manage)
  useEffect(() => {
    if (!canManage) return;
    fetch('/api/connections', { headers: authHeader() })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setConnections(data))
      .catch(() => {});
  }, [canManage]);

  // When opening the editor for an existing query we need the full query detail
  // (including query_text and parameters) which the list endpoint omits.
  async function openEdit(query) {
    try {
      const res = await fetch(`/api/queries/${query.id}`, { headers: authHeader() });
      if (!res.ok) return;
      const full = await res.json();
      setModal({ type: 'edit', query: full });
    } catch {
      // fall back to list row if detail fetch fails
      setModal({ type: 'edit', query });
    }
  }

  function handleSaved(data) {
    if (modal?.type === 'add') {
      dispatch({ type: 'ADD', payload: data });
    } else {
      dispatch({ type: 'UPDATE', payload: data });
    }
    setModal(null);
    // Reload to pick up any server-normalised fields
    fetch('/api/queries', { headers: authHeader() })
      .then((r) => r.json())
      .then((data) => dispatch({ type: 'LOADED', payload: data }))
      .catch(() => {});
  }

  function handleDeleted(id) {
    dispatch({ type: 'REMOVE', payload: id });
    setModal(null);
  }

  // Open the run panel — need full detail for parameters
  async function openRun(query) {
    try {
      const res = await fetch(`/api/queries/${query.id}`, { headers: authHeader() });
      if (!res.ok) return;
      const full = await res.json();
      setModal({ type: 'run', query: full });
    } catch {
      setModal({ type: 'run', query });
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Saved Queries</h1>
          {canManage && (
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
              New query
            </Button>
          )}
        </div>

        <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
          {state.loading && (
            <div className="py-16 text-center text-sm text-gray-400">Loading queries…</div>
          )}
          {state.error && (
            <div className="py-16 text-center text-sm text-red-600">
              Failed to load queries: {state.error}
            </div>
          )}
          {!state.loading && !state.error && state.queries.length === 0 && (
            <EmptyState
              message="No saved queries yet."
              action={
                canManage && (
                  <button
                    onClick={() => setModal({ type: 'add' })}
                    className="text-sm text-brand-600 hover:underline"
                  >
                    Create a query
                  </button>
                )
              }
            />
          )}
          {!state.loading && !state.error && state.queries.length > 0 && (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Connection
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {state.queries.map((q) => (
                  <tr key={q.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{q.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{q.connection_name ?? '—'}</td>
                    <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                      {q.description ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {formatDate(q.created_date)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => openRun(q)}
                          className="text-sm text-brand-600 hover:text-brand-800 transition-colors"
                        >
                          Run
                        </button>
                        {canManage && (
                          <button
                            onClick={() => openEdit(q)}
                            className="text-sm text-brand-600 hover:text-brand-800 transition-colors"
                          >
                            Edit
                          </button>
                        )}
                        {canManage && (
                          <button
                            onClick={() => setModal({ type: 'delete', query: q })}
                            className="text-sm text-red-600 hover:text-red-800 transition-colors"
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
        <QueryEditorModal
          mode="add"
          connections={connections}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
      {modal?.type === 'edit' && (
        <QueryEditorModal
          mode="edit"
          initial={modal.query}
          connections={connections}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
      {modal?.type === 'delete' && (
        <DeleteModal query={modal.query} onClose={() => setModal(null)} onDeleted={handleDeleted} />
      )}
      {modal?.type === 'run' && <RunModal query={modal.query} onClose={() => setModal(null)} />}
    </>
  );
}

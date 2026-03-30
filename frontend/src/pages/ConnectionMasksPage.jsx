// src/pages/ConnectionMasksPage.jsx
//
// Phase 3 — Column-level data masking (#15).
//
// Admin-only page for managing column masks on a connection.
// Accessible at /connections/:connectionId/masks
//
// Features:
//   - View all existing masks for a connection
//   - Add a new mask by selecting schema → table → column
//   - Remove an existing mask

import React, { useContext, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { UserContext } from '../context/UserContext';
import { authHeader } from '../utils/auth';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';

const ADMIN_ROLES = new Set(['Admin', 'SystemAdmin']);

function hasRole(user, roleSet) {
  if (!user?.roles) return false;
  return user.roles.some((r) => roleSet.has(r));
}

// ---------------------------------------------------------------------------
// Add mask panel
// ---------------------------------------------------------------------------

function AddMaskPanel({ connectionId, onAdded }) {
  const [schemas, setSchemas] = useState([]);
  const [selectedSchema, setSelectedSchema] = useState('');
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [columns, setColumns] = useState([]);
  const [selectedColumn, setSelectedColumn] = useState('');

  const [schemasLoading, setSchemasLoading] = useState(true);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);

  // Load schemas on mount.
  useEffect(() => {
    setSchemasLoading(true);
    fetch(`/api/connections/${connectionId}/schemas`, { headers: authHeader() })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setSchemas(d.schemas ?? []))
      .catch(() => setSchemas([]))
      .finally(() => setSchemasLoading(false));
  }, [connectionId]);

  // Load tables when schema changes.
  useEffect(() => {
    if (!selectedSchema) {
      setTables([]);
      setSelectedTable('');
      setColumns([]);
      setSelectedColumn('');
      return;
    }
    setTablesLoading(true);
    fetch(`/api/connections/${connectionId}/schemas/${encodeURIComponent(selectedSchema)}/tables`, {
      headers: authHeader(),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setTables(d.tables ?? []))
      .catch(() => setTables([]))
      .finally(() => setTablesLoading(false));

    setSelectedTable('');
    setColumns([]);
    setSelectedColumn('');
  }, [connectionId, selectedSchema]);

  // Load columns when table changes.
  useEffect(() => {
    if (!selectedSchema || !selectedTable) {
      setColumns([]);
      setSelectedColumn('');
      return;
    }
    setColumnsLoading(true);
    fetch(
      `/api/connections/${connectionId}/schemas/${encodeURIComponent(selectedSchema)}/tables/${encodeURIComponent(selectedTable)}/columns`,
      { headers: authHeader() }
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setColumns(d.columns ?? []))
      .catch(() => setColumns([]))
      .finally(() => setColumnsLoading(false));

    setSelectedColumn('');
  }, [connectionId, selectedSchema, selectedTable]);

  async function handleAdd() {
    if (!selectedSchema || !selectedTable || !selectedColumn) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/connections/${connectionId}/masks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          schema_name: selectedSchema,
          table_name: selectedTable,
          column_name: selectedColumn,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddError(data.detail ?? `HTTP ${res.status}`);
        return;
      }
      onAdded(data);
      setSelectedColumn('');
    } catch {
      setAddError('Network error. Please try again.');
    } finally {
      setAdding(false);
    }
  }

  const canAdd = selectedSchema && selectedTable && selectedColumn && !adding;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
      <h2 className="text-sm font-semibold text-gray-700">Add column mask</h2>

      {addError && (
        <div className="rounded bg-danger-50 border border-danger-200 px-3 py-2 text-sm text-danger-700">
          {addError}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Schema */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Schema</label>
          {schemasLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Spinner className="w-3 h-3" /> Loading…
            </div>
          ) : (
            <select
              value={selectedSchema}
              onChange={(e) => setSelectedSchema(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">Select schema…</option>
              {schemas.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Table */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Table</label>
          {tablesLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Spinner className="w-3 h-3" /> Loading…
            </div>
          ) : (
            <select
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
              disabled={!selectedSchema || tables.length === 0}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
            >
              <option value="">Select table…</option>
              {tables.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Column */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Column</label>
          {columnsLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Spinner className="w-3 h-3" /> Loading…
            </div>
          ) : (
            <select
              value={selectedColumn}
              onChange={(e) => setSelectedColumn(e.target.value)}
              disabled={!selectedTable || columns.length === 0}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
            >
              <option value="">Select column…</option>
              {columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                  {c.data_type ? ` (${c.data_type})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleAdd} disabled={!canAdd}>
          {adding ? 'Adding…' : 'Add mask'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ConnectionMasksPage() {
  const { connectionId } = useParams();
  const user = useContext(UserContext);
  const isAdmin = hasRole(user, ADMIN_ROLES);

  const [masks, setMasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [connectionName, setConnectionName] = useState(null);

  // Load masks.
  useEffect(() => {
    setLoading(true);
    fetch(`/api/connections/${connectionId}/masks`, { headers: authHeader() })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setMasks(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [connectionId]);

  // Load connection name for breadcrumb.
  useEffect(() => {
    fetch('/api/connections', { headers: authHeader() })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        const match = list.find((c) => c.id === connectionId);
        if (match) setConnectionName(match.name);
      })
      .catch(() => {});
  }, [connectionId]);

  function handleAdded(newMask) {
    setMasks((prev) => [...prev, newMask]);
  }

  async function handleDelete(maskId) {
    setDeletingId(maskId);
    try {
      const res = await fetch(`/api/connections/${connectionId}/masks/${maskId}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
      if (res.ok) {
        setMasks((prev) => prev.filter((m) => m.mask_id !== maskId));
      }
    } catch {
      // Silently ignore — the mask row stays in the list; user can retry.
    } finally {
      setDeletingId(null);
    }
  }

  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-danger-600">
          You do not have permission to manage column masks.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link
              to="/connections"
              className="text-brand-600 hover:text-brand-800 transition-colors"
            >
              Connections
            </Link>
            <span>›</span>
            {connectionName ? (
              <Link
                to={`/connections/${connectionId}/browse`}
                className="text-brand-600 hover:text-brand-800 transition-colors"
              >
                {connectionName}
              </Link>
            ) : (
              <span>…</span>
            )}
            <span>›</span>
            <span className="text-gray-700">Column Masks</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Column Masks</h1>
          <p className="mt-1 text-sm text-gray-500">
            Masked columns appear as <span className="font-mono text-gray-700">****</span> for
            non-admin users in the data browser and are excluded from their exports.
          </p>
        </div>
      </div>

      {/* Add mask panel */}
      <AddMaskPanel connectionId={connectionId} onAdded={handleAdded} />

      {/* Existing masks */}
      <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
        {loading && (
          <div className="py-16 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
            <Spinner className="w-4 h-4" /> Loading masks…
          </div>
        )}
        {error && (
          <div className="py-16 text-center text-sm text-danger-600">
            Failed to load masks: {error}
          </div>
        )}
        {!loading && !error && masks.length === 0 && (
          <EmptyState message="No column masks configured. Add one above." />
        )}
        {!loading && !error && masks.length > 0 && (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Schema
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Table
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Column
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Added
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {masks.map((m) => (
                <tr key={m.mask_id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 text-sm text-gray-700">{m.schema_name}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">{m.table_name}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900 flex items-center gap-1.5">
                    {/* Lock icon */}
                    <svg
                      className="w-3.5 h-3.5 text-amber-500 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0110 0v4" />
                    </svg>
                    {m.column_name}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{formatDate(m.created_date)}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleDelete(m.mask_id)}
                      disabled={deletingId === m.mask_id}
                      className="text-sm text-danger-600 hover:text-danger-800 transition-colors disabled:opacity-50"
                    >
                      {deletingId === m.mask_id ? 'Removing…' : 'Remove'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

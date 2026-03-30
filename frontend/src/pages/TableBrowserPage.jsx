// src/pages/TableBrowserPage.jsx
//
// Phase 3 — Data browser (#12): table browser.
//
// Layout: left-hand tree (schemas → tables) | right-hand column detail panel.
// Accessed at /connections/:connectionId/browse
//
// Access: any authenticated user with access to the connection.

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { authHeader } from '../utils/auth';
import Spinner from '../components/ui/Spinner';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRowCount(n) {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M rows`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K rows`;
  return `${n} row${n === 1 ? '' : 's'}`;
}

function typeLabel(col) {
  const t = (col.data_type ?? '').toLowerCase();
  if (col.max_length != null) return `${t}(${col.max_length})`;
  if (col.numeric_precision != null && col.numeric_scale != null) {
    return `${t}(${col.numeric_precision},${col.numeric_scale})`;
  }
  return t;
}

// ---------------------------------------------------------------------------
// Schema tree item
// ---------------------------------------------------------------------------

function SchemaNode({ connectionId, schema, selectedSchema, selectedTable, onSelectTable }) {
  const [open, setOpen] = useState(schema === selectedSchema);
  const [tables, setTables] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Reset fetched tables when the connection or schema identity changes so
  // reusing this component with different props does not serve stale data.
  useEffect(() => {
    setTables(null);
    setError(null);
  }, [connectionId, schema]);

  const load = useCallback(() => {
    if (tables !== null) return; // already loaded — guard captures current tables at call time
    setLoading(true);
    fetch(`/api/connections/${connectionId}/schemas/${encodeURIComponent(schema)}/tables`, {
      headers: authHeader(),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setTables(d.tables))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, schema]);

  function toggle() {
    if (!open) load();
    setOpen((o) => !o);
  }

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-sm text-left hover:bg-gray-100 rounded transition-colors"
      >
        <svg
          className={`w-3.5 h-3.5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <svg
          className="w-4 h-4 shrink-0 text-indigo-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7c0-2-1.5-3-3.5-3h-9C5.5 4 4 5 4 7z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 11h16" />
        </svg>
        <span className="font-medium text-gray-800 truncate">{schema}</span>
      </button>

      {open && (
        <div className="ml-4">
          {loading && (
            <div className="px-2 py-2">
              <Spinner className="w-4 h-4" />
            </div>
          )}
          {error && <p className="px-2 py-1 text-xs text-danger-600">Failed to load: {error}</p>}
          {tables && tables.length === 0 && (
            <p className="px-2 py-1 text-xs text-gray-400">No tables found</p>
          )}
          {tables &&
            tables.map((t) => (
              <TableNode
                key={t.name}
                table={t}
                schema={schema}
                selected={selectedSchema === schema && selectedTable === t.name}
                onSelect={() => onSelectTable(schema, t)}
              />
            ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table tree item
// ---------------------------------------------------------------------------

function TableNode({ table, selected, onSelect }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-sm text-left rounded transition-colors ${
        selected ? 'bg-brand-100 text-brand-800' : 'hover:bg-gray-100 text-gray-700'
      }`}
    >
      <svg
        className="w-4 h-4 shrink-0 text-gray-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
      >
        {table.type === 'VIEW' ? (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
          />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 10h18M3 14h18M10 6v12M14 6v12M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z"
          />
        )}
      </svg>
      <span className="truncate flex-1">{table.name}</span>
      {table.row_count != null && (
        <span className="shrink-0 text-xs text-gray-400">{formatRowCount(table.row_count)}</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Column detail panel
// ---------------------------------------------------------------------------

function ColumnPanel({ connectionId, schema, table }) {
  const [state, setState] = useState({ loading: true, error: null, columns: null });

  useEffect(() => {
    setState({ loading: true, error: null, columns: null });
    fetch(
      `/api/connections/${connectionId}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table.name)}/columns`,
      { headers: authHeader() }
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setState({ loading: false, error: null, columns: d.columns }))
      .catch((e) => setState({ loading: false, error: e.message, columns: null }));
  }, [connectionId, schema, table.name]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-900">
            {schema}.{table.name}
          </h2>
          <Badge variant={table.type === 'VIEW' ? 'blue' : 'default'}>{table.type}</Badge>
          {table.row_count != null && (
            <span className="text-sm text-gray-500">{formatRowCount(table.row_count)}</span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {state.loading && (
          <div className="flex items-center justify-center h-32">
            <Spinner className="w-6 h-6" />
          </div>
        )}
        {state.error && (
          <div className="px-6 py-4 text-sm text-danger-600">
            Failed to load columns: {state.error}
          </div>
        )}
        {state.columns && state.columns.length === 0 && (
          <EmptyState message="No columns found for this table." />
        )}
        {state.columns && state.columns.length > 0 && (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Column
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Nullable
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Default
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {state.columns.map((col) => (
                <tr key={col.name} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-3 text-sm font-medium text-gray-900">{col.name}</td>
                  <td className="px-6 py-3 text-sm font-mono text-gray-600">{typeLabel(col)}</td>
                  <td className="px-6 py-3 text-sm text-gray-500">
                    {col.nullable ? (
                      <span className="text-gray-400">YES</span>
                    ) : (
                      <span className="font-medium text-gray-700">NO</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-sm font-mono text-gray-500 max-w-xs truncate">
                    {col.default ?? <span className="text-gray-300">—</span>}
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

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function TableBrowserPage() {
  const { connectionId } = useParams();

  const [schemasState, setSchemasState] = useState({ loading: true, error: null, schemas: null });
  const [selected, setSelected] = useState(null); // { schema, table }

  useEffect(() => {
    setSchemasState({ loading: true, error: null, schemas: null });
    fetch(`/api/connections/${connectionId}/schemas`, { headers: authHeader() })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setSchemasState({ loading: false, error: null, schemas: d.schemas }))
      .catch((e) => setSchemasState({ loading: false, error: e.message, schemas: null }));
  }, [connectionId]);

  function handleSelectTable(schema, table) {
    setSelected({ schema, table });
  }

  return (
    <div className="flex h-full overflow-hidden -m-6 rounded-none">
      {/* Left tree */}
      <aside className="w-64 shrink-0 flex flex-col border-r border-gray-200 bg-white overflow-y-auto">
        <div className="px-3 py-3 border-b border-gray-200 shrink-0">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Schemas &amp; Tables
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto py-2 px-1">
          {schemasState.loading && (
            <div className="flex items-center justify-center py-8">
              <Spinner className="w-6 h-6" />
            </div>
          )}
          {schemasState.error && (
            <p className="px-3 py-2 text-xs text-danger-600">
              Failed to load: {schemasState.error}
            </p>
          )}
          {schemasState.schemas && schemasState.schemas.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-400">No schemas found</p>
          )}
          {schemasState.schemas &&
            schemasState.schemas.map((s) => (
              <SchemaNode
                key={s}
                connectionId={connectionId}
                schema={s}
                selectedSchema={selected?.schema}
                selectedTable={selected?.table?.name}
                onSelectTable={handleSelectTable}
              />
            ))}
        </div>
      </aside>

      {/* Right detail panel */}
      <main className="flex-1 overflow-hidden bg-white">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            Select a table to view its columns
          </div>
        ) : (
          <ColumnPanel
            connectionId={connectionId}
            schema={selected.schema}
            table={selected.table}
          />
        )}
      </main>
    </div>
  );
}

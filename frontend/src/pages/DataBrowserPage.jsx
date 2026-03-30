// src/pages/DataBrowserPage.jsx
//
// Phase 3 — Data browser (#13): paginated row view with column filtering.
//
// Accessed at /connections/:connectionId/browse/:schema/:table
//
// Features:
//   - Paginated data grid (default 50 rows/page, up to 200)
//   - Sort by column (click header to toggle asc/desc)
//   - Per-column filter (operator + value, applied server-side)
//   - Column visibility picker
//   - Loading, error, and empty states

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { authHeader } from '../utils/auth';
import Spinner from '../components/ui/Spinner';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

const OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: '<=' },
  { value: 'is_null', label: 'is empty' },
  { value: 'is_not_null', label: 'is not empty' },
];

const NULL_OPERATORS = new Set(['is_null', 'is_not_null']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildQueryString({ page, pageSize, sortCol, sortDir, filters }) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  if (sortCol) {
    params.set('sort_col', sortCol);
    params.set('sort_dir', sortDir);
  }
  for (const f of filters) {
    if (f.column && f.operator) {
      const val = NULL_OPERATORS.has(f.operator)
        ? `${f.column}:${f.operator}`
        : `${f.column}:${f.operator}:${f.value ?? ''}`;
      params.append('filters', val);
    }
  }
  return params.toString();
}

function buildExportQueryString({ sortCol, sortDir, filters, format }) {
  const params = new URLSearchParams();
  params.set('export_format', format);
  if (sortCol) {
    params.set('sort_col', sortCol);
    params.set('sort_dir', sortDir);
  }
  for (const f of filters) {
    if (f.column && f.operator) {
      const val = NULL_OPERATORS.has(f.operator)
        ? `${f.column}:${f.operator}`
        : `${f.column}:${f.operator}:${f.value ?? ''}`;
      params.append('filters', val);
    }
  }
  return params.toString();
}

// ---------------------------------------------------------------------------
// FilterRow component
// ---------------------------------------------------------------------------

function FilterRow({ filter, columns, onChange, onRemove }) {
  const needsValue = !NULL_OPERATORS.has(filter.operator);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={filter.column}
        onChange={(e) => onChange({ ...filter, column: e.target.value })}
        className="text-sm border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
      >
        <option value="">Column…</option>
        {columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        value={filter.operator}
        onChange={(e) => onChange({ ...filter, operator: e.target.value, value: '' })}
        className="text-sm border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
      >
        {OPERATORS.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>

      {needsValue && (
        <input
          type="text"
          value={filter.value ?? ''}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
          placeholder="value…"
          className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500 w-36"
        />
      )}

      <button
        onClick={onRemove}
        className="text-gray-400 hover:text-danger-600 transition-colors"
        aria-label="Remove filter"
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
  );
}

// ---------------------------------------------------------------------------
// ColumnPicker component
// ---------------------------------------------------------------------------

function ColumnPicker({ columns, visible, onChange, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  function toggle(col) {
    if (visible.has(col) && visible.size === 1) return; // keep at least one
    const next = new Set(visible);
    if (next.has(col)) next.delete(col);
    else next.add(col);
    onChange(next);
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg w-56 max-h-72 overflow-y-auto"
    >
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Columns
        </span>
        <div className="flex gap-2 text-xs text-brand-600">
          <button onClick={() => onChange(new Set(columns))} className="hover:underline">
            All
          </button>
          <button onClick={() => onChange(new Set([columns[0]]))} className="hover:underline">
            Reset
          </button>
        </div>
      </div>
      {columns.map((c) => (
        <label
          key={c}
          className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm text-gray-700"
        >
          <input
            type="checkbox"
            checked={visible.has(c)}
            onChange={() => toggle(c)}
            className="accent-brand-600"
          />
          <span className="truncate">{c}</span>
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sort icon
// ---------------------------------------------------------------------------

function SortIcon({ active, dir }) {
  if (!active)
    return (
      <svg
        className="w-3 h-3 text-gray-300 ml-1 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"
        />
      </svg>
    );
  return (
    <svg
      className="w-3 h-3 text-brand-600 ml-1 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      {dir === 'asc' ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DataBrowserPage() {
  const { connectionId, schema, table } = useParams();

  // Query state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [filters, setFilters] = useState([]); // pending (not yet applied)
  const [appliedFilters, setAppliedFilters] = useState([]);

  // Data state
  const [data, setData] = useState(null); // { columns, rows, total_count, page, page_size, total_pages }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // UI state
  const [visibleCols, setVisibleCols] = useState(null); // null = all
  const [showPicker, setShowPicker] = useState(false);
  const [exportFormat, setExportFormat] = useState('csv');
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState(null); // null | { type: 'warning'|'error', message }

  const controllerRef = useRef(null);

  const fetchData = useCallback(
    (pg, ps, sc, sd, af) => {
      if (controllerRef.current) controllerRef.current.abort();
      const ctrl = new AbortController();
      controllerRef.current = ctrl;

      setLoading(true);
      setError(null);

      const qs = buildQueryString({
        page: pg,
        pageSize: ps,
        sortCol: sc,
        sortDir: sd,
        filters: af,
      });
      fetch(
        `/api/connections/${connectionId}/data/${encodeURIComponent(schema)}/${encodeURIComponent(table)}?${qs}`,
        { headers: authHeader(), signal: ctrl.signal }
      )
        .then((r) => {
          if (!r.ok)
            return r.json().then((d) => Promise.reject(new Error(d.detail ?? `HTTP ${r.status}`)));
          return r.json();
        })
        .then((d) => {
          setData(d);
          setVisibleCols((prev) => {
            // Initialise visibility on first load; preserve on subsequent fetches.
            if (prev === null) return new Set(d.columns);
            return prev;
          });
          setLoading(false);
        })
        .catch((e) => {
          if (e.name !== 'AbortError') {
            setError(e.message);
            setLoading(false);
          }
        });
    },
    [connectionId, schema, table]
  );

  // Initial load + re-fetch when query params change.
  // Clear any stale export notice when the table changes (fetchData is recreated
  // with new connectionId/schema/table deps, triggering this effect).
  useEffect(() => {
    setExportNotice(null);
    fetchData(page, pageSize, sortCol, sortDir, appliedFilters);
  }, [fetchData, page, pageSize, sortCol, sortDir, appliedFilters]);

  // Abort any in-flight fetch when the component unmounts.
  // Route changes that trigger a new fetch are handled inside fetchData itself,
  // which aborts the previous controller before starting a new one.
  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  function handleSort(col) {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
    setPage(1);
  }

  function addFilter() {
    setFilters((f) => [...f, { column: data?.columns?.[0] ?? '', operator: 'eq', value: '' }]);
  }

  function applyFilters() {
    // Only apply filters that have a column selected.
    const valid = filters.filter((f) => f.column);
    setAppliedFilters(valid);
    setPage(1);
  }

  function clearFilters() {
    setFilters([]);
    setAppliedFilters([]);
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);
    setExportNotice(null);
    const qs = buildExportQueryString({
      sortCol,
      sortDir,
      filters: appliedFilters,
      format: exportFormat,
    });
    const url = `/api/connections/${connectionId}/data/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/export?${qs}`;
    try {
      const res = await fetch(url, { headers: authHeader() });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail ?? `HTTP ${res.status}`);
      }
      if (res.headers.get('X-Export-Truncated') === 'true') {
        const total = res.headers.get('X-Total-Count');
        setExportNotice({
          type: 'warning',
          message: `Only the first 10,000 of ${Number(total).toLocaleString()} rows were exported.`,
        });
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      // Use the server-supplied sanitised filename from Content-Disposition.
      const cd = res.headers.get('Content-Disposition') ?? '';
      const match = cd.match(/filename="([^"]+)"/);
      a.download = match ? match[1] : `${table}.${exportFormat}`;
      a.click();
      // Defer revocation so the browser has time to start the download.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 100);
    } catch (e) {
      setExportNotice({ type: 'error', message: `Export failed: ${e.message}` });
    } finally {
      setExporting(false);
    }
  }

  const columns = data?.columns ?? [];
  const displayCols = visibleCols ? columns.filter((c) => visibleCols.has(c)) : columns;
  // Set of column names that are masked (for lock icon in column headers).
  const maskedColsSet = new Set(data?.masked_columns ?? []);
  const totalPages = data?.total_pages ?? 1;
  const totalCount = data?.total_count ?? 0;

  return (
    <div className="flex flex-col h-full -m-6 overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 px-6 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Breadcrumb-style back link */}
          <Link
            to={`/connections/${connectionId}/browse`}
            className="text-sm text-brand-600 hover:text-brand-800 transition-colors"
          >
            ← {schema}.{table}
          </Link>

          <span className="text-gray-300 text-sm">|</span>

          {/* Filter controls */}
          <Button variant="secondary" size="sm" onClick={addFilter} disabled={!data}>
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z"
              />
            </svg>
            Add filter
          </Button>

          {filters.length > 0 && (
            <>
              <Button size="sm" onClick={applyFilters}>
                Apply
              </Button>
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear
              </Button>
            </>
          )}

          <div className="flex-1" />

          {/* Row count */}
          {data && !loading && (
            <span className="text-sm text-gray-500">
              {totalCount.toLocaleString()} row{totalCount !== 1 ? 's' : ''}
            </span>
          )}

          {/* Page size */}
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>

          {/* Column picker */}
          {data && (
            <div className="relative">
              <Button variant="secondary" size="sm" onClick={() => setShowPicker((s) => !s)}>
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
                  />
                </svg>
                Columns
                {visibleCols && visibleCols.size < columns.length && (
                  <span className="ml-1 text-xs text-brand-600">({visibleCols.size})</span>
                )}
              </Button>
              {showPicker && visibleCols && (
                <ColumnPicker
                  columns={columns}
                  visible={visibleCols}
                  onChange={setVisibleCols}
                  onClose={() => setShowPicker(false)}
                />
              )}
            </div>
          )}

          {/* Export format picker + export button */}
          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value)}
            disabled={!data || exporting}
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
          >
            <option value="csv">CSV</option>
            <option value="xlsx">Excel</option>
          </select>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            disabled={!data || exporting}
          >
            {exporting ? (
              <Spinner className="w-3.5 h-3.5" />
            ) : (
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
            )}
            {exporting ? 'Exporting…' : 'Export'}
          </Button>
        </div>

        {/* Active filters */}
        {filters.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            {filters.map((f, i) => (
              <FilterRow
                key={i}
                filter={f}
                columns={columns}
                onChange={(updated) =>
                  setFilters((prev) => prev.map((x, j) => (j === i ? updated : x)))
                }
                onRemove={() => setFilters((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        )}
      </div>

      {/* Export notice (truncation warning or error) */}
      {exportNotice && (
        <div
          className={`shrink-0 px-6 py-2 border-b text-sm flex items-center justify-between ${
            exportNotice.type === 'error'
              ? 'bg-danger-50 border-danger-200 text-danger-800'
              : 'bg-yellow-50 border-yellow-200 text-yellow-800'
          }`}
        >
          <span>{exportNotice.message}</span>
          <button
            onClick={() => setExportNotice(null)}
            className="ml-4 text-current opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Dismiss"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Data grid */}
      <div className="flex-1 overflow-auto bg-white">
        {loading && (
          <div className="flex items-center justify-center h-32">
            <Spinner className="w-6 h-6" />
          </div>
        )}

        {!loading && error && (
          <div className="px-6 py-4 text-sm text-danger-600">Failed to load data: {error}</div>
        )}

        {!loading && !error && data && data.rows.length === 0 && (
          <EmptyState message="No rows match the current filters." />
        )}

        {!loading && !error && data && data.rows.length > 0 && (
          <table className="min-w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr>
                {displayCols.map((col) => (
                  <th
                    key={col}
                    onClick={() => handleSort(col)}
                    className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap cursor-pointer select-none border-b border-gray-200 hover:bg-gray-100 transition-colors"
                  >
                    <span className="flex items-center gap-1">
                      {col}
                      {maskedColsSet.has(col) && (
                        <svg
                          className="w-3 h-3 text-amber-500 shrink-0"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          viewBox="0 0 24 24"
                          role="img"
                          aria-label="Masked column"
                        >
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0110 0v4" />
                        </svg>
                      )}
                      <SortIcon active={sortCol === col} dir={sortDir} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-gray-50 transition-colors">
                  {displayCols.map((col) => (
                    <td
                      key={col}
                      className="px-4 py-2 text-gray-700 whitespace-nowrap max-w-xs overflow-hidden text-ellipsis"
                      title={row[col] != null ? String(row[col]) : ''}
                    >
                      {row[col] == null ? (
                        <span className="text-gray-300 italic text-xs">NULL</span>
                      ) : (
                        String(row[col])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="shrink-0 px-6 py-3 bg-white border-t border-gray-200 flex items-center justify-between">
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(1)}>
              «
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ‹
            </Button>
            {/* Page window */}
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 3, totalPages - 6));
              return start + i;
            }).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`min-w-[2rem] h-8 rounded text-sm transition-colors ${
                  p === page ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {p}
              </button>
            ))}
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              ›
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(totalPages)}
            >
              »
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

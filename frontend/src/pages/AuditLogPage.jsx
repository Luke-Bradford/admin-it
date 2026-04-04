// src/pages/AuditLogPage.jsx
import React, { useEffect, useReducer } from 'react';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import { authHeader } from '../utils/auth';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CORE_TABLES = new Set([
  'Users',
  'Connections',
  'ConnectionPermissions',
  'Secrets',
  'ColumnMasks',
  'SavedQueries',
]);

const ACTION_BADGE = {
  INSERT: 'green',
  UPDATE: 'yellow',
  DELETE: 'red',
  EXPORT: 'blue',
  ACCESS: 'default',
};

const QUICK_PRESETS = [
  { key: '24h', label: 'Last 24h' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'custom', label: 'Custom range…' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function changedByLabel(entry) {
  if (entry.changed_by_username) return entry.changed_by_username;
  if (!entry.changed_by && CORE_TABLES.has(entry.table_name)) return 'Direct DB access';
  return 'System';
}

function isDirectDbAccess(entry) {
  return !entry.changed_by && CORE_TABLES.has(entry.table_name);
}

function localDateStr(d) {
  // Use local date parts to avoid UTC-vs-local midnight discrepancy for UTC+ timezones
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayStr() {
  return localDateStr(new Date());
}

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateStr(d);
}

function buildQueryString(filters, page, pageSize) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));

  if (filters.quickPreset === '7d') {
    params.set('from_dt', daysAgoStr(7) + 'T00:00:00');
    params.set('to_dt', todayStr() + 'T23:59:59');
  } else if (filters.quickPreset === '30d') {
    params.set('from_dt', daysAgoStr(30) + 'T00:00:00');
    params.set('to_dt', todayStr() + 'T23:59:59');
  } else if (filters.quickPreset === 'custom' || filters.quickPreset === null) {
    // quickPreset === null: record-ID mode — dates are always null, no date params sent (full lifecycle).
    // quickPreset === 'custom': only send when both bounds are filled; half-filled range is suppressed
    // at the fetch level so we never request with only one bound.
    if (filters.fromDate) params.set('from_dt', filters.fromDate + 'T00:00:00');
    if (filters.toDate) params.set('to_dt', filters.toDate + 'T23:59:59');
  }
  // 24h preset: send no date params — backend applies default

  if (filters.tableName) params.set('table_name', filters.tableName);
  if (filters.action) params.set('action', filters.action);
  if (filters.changedBy) params.set('changed_by', filters.changedBy);
  if (filters.recordId) params.set('record_id', filters.recordId);

  return params.toString();
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const initialFilters = {
  quickPreset: '24h',
  fromDate: null,
  toDate: null,
  tableName: null,
  action: null,
  changedBy: null,
  recordId: null,
};

const initialState = {
  status: 'loading',
  errorCode: null,
  entries: [],
  totalCount: 0,
  page: 1,
  pageSize: 50,
  totalPages: 0,
  users: [],
  filters: initialFilters,
  expandedRows: {},
};

function reducer(state, action) {
  switch (action.type) {
    case 'LOADING':
      return { ...state, status: 'loading' };
    case 'LOADED':
      return {
        ...state,
        status: 'loaded',
        entries: action.data.entries,
        totalCount: action.data.total_count,
        page: action.data.page,
        pageSize: action.data.page_size,
        totalPages: action.data.total_pages,
      };
    case 'ERROR':
      return { ...state, status: 'error', errorCode: action.code };
    case 'SET_USERS':
      return { ...state, users: action.users };
    case 'SET_FILTER':
      return {
        ...state,
        filters: { ...state.filters, ...action.patch },
        page: 1,
        expandedRows: {},
      };
    case 'SET_PAGE':
      return { ...state, page: action.page };
    case 'SET_PAGE_SIZE':
      return { ...state, pageSize: action.pageSize, page: 1 };
    case 'TOGGLE_ROW':
      return {
        ...state,
        expandedRows: { ...state.expandedRows, [action.id]: !state.expandedRows[action.id] },
      };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// DiffView sub-component
// ---------------------------------------------------------------------------

function DiffView({ oldData, newData }) {
  const oldObj = Array.isArray(oldData) ? (oldData[0] ?? null) : oldData;
  const newObj = Array.isArray(newData) ? (newData[0] ?? null) : newData;

  const allKeys = [...new Set([...Object.keys(oldObj ?? {}), ...Object.keys(newObj ?? {})])];
  // Compute changed keys once so the render doesn't re-stringify per row
  const changedKeys = new Set(
    allKeys.filter(
      (k) => JSON.stringify(oldObj?.[k] ?? null) !== JSON.stringify(newObj?.[k] ?? null)
    )
  );
  const sortedKeys = [
    ...allKeys.filter((k) => changedKeys.has(k)),
    ...allKeys.filter((k) => !changedKeys.has(k)),
  ];

  if (sortedKeys.length === 0) {
    return (
      <div className="border-t border-blue-200 bg-white px-4 py-3 text-sm text-gray-400 italic">
        No field data available.
      </div>
    );
  }

  return (
    <div className="border-t border-blue-200 bg-white px-3 py-2">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-2 py-1.5 text-gray-500 font-semibold uppercase tracking-wide w-1/5">
              Field
            </th>
            <th className="text-left px-2 py-1.5 text-gray-500 font-semibold uppercase tracking-wide w-2/5">
              Before
            </th>
            <th className="text-left px-2 py-1.5 text-gray-500 font-semibold uppercase tracking-wide w-2/5">
              After
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedKeys.map((k) => {
            const isChanged = changedKeys.has(k);
            const oldVal = oldObj?.[k] !== undefined ? String(oldObj[k]) : null;
            const newVal = newObj?.[k] !== undefined ? String(newObj[k]) : null;
            return (
              <tr
                key={k}
                className={
                  isChanged ? 'bg-amber-50 border-b border-gray-100' : 'border-b border-gray-100'
                }
              >
                <td
                  className={`px-2 py-1.5 ${isChanged ? 'text-amber-800 font-semibold' : 'text-gray-400'}`}
                >
                  {k}
                </td>
                <td
                  className={`px-2 py-1.5 font-mono ${isChanged ? 'bg-red-50 text-red-800 font-medium' : 'text-gray-400'}`}
                >
                  {oldVal ?? <span className="italic text-gray-300">—</span>}
                </td>
                <td
                  className={`px-2 py-1.5 font-mono ${isChanged ? 'bg-green-50 text-green-800 font-medium' : 'text-gray-400'}`}
                >
                  {newVal ?? <span className="italic text-gray-300">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination sub-component
// ---------------------------------------------------------------------------

function Pagination({ page, totalPages, pageSize, onPage, onPageSize }) {
  const pages = [];
  const delta = 2;
  const left = Math.max(1, page - delta);
  const right = Math.min(totalPages, page + delta);
  for (let i = left; i <= right; i++) pages.push(i);

  return (
    <div className="flex items-center justify-between pt-3 border-t border-gray-100 mt-2">
      <div className="flex items-center gap-1 text-sm">
        <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => onPage(1)}>
          «
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
        >
          ‹
        </Button>
        {left > 1 && <span className="px-2 text-gray-400">…</span>}
        {pages.map((p) => (
          <Button
            key={p}
            variant={p === page ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => onPage(p)}
          >
            {p}
          </Button>
        ))}
        {right < totalPages && <span className="px-2 text-gray-400">…</span>}
        <Button
          variant="secondary"
          size="sm"
          disabled={page === totalPages}
          onClick={() => onPage(page + 1)}
        >
          ›
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={page === totalPages}
          onClick={() => onPage(totalPages)}
        >
          »
        </Button>
      </div>
      <select
        className="text-sm bg-gray-100 border-none rounded px-2 py-1 text-gray-600"
        value={pageSize}
        onChange={(e) => onPageSize(Number(e.target.value))}
      >
        {[50, 100, 200].map((n) => (
          <option key={n} value={n}>
            {n} per page
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function AuditLogPage() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const {
    status,
    errorCode,
    entries,
    totalCount,
    page,
    pageSize,
    totalPages,
    users,
    filters,
    expandedRows,
  } = state;

  // Fetch entries whenever filters, page, or pageSize change.
  // Suppress fetch when a custom date range is half-filled — wait for both bounds.
  const isHalfFilledCustom =
    filters.quickPreset === 'custom' && Boolean(filters.fromDate) !== Boolean(filters.toDate);

  useEffect(() => {
    if (isHalfFilledCustom) return;
    let cancelled = false;
    dispatch({ type: 'LOADING' });
    const qs = buildQueryString(filters, page, pageSize);
    fetch(`/api/audit?${qs}`, { headers: authHeader() })
      .then((res) => {
        if (!res.ok) {
          if (!cancelled) dispatch({ type: 'ERROR', code: res.status });
          return;
        }
        return res.json();
      })
      .then((data) => {
        if (data && !cancelled) dispatch({ type: 'LOADED', data });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'ERROR', code: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [filters, page, pageSize, isHalfFilledCustom]);

  // Fetch users for dropdown once on mount
  useEffect(() => {
    fetch('/api/audit/users', { headers: authHeader() })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => dispatch({ type: 'SET_USERS', users: data }))
      .catch(() => {});
  }, []);

  function setFilter(patch) {
    dispatch({ type: 'SET_FILTER', patch });
  }

  function handlePreset(key) {
    if (key === 'custom') {
      setFilter({ quickPreset: 'custom', recordId: null });
    } else {
      setFilter({ quickPreset: key, fromDate: null, toDate: null, recordId: null });
    }
  }

  function handleRecordIdClick(e, id) {
    e.stopPropagation();
    setFilter({ recordId: id, quickPreset: null, fromDate: null, toDate: null });
  }

  function removeChip(field) {
    if (field === 'date') {
      setFilter({ quickPreset: '24h', fromDate: null, toDate: null });
    } else if (field === 'recordId') {
      setFilter({ recordId: null, quickPreset: '24h', fromDate: null, toDate: null });
    } else {
      setFilter({ [field]: null });
    }
  }

  function clearAll() {
    dispatch({ type: 'SET_FILTER', patch: initialFilters });
  }

  // Build active chip list.
  // quickPreset === null means record-ID mode: date range was cleared when the record ID was set.
  // In that state no date chip is shown — only the Record chip below. Removing the Record chip
  // restores quickPreset to '24h', so the page never stays in a dateless, recordless state.
  const chips = [];
  if (filters.quickPreset === '24h') chips.push({ key: 'date', label: 'Last 24 hours' });
  else if (filters.quickPreset === '7d') chips.push({ key: 'date', label: 'Last 7 days' });
  else if (filters.quickPreset === '30d') chips.push({ key: 'date', label: 'Last 30 days' });
  else if (filters.fromDate && filters.toDate)
    chips.push({ key: 'date', label: `From: ${filters.fromDate}  To: ${filters.toDate}` });
  if (filters.tableName) chips.push({ key: 'tableName', label: `Table: ${filters.tableName}` });
  if (filters.action) chips.push({ key: 'action', label: `Action: ${filters.action}` });
  if (filters.changedBy) {
    const u = users.find((x) => x.id === filters.changedBy);
    chips.push({ key: 'changedBy', label: `User: ${u ? u.username : filters.changedBy}` });
  }
  if (filters.recordId) chips.push({ key: 'recordId', label: `Record: ${filters.recordId}` });

  const hasNonDefaultFilters =
    filters.quickPreset !== '24h' ||
    filters.tableName ||
    filters.action ||
    filters.changedBy ||
    filters.recordId;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Page heading */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Audit Log</h1>
          {status === 'loaded' && (
            <p className="text-sm text-gray-500 mt-0.5">
              {totalCount.toLocaleString()} {totalCount === 1 ? 'entry' : 'entries'} matching
              current filters
            </p>
          )}
        </div>
        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">Admin only</span>
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-gray-200 rounded-lg mb-4">
        {/* Row 1: presets + dropdowns */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-500 mr-1">Quick:</span>
          {QUICK_PRESETS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handlePreset(key)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filters.quickPreset === key
                  ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                  : 'bg-gray-100 border-transparent text-gray-600 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}

          {filters.quickPreset === 'custom' && (
            <div className="flex items-center gap-2 ml-1">
              <label className="text-xs text-gray-500">From</label>
              <input
                type="date"
                value={filters.fromDate ?? ''}
                max={filters.toDate ?? undefined}
                onChange={(e) => setFilter({ fromDate: e.target.value || null })}
                className="text-xs border border-gray-300 rounded px-2 py-1 text-gray-700"
              />
              <label className="text-xs text-gray-500">To</label>
              <input
                type="date"
                value={filters.toDate ?? ''}
                min={filters.fromDate ?? undefined}
                onChange={(e) => setFilter({ toDate: e.target.value || null })}
                className="text-xs border border-gray-300 rounded px-2 py-1 text-gray-700"
              />
            </div>
          )}

          <div className="w-px h-5 bg-gray-200 mx-1" />

          {/* Table dropdown */}
          <select
            className="text-xs bg-gray-100 border-none rounded px-2 py-1.5 text-gray-600"
            value={filters.tableName ?? ''}
            onChange={(e) => setFilter({ tableName: e.target.value || null })}
          >
            <option value="">Table: All</option>
            {[...CORE_TABLES].sort().map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          {/* Action dropdown */}
          <select
            className="text-xs bg-gray-100 border-none rounded px-2 py-1.5 text-gray-600"
            value={filters.action ?? ''}
            onChange={(e) => setFilter({ action: e.target.value || null })}
          >
            <option value="">Action: All</option>
            {['INSERT', 'UPDATE', 'DELETE', 'EXPORT', 'ACCESS'].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          {/* User dropdown */}
          <select
            className="text-xs bg-gray-100 border-none rounded px-2 py-1.5 text-gray-600"
            value={filters.changedBy ?? ''}
            onChange={(e) => setFilter({ changedBy: e.target.value || null })}
          >
            <option value="">User: All</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>
        </div>

        {/* Row 2: active filter chips */}
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-2">
            <span className="text-xs font-semibold text-gray-500">Active filters:</span>
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-3 py-0.5"
              >
                {chip.label}
                <button
                  onClick={() => removeChip(chip.key)}
                  className="text-blue-300 hover:text-blue-600 ml-0.5 leading-none"
                  aria-label={`Remove ${chip.label} filter`}
                >
                  ✕
                </button>
              </span>
            ))}
            {hasNonDefaultFilters && (
              <button
                onClick={clearAll}
                className="text-xs text-blue-500 hover:text-blue-700 underline ml-1"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      {status === 'loading' && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {status === 'error' && errorCode === 403 && (
        <EmptyState message="You don't have permission to view the audit log." />
      )}

      {status === 'error' && errorCode === 501 && (
        <EmptyState message="Audit log is not available for this installation." />
      )}

      {status === 'error' && errorCode !== 403 && errorCode !== 501 && (
        <EmptyState message="Something went wrong loading the audit log. Please try again." />
      )}

      {status === 'loaded' && entries.length === 0 && (
        <EmptyState message="No audit entries match your filters." />
      )}

      {status === 'loaded' && entries.length > 0 && (
        <>
          <div className="space-y-1.5">
            {entries.map((entry) => {
              const expanded = !!expandedRows[entry.id];
              return (
                <div
                  key={entry.id}
                  className={`border rounded-lg overflow-hidden transition-colors ${
                    expanded ? 'border-blue-400' : 'border-gray-200'
                  }`}
                >
                  {/* Row header */}
                  <button
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors ${
                      expanded ? 'bg-blue-50 hover:bg-blue-100' : 'bg-white hover:bg-gray-50'
                    }`}
                    onClick={() => dispatch({ type: 'TOGGLE_ROW', id: entry.id })}
                  >
                    <span className={`w-3 text-xs ${expanded ? 'text-blue-400' : 'text-gray-300'}`}>
                      {expanded ? '▼' : '▶'}
                    </span>
                    <span className="text-gray-500 w-44 shrink-0">
                      {formatDate(entry.changed_at)}
                    </span>
                    <span className="shrink-0">
                      <Badge variant={ACTION_BADGE[entry.action] ?? 'default'}>
                        {entry.action}
                      </Badge>
                    </span>
                    <span className="font-medium text-gray-800 w-40 shrink-0">
                      {entry.table_name}
                    </span>

                    {/* Record ID — truncated with full UUID tooltip.
                        Using span+role rather than <button> to avoid invalid nested button HTML. */}
                    <span className="shrink-0">
                      {entry.record_id ? (
                        <span
                          role="button"
                          tabIndex={0}
                          title={entry.record_id}
                          className="font-mono text-xs text-blue-600 underline hover:text-blue-800 cursor-pointer"
                          onClick={(e) => handleRecordIdClick(e, entry.record_id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ')
                              handleRecordIdClick(e, entry.record_id);
                          }}
                        >
                          {entry.record_id.slice(0, 8)}…
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </span>

                    {/* Changed by */}
                    <span
                      className={`text-sm ${
                        isDirectDbAccess(entry) ? 'text-amber-600 font-medium' : 'text-gray-500'
                      }`}
                    >
                      {changedByLabel(entry)}
                    </span>
                  </button>

                  {/* Expanded diff */}
                  {expanded && <DiffView oldData={entry.old_data} newData={entry.new_data} />}
                </div>
              );
            })}
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            onPage={(p) => dispatch({ type: 'SET_PAGE', page: p })}
            onPageSize={(ps) => dispatch({ type: 'SET_PAGE_SIZE', pageSize: ps })}
          />
        </>
      )}
    </div>
  );
}

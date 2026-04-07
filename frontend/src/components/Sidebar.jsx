// src/components/Sidebar.jsx
import React, { useContext, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { UserContext } from '../context/UserContext';

const ADMIN_ROLES = new Set(['Admin', 'SystemAdmin']);

const NAV_ITEMS = [
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: (
      <svg
        className="w-5 h-5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
        />
      </svg>
    ),
    implemented: true,
  },
  {
    label: 'Connections',
    path: '/connections',
    icon: (
      <svg
        className="w-5 h-5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
      </svg>
    ),
    implemented: true,
  },
  {
    label: 'Users',
    path: '/users',
    icon: (
      <svg
        className="w-5 h-5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17 20h5v-2a4 4 0 00-5-3.87M9 20H4v-2a4 4 0 015-3.87m6-4a4 4 0 11-8 0 4 4 0 018 0zm6 4a2 2 0 100-4 2 2 0 000 4zM3 16a2 2 0 100-4 2 2 0 000 4z"
        />
      </svg>
    ),
    implemented: true,
  },
  {
    label: 'Saved Queries',
    path: '/queries',
    icon: (
      <svg
        className="w-5 h-5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    ),
    implemented: true,
  },
  {
    label: 'SMTP Settings',
    path: '/settings/smtp',
    icon: (
      <svg
        className="w-5 h-5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
        />
      </svg>
    ),
    implemented: true,
    adminOnly: true,
  },
  {
    label: 'Audit Log',
    path: '/audit',
    icon: (
      <svg
        className="w-5 h-5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
        />
      </svg>
    ),
    implemented: true,
  },
];

const BASE_ITEM = 'flex items-center gap-3 px-3 py-2 mx-2 rounded transition-colors text-sm';
const ACTIVE_ITEM = 'bg-gray-700 text-white';
const INACTIVE_ITEM = 'text-gray-400 hover:bg-gray-800 hover:text-white';
const DISABLED_ITEM = 'text-gray-600 cursor-not-allowed select-none';

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const user = useContext(UserContext);
  const isAdmin = !!user?.roles?.some((r) => ADMIN_ROLES.has(r));
  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside
      className={`flex flex-col bg-gray-900 text-gray-300 transition-all duration-200 shrink-0 ${
        collapsed ? 'w-14' : 'w-56'
      }`}
    >
      {/* Logo / brand */}
      <div className="flex items-center h-14 px-3 border-b border-gray-700 shrink-0">
        {!collapsed && (
          <span className="text-white font-semibold text-sm tracking-wide select-none">
            AdminIT
          </span>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className={`p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors ${
            collapsed ? 'mx-auto' : 'ml-auto'
          }`}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            {collapsed ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            )}
          </svg>
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item) => {
          if (!item.implemented) {
            return (
              <div
                key={item.path}
                title={collapsed ? item.label : undefined}
                className={`${BASE_ITEM} ${DISABLED_ITEM} ${collapsed ? 'justify-center' : ''}`}
              >
                {item.icon}
                {!collapsed && <span>{item.label}</span>}
              </div>
            );
          }

          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/dashboard'}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `${BASE_ITEM} ${isActive ? ACTIVE_ITEM : INACTIVE_ITEM} ${collapsed ? 'justify-center' : ''}`
              }
            >
              {item.icon}
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}

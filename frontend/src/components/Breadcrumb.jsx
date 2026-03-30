// src/components/Breadcrumb.jsx
import React from 'react';
import { Link, useLocation } from 'react-router-dom';

// Map path segments to human-readable labels.
const SEGMENT_LABELS = {
  dashboard: 'Dashboard',
  connections: 'Connections',
  users: 'Users',
  audit: 'Audit Log',
  profile: 'Profile',
  browse: 'Browse',
};

export default function Breadcrumb() {
  const { pathname } = useLocation();

  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  const crumbs = segments.map((seg, i) => {
    const path = '/' + segments.slice(0, i + 1).join('/');
    // Known segments map to human-readable labels. Dynamic segments (e.g. a
    // future connection detail at /connections/<id>) fall back to the raw segment.
    const label = SEGMENT_LABELS[seg] ?? decodeURIComponent(seg);
    const isLast = i === segments.length - 1;

    return { path, label, isLast };
  });

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-gray-500">
      {crumbs.map((crumb, i) => (
        <React.Fragment key={crumb.path}>
          {i > 0 && (
            <svg
              className="w-3 h-3 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          )}
          {crumb.isLast ? (
            <span className="text-gray-800 font-medium">{crumb.label}</span>
          ) : (
            <Link to={crumb.path} className="hover:text-gray-700 transition-colors">
              {crumb.label}
            </Link>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

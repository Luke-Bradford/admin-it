// src/components/ui/Badge.jsx
import React from 'react';

const VARIANTS = {
  default: 'bg-gray-100 text-gray-600',
  blue: 'bg-brand-100 text-brand-700',
  green: 'bg-success-100 text-success-700',
  yellow: 'bg-warning-100 text-warning-700',
  red: 'bg-danger-100 text-danger-700',
  purple: 'bg-purple-100 text-purple-700',
};

export default function Badge({ variant = 'default', className = '', children }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

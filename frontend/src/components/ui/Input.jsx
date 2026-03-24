// src/components/ui/Input.jsx
import React from 'react';

const BASE =
  'w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500';

export default function Input({ className = '', ...props }) {
  return <input className={`${BASE} ${className}`} {...props} />;
}

export function Select({ className = '', children, ...props }) {
  return (
    <select className={`${BASE} ${className}`} {...props}>
      {children}
    </select>
  );
}

// src/components/ui/Button.jsx
import React from 'react';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none';

const VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 focus:ring-brand-500',
  secondary: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:ring-brand-500',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 focus:ring-danger-500',
  ghost: 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus:ring-brand-500',
};

const SIZES = {
  sm: 'px-3 py-1.5',
  md: 'px-4 py-2',
  lg: 'px-5 py-2.5',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}) {
  return (
    <button className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`} {...props}>
      {children}
    </button>
  );
}

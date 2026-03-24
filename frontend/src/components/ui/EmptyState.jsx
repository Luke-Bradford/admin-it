// src/components/ui/EmptyState.jsx
import React from 'react';

export default function EmptyState({ message, action }) {
  return (
    <div className="py-16 text-center">
      <p className="text-sm text-gray-400 mb-1">{message}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

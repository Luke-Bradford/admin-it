// src/components/Layout.jsx
// Passthrough wrapper used by App.jsx route definitions. Previously rendered a
// legacy Header component; that has been removed — each page now owns its own
// layout. This component is kept to avoid touching App.jsx in this PR.
import React from 'react';

export default function Layout({ children }) {
  return <>{children}</>;
}

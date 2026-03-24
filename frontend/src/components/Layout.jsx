// src/components/Layout.jsx
// Minimal wrapper used by the setup route. The setup page manages its own
// full-page layout and no longer needs a shared header.
import React from 'react';

export default function Layout({ children }) {
  return <>{children}</>;
}

// src/components/Layout.jsx
import React from 'react';
import Header from './Header';

export default function Layout({ children }) {
  return (
    <div className="app-container">
      <Header />
      <main className="page-content">
        {children}
      </main>
    </div>
  );
}

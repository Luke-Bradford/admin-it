// src/App.jsx
import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import SetupPage from './pages/SetupPage.jsx';
import LoginPage from './pages/LoginPage.jsx';

function HomeLoader() {
  const [status, setStatus] = useState({ loading: true });

  useEffect(() => {
    fetch('/api/setup')
      .then((r) => r.json())
      .then((json) => setStatus({ loading: false, configured: json.configured }))
      .catch(() => setStatus({ loading: false, configured: false }));
  }, []);

  if (status.loading) return <div>Loading…</div>;
  return status.configured ? (
    <Navigate to="/manage" replace /> // or "/" or whatever your main UI is
  ) : (
    <Navigate to="/setup" replace />
  );
}

export default function App() {
  return (
    <Routes>
      {/* On /, decide where to go based on config */}
      <Route path="/" element={<HomeLoader />} />

      {/* your fully‐wired setup page */}
      <Route path="/setup" element={<SetupPage />} />

      <Route path="/login" element={<LoginPage />} />

      {/* once set up, you might build out /manage or /dashboard */}
      <Route path="/manage" element={<div>…your main UI…</div>} />

      {/* catch all → back to HomeLoader */}
      <Route path="*" element={<HomeLoader />} />
    </Routes>
  );
}

// src/App.jsx
import React, { useState, useEffect } from 'react';
import { UserContext } from './context/UserContext';
import { Routes, Route, Navigate } from 'react-router-dom';
import SetupPage from './pages/SetupPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RequireAuth from './components/RequireAuth';
import Dashboard from './pages/Dashboard';
import Layout from './components/Layout';
import ProtectedSetupRoute from './components/ProtectedSetupRoute';

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
    <Navigate to="/dashboard" replace /> // or "/" or whatever your main UI is
  ) : (
    <Navigate to="/setup" replace />
  );
}

export default function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => setUser(data))
      .catch(() => {
        localStorage.removeItem('token');
        setUser(null);
      });
  }, []);
  return (
    <UserContext.Provider value={user}>
      <Routes>
        <Route path="/" element={<HomeLoader />} />
        <Route
          path="/setup"
          element={
            <ProtectedSetupRoute>
              <Layout>
                <SetupPage />
              </Layout>
            </ProtectedSetupRoute>
          }
        />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <Layout>
                <Dashboard />
              </Layout>
            </RequireAuth>
          }
        />
        <Route path="*" element={<HomeLoader />} />
      </Routes>
    </UserContext.Provider>
  );
}

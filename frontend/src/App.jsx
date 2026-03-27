// src/App.jsx
import React, { useState, useEffect } from 'react';
import { UserContext } from './context/UserContext';
import { Routes, Route, Navigate } from 'react-router-dom';
import SetupPage from './pages/SetupPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RequireAuth from './components/RequireAuth';
import Dashboard from './pages/Dashboard';
import ConnectionsPage from './pages/ConnectionsPage';
import UsersPage from './pages/UsersPage';
import ProfilePage from './pages/ProfilePage';
import Layout from './components/Layout';
import AppShell from './components/AppShell';
import ProtectedSetupRoute from './components/ProtectedSetupRoute';
import { isSetupComplete } from './utils/setupStatus';

function HomeLoader() {
  // null = loading, true = fully complete, false = setup still needed
  const [complete, setComplete] = useState(null);

  useEffect(() => {
    isSetupComplete()
      .then(setComplete)
      .catch(() => setComplete(false));
  }, []);

  if (complete === null) return <div>Loading…</div>;
  return complete ? <Navigate to="/dashboard" replace /> : <Navigate to="/setup" replace />;
}

function ComingSoon({ title }) {
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-gray-400 text-sm">{title} — coming soon</p>
    </div>
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

        {/* Authenticated shell — all routes inside share the sidebar + top bar */}
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <AppShell>
                <Dashboard />
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/connections/*"
          element={
            <RequireAuth>
              <AppShell>
                <ConnectionsPage />
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/users/*"
          element={
            <RequireAuth>
              <AppShell>
                <UsersPage />
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/audit/*"
          element={
            <RequireAuth>
              <AppShell>
                <ComingSoon title="Audit Log" />
              </AppShell>
            </RequireAuth>
          }
        />

        <Route
          path="/profile"
          element={
            <RequireAuth>
              <AppShell>
                <ProfilePage />
              </AppShell>
            </RequireAuth>
          }
        />

        <Route path="*" element={<HomeLoader />} />
      </Routes>
    </UserContext.Provider>
  );
}

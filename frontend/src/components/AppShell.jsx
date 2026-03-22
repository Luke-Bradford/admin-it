// src/components/AppShell.jsx
// Layout for all authenticated pages: sidebar + top bar + scrollable main area.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Breadcrumb from './Breadcrumb';

function TopBar() {
  const navigate = useNavigate();
  const [username, setUsername] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.username) {
        setUsername(payload.username);
      } else {
        // Token valid but no username — clear and send to login.
        localStorage.removeItem('token');
        navigate('/login');
      }
    } catch {
      // Malformed token — clear and redirect.
      localStorage.removeItem('token');
      navigate('/login');
    }
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  return (
    <div className="flex items-center justify-between h-14 px-4 bg-white border-b border-gray-200 shrink-0">
      <Breadcrumb />
      {username && (
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-sm text-gray-600">{username}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function AppShell({ children }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />
        <main className="flex-1 overflow-y-auto bg-gray-50 p-6">{children}</main>
      </div>
    </div>
  );
}

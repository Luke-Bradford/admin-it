// src/components/AppShell.jsx
// Layout for all authenticated pages: sidebar + top bar + scrollable main area.
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Breadcrumb from './Breadcrumb';
import Button from './ui/Button';

function TopBar() {
  const navigate = useNavigate();
  const [username, setUsername] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const parts = token.split('.');
    if (parts.length < 3) {
      localStorage.removeItem('token');
      navigate('/login');
      return;
    }

    try {
      const payload = JSON.parse(atob(parts[1]));
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
    <div className="flex items-center h-14 px-4 bg-white border-b border-gray-200 shrink-0 gap-4">
      <div className="flex-1 min-w-0">
        <Breadcrumb />
      </div>
      {username && (
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="/profile"
            className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            {username}
          </Link>
          <Button variant="ghost" size="sm" type="button" onClick={handleLogout}>
            Sign out
          </Button>
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

// src/pages/LoginPage.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        const { token } = await res.json();
        localStorage.setItem('token', token);

        // Decode and store user info. Guard against a malformed token so a
        // bad server response doesn't produce a misleading network-error message.
        const parts = token.split('.');
        if (parts.length >= 3) {
          try {
            const payload = JSON.parse(atob(parts[1]));
            localStorage.setItem('user', JSON.stringify(payload));
          } catch {
            // Ignore decode failure — token is still stored; UserContext will
            // fetch /api/auth/me on mount and populate user state correctly.
          }
        }

        navigate('/dashboard');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? 'Invalid username or password.');
      }
    } catch {
      setError('Unable to reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
      <div className="w-full max-w-sm">
        {/* Wordmark */}
        <div className="text-center mb-8">
          <span className="text-2xl font-bold text-brand-600 tracking-tight">AdminIT</span>
        </div>

        <form
          onSubmit={handleLogin}
          className="bg-white shadow-sm border border-gray-200 rounded-lg p-8 space-y-5"
        >
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Sign in to your account</h1>
          </div>

          {error && (
            <div className="rounded bg-danger-50 border border-danger-200 px-3 py-2 text-sm text-danger-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <Input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default LoginPage;

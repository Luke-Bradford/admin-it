// src/components/RequireAuth.jsx
import { Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

export default function RequireAuth({ children }) {
  const [checked, setChecked] = useState(false);
  const [valid, setValid] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('Invalid token');
        return r.json();
      })
      .then(() => setValid(true))
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      })
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return <div>Validating session…</div>;

  return valid ? children : <Navigate to="/login" replace />;
}

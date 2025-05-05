// src/components/ProtectedSetupRoute.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ProtectedSetupRoute({ children }) {
  const [allowed, setAllowed] = useState(false);
  const [checked, setChecked] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('token');

    fetch('/api/setup')
      .then((r) => r.json())
      .then((data) => {
        const setupComplete = data.configured;

        if (!setupComplete) {
          setAllowed(true);
        } else if (token) {
          // Call backend instead of decoding JWT directly
          fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          })
            .then((res) => {
              if (!res.ok) throw new Error('Unauthorized');
              return res.json();
            })
            .then((user) => {
              if (user.roles.includes('SystemAdmin')) {
                setAllowed(true);
              } else {
                navigate('/dashboard', { replace: true });
              }
            })
            .catch(() => {
              localStorage.removeItem('token');
              localStorage.removeItem('user');
              navigate('/login', { replace: true });
            });
        } else {
          navigate('/login', { replace: true });
        }
      })
      .catch(() => navigate('/login', { replace: true }))
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return <div>Checking permissions…</div>;

  return allowed ? children : null;
}

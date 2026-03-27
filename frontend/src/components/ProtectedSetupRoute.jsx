// src/components/ProtectedSetupRoute.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isSetupComplete } from '../utils/setupStatus';

export default function ProtectedSetupRoute({ children }) {
  const [allowed, setAllowed] = useState(false);
  const [checked, setChecked] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function check() {
      try {
        const complete = await isSetupComplete();

        if (!complete) {
          // One or more setup steps are still pending — allow access to /setup
          // without requiring authentication (the user has no credentials yet).
          setAllowed(true);
          return;
        }

        // All three steps are done. Only a SystemAdmin may re-enter /setup.
        const token = localStorage.getItem('token');
        if (!token) {
          navigate('/login', { replace: true });
          return;
        }

        const meRes = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!meRes.ok) throw new Error('Unauthorized');
        const user = await meRes.json();

        if (user.roles.includes('SystemAdmin')) {
          setAllowed(true);
        } else {
          navigate('/dashboard', { replace: true });
        }
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/login', { replace: true });
      } finally {
        setChecked(true);
      }
    }

    check();
  }, [navigate]);

  if (!checked) return <div>Checking permissions…</div>;

  return allowed ? children : null;
}

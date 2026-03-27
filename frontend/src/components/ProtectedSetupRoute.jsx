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
      // Phase 1: check setup completion status — no token involved yet.
      // On network failure here, fall through to /login but do NOT clear the
      // token: the user may have a valid session and the failure is transient.
      let complete;
      try {
        complete = await isSetupComplete();
      } catch {
        navigate('/login', { replace: true });
        setChecked(true);
        return;
      }

      if (!complete) {
        // One or more setup steps are still pending — allow access to /setup
        // without requiring authentication (the user has no credentials yet).
        setAllowed(true);
        setChecked(true);
        return;
      }

      // Phase 2: setup is fully complete. Only a SystemAdmin may re-enter /setup.
      // Token errors here mean the token is invalid — safe to clear.
      const token = localStorage.getItem('token');
      if (!token) {
        navigate('/login', { replace: true });
        setChecked(true);
        return;
      }

      try {
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
        // /api/auth/me failed — the token is invalid, safe to clear.
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

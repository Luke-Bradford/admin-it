// src/pages/Dashboard.jsx
import React, { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserContext } from '../context/UserContext';
import { authHeader } from '../utils/auth';
import { Card, CardBody, Spinner } from '../components/ui';

function StatCard({ label, value, loading, linkTo, linkLabel }) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">{label}</p>
        {loading ? (
          <Spinner className="w-5 h-5" />
        ) : (
          <p className="text-3xl font-bold text-gray-900">{value}</p>
        )}
        {linkTo && !loading && (
          <Link
            to={linkTo}
            className="mt-3 inline-block text-sm text-brand-600 hover:text-brand-800 transition-colors"
          >
            {linkLabel} →
          </Link>
        )}
      </CardBody>
    </Card>
  );
}

export default function Dashboard() {
  const user = useContext(UserContext);

  const [connections, setConnections] = useState({ loading: true, count: null });
  const [users, setUsers] = useState({ loading: true, count: null });

  useEffect(() => {
    fetch('/api/connections', { headers: authHeader() })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setConnections({ loading: false, count: data.length }))
      .catch(() => setConnections({ loading: false, count: '—' }));

    fetch('/api/users', { headers: authHeader() })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setUsers({ loading: false, count: data.length }))
      .catch(() => setUsers({ loading: false, count: '—' }));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {user?.username ? `Welcome back, ${user.username}` : 'Dashboard'}
        </h1>
        <p className="mt-1 text-sm text-gray-500">Here's an overview of your AdminIT instance.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <StatCard
          label="Connections"
          value={connections.count}
          loading={connections.loading}
          linkTo="/connections"
          linkLabel="Manage connections"
        />
        <StatCard
          label="Users"
          value={users.count}
          loading={users.loading}
          linkTo="/users"
          linkLabel="Manage users"
        />
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
              Audit Log
            </p>
            <p className="text-sm text-gray-400 mt-3">Coming soon</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

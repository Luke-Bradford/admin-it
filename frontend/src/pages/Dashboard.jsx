// src/pages/Dashboard.jsx
import React from 'react';
import { Card, CardHeader, CardBody } from '../components/ui';

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>Connections</CardHeader>
          <CardBody>
            <p className="text-sm text-gray-600">View and manage database connections.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>Users</CardHeader>
          <CardBody>
            <p className="text-sm text-gray-600">Manage user access and roles.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>Logs</CardHeader>
          <CardBody>
            <p className="text-sm text-gray-600">See system and audit logs.</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

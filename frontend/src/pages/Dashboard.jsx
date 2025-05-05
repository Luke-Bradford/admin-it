// src/pages/Dashboard.jsx
import React from "react";

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-4 bg-white shadow rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Connections</h2>
          <p className="text-gray-600">View and manage database connections.</p>
        </div>

        <div className="p-4 bg-white shadow rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Users</h2>
          <p className="text-gray-600">Manage user access and roles.</p>
        </div>

        <div className="p-4 bg-white shadow rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Logs</h2>
          <p className="text-gray-600">See system and audit logs.</p>
        </div>
      </div>

      <div className="mt-8 p-4 bg-white rounded shadow">
        <p className="text-sm text-gray-500">
          Logged in as <strong>{localStorage.getItem("token") ? "Authenticated User" : "Guest"}</strong>
        </p>
      </div>
    </div>
  );
}

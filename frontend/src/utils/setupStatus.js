// src/utils/setupStatus.js
//
// Shared helper that determines whether the three-step setup wizard is fully
// complete.  Used by HomeLoader and ProtectedSetupRoute so both apply the same
// definition of "setup complete" rather than each inspecting only the config.
//
// Returns true if all three steps are done:
//   1. Connection config saved  (GET /api/setup        → configured=true)
//   2. Schema deployed          (GET /api/setup/deploy-status → deployed=true)
//   3. Admin user created       (GET /api/setup/admin-status  → present=true)
//
// Returns false if any step is incomplete.
// Throws on any non-ok HTTP response so the caller can handle errors.

export async function isSetupComplete() {
  const setupRes = await fetch('/api/setup');
  if (!setupRes.ok) throw new Error('Failed to check setup status.');
  const setup = await setupRes.json();
  if (!setup.configured) return false;

  const deployRes = await fetch('/api/setup/deploy-status');
  if (!deployRes.ok) throw new Error('Failed to check schema deployment status.');
  const deploy = await deployRes.json();
  if (!deploy.deployed) return false;

  const adminRes = await fetch('/api/setup/admin-status');
  if (!adminRes.ok) throw new Error('Failed to check admin user status.');
  const admin = await adminRes.json();
  return !!admin.present;
}

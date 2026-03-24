// src/utils/auth.js
// Shared auth helpers used across all authenticated page components.

export function authHeader() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

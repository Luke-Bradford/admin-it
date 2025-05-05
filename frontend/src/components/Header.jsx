// src/components/Header.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import './Header.css';

export default function Header() {
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  let username = null;

  try {
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      username = payload.username;
    }
  } catch {
    // If token is corrupted, force logout
    localStorage.removeItem("token");
    navigate("/login");
  }

  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/login");
  };

  return (
    <header className="main-header">
      <div className="header-title">AdminIT</div>
      {username && (
        <div className="header-user">
          <span className="header-username">{username}</span>
          <button className="logout-button" onClick={handleLogout}>Logout</button>
        </div>
      )}
    </header>
  );
}

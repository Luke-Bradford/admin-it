// frontend/src/pages/HomePage.jsx

import React from 'react';
import { Navigate } from 'react-router-dom';

export default function HomePage() {
  // redirect to Setup if you want
  return <Navigate to="/setup" replace />;

  // OR render something else:
  // return <div>Welcome to Admin IT! Go to <a href="/setup">Setup</a></div>;
}

import { useState } from 'react';

export default function Setup() {
  const [formData, setFormData] = useState({
    db_host: '',
    db_port: '1433',
    db_user: '',
    db_password: '',
    db_name: '',
    schema: 'adm',
  });

  const [response, setResponse] = useState(null);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      const res = await fetch('http://localhost:8000/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      setResponse(data);
    } catch (error) {
      setResponse({ error: error.message });
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '500px', margin: '0 auto' }}>
      <h1>Setup Database Connection</h1>
      <form onSubmit={handleSubmit}>
        <input name="db_host" placeholder="Host" onChange={handleChange} required />
        <input name="db_port" placeholder="Port" value={formData.db_port} onChange={handleChange} required />
        <input name="db_user" placeholder="User" onChange={handleChange} required />
        <input name="db_password" placeholder="Password" type="password" onChange={handleChange} required />
        <input name="db_name" placeholder="Database Name" onChange={handleChange} required />
        <input name="schema" placeholder="Schema" value={formData.schema} onChange={handleChange} required />
        <button type="submit">Submit</button>
      </form>

      {response && (
        <pre style={{ marginTop: '1rem', background: '#eee', padding: '1rem' }}>
          {JSON.stringify(response, null, 2)}
        </pre>
      )}
    </div>
  );
}

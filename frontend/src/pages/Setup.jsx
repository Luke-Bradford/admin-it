import { useState } from 'react';
import axios from 'axios';

const Setup = () => {
  const [formData, setFormData] = useState({
    db_host: '',
    db_port: '1433',
    db_user: '',
    db_password: '',
    db_name: '',
    schema: 'adm',
    odbc_driver: 'ODBC Driver 17 for SQL Server', // default
  });

  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async () => {
    try {
      const res = await axios.post('http://localhost:8000/setup', formData);
      setMessage(res.data.message || 'Setup successful.');
    } catch (err) {
      setMessage(err.response?.data?.detail || 'Setup failed.');
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage('Testing...');
    try {
      const res = await axios.post('http://localhost:8000/test-connection', formData);
      setMessage(res.data.message || 'Connection succeeded.');
    } catch (err) {
      setMessage(err.response?.data?.detail || 'Test failed.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <h2>Database Setup</h2>
      <div>
        <input name="db_host" placeholder="DB Host" onChange={handleChange} />
        <input
          name="db_port"
          placeholder="DB Port"
          value={formData.db_port}
          onChange={handleChange}
        />
        <input name="db_user" placeholder="DB User" onChange={handleChange} />
        <input
          name="db_password"
          placeholder="DB Password"
          type="password"
          onChange={handleChange}
        />
        <input name="db_name" placeholder="DB Name" onChange={handleChange} />
        <input name="schema" placeholder="Schema" value={formData.schema} onChange={handleChange} />

        <select name="odbc_driver" value={formData.odbc_driver} onChange={handleChange}>
          <option value="ODBC Driver 17 for SQL Server">ODBC Driver 17 for SQL Server</option>
          <option value="ODBC Driver 18 for SQL Server">ODBC Driver 18 for SQL Server</option>
          <option value="ODBC Driver 11 for SQL Server">ODBC Driver 11 for SQL Server</option>
        </select>

        <div style={{ marginTop: '1rem' }}>
          <button onClick={handleTest} disabled={testing}>
            Test Connection
          </button>
          <button onClick={handleSubmit}>Submit</button>
        </div>
        <p>{message}</p>
      </div>
    </div>
  );
};

export default Setup;

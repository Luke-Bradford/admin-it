# admin-it

Self-hosted database admin panel with audit logs.

---

## Getting Started

### Requirements

- Python 3.9 or higher
- [Git for Windows](https://git-scm.com/download/win)
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

---

## Setup Instructions

1. **Clone the repository**

    ```bash
    git clone https://github.com/yourusername/admin-it.git
    cd admin-it
    ```

2. **Create and activate a virtual environment**

    ```bash
    # Create virtual environment
    python -m venv venv

    # Activate on Windows
    .\venv\Scripts\activate

    # Activate on Mac/Linux
    source venv/bin/activate
    ```

3. **Upgrade pip**

    ```bash
    python -m pip install --upgrade pip
    ```

4. **Install backend requirements**

    ```bash
    pip install -r backend/requirements.txt
    ```

5. **Run the backend server**

    ```bash
    uvicorn backend.app.main:app --reload
    ```

    Server will be available at:  
    http://127.0.0.1:8000

---

## Project Structure

```
/admin-it
  /backend
    /app
      main.py
    requirements.txt
  /frontend
    (coming soon)
README.md
```

---

## Additional Notes

- If you encounter an error about missing C++ build tools when installing dependencies, install the [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
- For database connections (SQL Server initially), ensure local or remote access credentials are configured.
- Development is currently on the `main` branch; feature work should use dedicated branches.

---

## License

This project is licensed under the MIT License - see the LICENSE file for details.

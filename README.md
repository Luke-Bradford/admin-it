# admin-it

![Frontend Quality Check](https://github.com/Luke-Bradford/admin-it/actions/workflows/frontend-check.yml/badge.svg)

Self-hosted database admin panel with audit logs.

---

## 🚀 Getting Started

### Requirements

- Python 3.9 or higher
- Node.js 20 or higher
- Git for Windows
- Microsoft C++ Build Tools (for Python dependency compilation)

---

## ⚙️ Development Environment Setup

Before working with the codebase, ensure your system is ready:

- Install Python 3.9 or later.
- Install Node.js 20.x or later (includes npm).
- Install Git.
- Install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).

---

## 🔧 Backend Setup (FastAPI)

1. **Clone the repository**

    ```bash
    git clone https://github.com/Luke-Bradford/admin-it.git
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

    Backend will be available at:  
    [http://127.0.0.1:8000](http://127.0.0.1:8000)

---

## 🌐 Frontend Setup (React + Vite)

1. **Navigate to frontend folder**

    ```bash
    cd frontend
    ```

2. **Install frontend dependencies**

    ```bash
    npm install
    ```

3. **Available frontend commands**

    ```bash
    npm run dev       # Start local frontend server (http://localhost:5173)
    npm run lint      # Check code formatting and issues
    npm run format    # Auto-format code using Prettier
    npm run build     # Create production-ready build
    npm run preview   # Preview production build
    ```

    Frontend will be available at:  
    [http://localhost:5173](http://localhost:5173)

---

## 🛠️ Running Backend and Frontend Together

- Open **two terminal windows**:
  - One terminal: run the backend (`uvicorn backend.app.main:app --reload`)
  - Another terminal: run the frontend (`npm run dev` inside `/frontend`)

This allows you to work on both server and client locally, with auto-reload enabled.

---

## 🧹 Troubleshooting

- **Microsoft Build Tools Error**  
  Install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) if `pip install` fails.

- **Missing uvicorn / fastapi / node modules**  
  Ensure the correct virtual environment is activated and all `pip install` or `npm install` commands are completed.

- **Stuck npm install**  
  Cancel and rerun `npm install` if it appears frozen — some first-time Vite setups can delay on Windows.

- **Lint or Format Errors**  
  Run `npm run lint` or `npm run format` to clean code before pushing changes.

---

## Project Structure

```
/admin-it
  /backend
    /app
      main.py
    requirements.txt
    .gitignore
  /frontend
    /src
      App.jsx
      main.jsx
    package.json
    .gitignore
    .prettierrc
    .eslintrc.json
    .editorconfig
  /.github
    /workflows
      frontend-check.yml
  README.md

```

---

## 📋 Additional Notes

- Development work is done in feature branches; `main` remains stable.
- Pull requests will trigger automated linting and formatting checks.
- Backend is initially SQL Server-focused but architecture is extendable.

---

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.
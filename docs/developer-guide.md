# Developer Setup Guide (Manual)

---

## 📋 Requirements

- Python 3.9 or higher (ensure added to PATH)
- Node.js 20 or higher (https://nodejs.org/en)
- Git
- Microsoft C++ Build Tools (for Python dependency compilation)

---

## ⚙️ Backend Setup (FastAPI)

1. **Clone the repository**

    ```bash
    git clone https://github.com/Luke-Bradford/admin-it.git
    cd admin-it
    ```

2. **Create and activate a virtual environment**

    Any issues activating, you may need to enable running scripts
    ```bash
    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
    ```

    Continue with install
    ```bash
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
    cd backend
    uvicorn app.main:app --reload
    ```

    Available at: [http://127.0.0.1:8000](http://127.0.0.1:8000)

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

---

## 🛠️ Running Backend and Frontend Together

- Open **two terminal windows**:
  - One terminal: run the backend (`uvicorn backend.app.main:app --reload`)
  - Another terminal: run the frontend (`npm run dev` inside `/frontend`)

---

## 🧹 Troubleshooting

- **Microsoft Build Tools Error**  
  Install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) if `pip install` fails.

- **Missing uvicorn / fastapi / node modules**  
  Ensure virtual environment is activated and all dependencies are installed.

- **Stuck npm install**  
  Cancel and rerun `npm install` if it freezes. First-time Vite setups on Windows sometimes lag.

- **Lint or Format Errors**  
  Run `npm run lint` or `npm run format` before pushing changes.


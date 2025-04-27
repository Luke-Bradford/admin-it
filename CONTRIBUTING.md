# Contributing to Admin-IT

First off, thank you for considering contributing to Admin-IT!  
Your help is what makes this project strong and sustainable.

The following guidelines ensure a clean, consistent workflow for everyone involved.

---

## 🚀 How to Contribute

1. **Fork the repository**  
2. **Create a new feature branch**  
   - Use descriptive branch names:  
     - `feature/user-authentication`
     - `bugfix/database-connection-timeout`
3. **Commit your changes**  
   - Write clear, focused commit messages.  
     Example:  
     ```text
     Fix: Correct table relationship handling for audit logs
     ```
4. **Push your branch**
5. **Open a Pull Request (PR) against the `main` branch**  
   - Include a clear description of *what* you changed and *why*.

---

## 🧹 Code Style and Standards

**Backend (Python - FastAPI)**:
- Follow **PEP8** standards.
- Use clear, descriptive naming for all variables, functions, and files.
- Virtual environment (`venv`) usage is mandatory.
- Consistent formatting is encouraged (e.g., use `black`, `flake8` locally if you want stricter checking).

**Frontend (React + Vite)**:
- Follow [Airbnb React/JSX Style Guide](https://github.com/airbnb/javascript/tree/master/react) principles.
- **Prettier** and **ESLint** are preconfigured:
  - Format your code using:
    ```bash
    npm run format
    ```
  - Check linting issues before committing:
    ```bash
    npm run lint
    ```

- **Do not disable ESLint rules unless absolutely necessary** (and explain if you do).

---

## 📋 Pull Request Requirements

- PRs must **build and run cleanly** (no runtime errors, no broken imports).
- Backend: FastAPI server must start without errors.
- Frontend: Vite server must start without errors.
- PRs must **pass automated frontend lint/format checks** (they will run on GitHub automatically).
- Keep PRs **focused** — one feature or fix per PR.
- Update documentation (README.md, CONTRIBUTING.md) if your changes require it.

---

## 🛠️ Environment Setup

**Backend Setup**:
```bash
# In the project root
python -m venv venv
.\venv\Scripts\activate  # Windows
source venv/bin/activate # Mac/Linux
python -m pip install --upgrade pip
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload
```

**Frontend Setup**:
```bash
# In the frontend folder
npm install
npm run dev
```

---

## 🧹 Before You Commit

1. Make sure backend and frontend servers run cleanly.
2. Run frontend lint check:
    ```bash
    npm run lint
    ```
3. Auto-format if necessary:
    ```bash
    npm run format
    ```
4. Verify there are no new errors introduced.

---

## 🧠 Communication

- Open an Issue for:
  - Reporting bugs
  - Suggesting improvements
  - Proposing larger changes
- Keep discussions **professional**, **direct**, and **solution-focused**.

---

## 📜 License

By contributing, you agree that your code will be licensed under the [MIT License](LICENSE).

---

Thank you for your contribution and for making Admin-IT better!

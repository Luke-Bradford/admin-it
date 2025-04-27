# Contributing to Admin-IT

First off, thank you for considering contributing to Admin-IT!  
Your help is what makes this project strong and sustainable.

The following guidelines help ensure a smooth workflow for everyone involved.

---

## 🚀 How to Contribute

1. **Fork the repository**  
2. **Create a new feature branch**  
   - Name it descriptively:  
     `feature/user-authentication` or `bugfix/database-connection-timeout`
3. **Commit your changes**  
   - Write clear, concise commit messages.
   - Example: `Fix: Correct table relationship handling for audit logs`
4. **Push your branch**  
5. **Open a Pull Request (PR) against the `main` branch**  
   - Include a clear description of what you changed and why.

---

## 🧹 Code Style

- Follow **Python best practices** (PEP8).
- Use **clear and self-explanatory naming** for variables, functions, and files.
- Keep changes **focused** — **one PR = one logical change**.
- Format code consistently (use tools like `black` if needed).

---

## 📋 Pull Request Requirements

- The PR must **build and run cleanly** (no broken imports, no crashes).
- If the PR adds new functionality, please **add/update documentation** where appropriate.
- Tests are **encouraged** but **not mandatory yet** (formal test suite to be added later).

---

## 🛠️ Environment Setup (Summary)

- Python 3.9+ required.
- Virtual environment recommended.
- Install requirements:
  ```bash
  pip install -r backend/requirements.txt
  ```
- Run development server:
  ```bash
  uvicorn app.main:app --reload
  ```

---

## 📣 Communication

- Open an Issue if you encounter a problem or have a feature idea.
- Keep discussions **professional**, **direct**, and **solution-focused**.

---

## 📜 License

By contributing, you agree that your code will be licensed under the [MIT License](LICENSE).

---

Thank you for your contribution and for making Admin-IT better! 🙌

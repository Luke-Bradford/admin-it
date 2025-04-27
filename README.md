# admin-it

![Frontend Quality Check](https://github.com/Luke-Bradford/admin-it/actions/workflows/frontend-check.yml/badge.svg)

Self-hosted database admin panel with audit logs.

---

## 🚀 Getting Started

**Requirements:**

- Python 3.9+
- Node.js 20+
- Git
- Docker and Docker Compose (for containerized development)

---

## ⚙️ Quick Development Setup

1. Clone the repository:

    ```bash
    git clone https://github.com/Luke-Bradford/admin-it.git
    cd admin-it
    ```

2. Choose a setup method:
   - **[Manual Developer Setup](./docs/developer-guide.md)** (Python + Node locally)
   - **[Docker Setup](./docs/docker-setup.md)** (Recommended: isolated, clean)

---

## 📂 Project Structure

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
- Pull requests will trigger automated **frontend** linting and formatting checks.
- Backend is initially SQL Server-focused but architecture is extendable.

---

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.
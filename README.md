# admin-it

![CI](https://github.com/Luke-Bradford/admin-it/actions/workflows/ci.yml/badge.svg)

Self-hosted SQL Server admin panel for non-technical users. Engineers wire up connections once; end users browse and interact with data without writing SQL.

---

## Getting Started

**Requirements:**

- Docker and Docker Compose

1. Clone the repo and create your env file:

    ```bash
    git clone https://github.com/Luke-Bradford/admin-it.git
    cd admin-it
    cp .env.example .env
    ```

2. Build and start:

    ```bash
    docker compose build --no-cache
    docker compose up
    ```

3. Open [http://localhost:3000](http://localhost:3000) and follow the setup wizard.

See [docs/docker-setup.md](./docs/docker-setup.md) for full Docker instructions and environment variable reference.

For local development without Docker, see [docs/developer-guide.md](./docs/developer-guide.md).

---

## Stack

- **Backend:** Python 3.11, FastAPI, SQLAlchemy, pyodbc (SQL Server)
- **Frontend:** React 19, Vite, React Router v6
- **Auth:** JWT HS256; roles stored in DB and checked per request
- **CI:** ESLint + Prettier (frontend), Ruff lint + format (backend), Claude PR review

---

## License

MIT

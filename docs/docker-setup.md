# Docker Setup Guide

---

## 📋 Pre-Requisites

- Docker Desktop installed
- Docker Compose plugin available (`docker compose version`)
- Git

---

## 🛠️ Building and Running

1. **Clone the repository**

    ```bash
    git clone https://github.com/Luke-Bradford/admin-it.git
    cd admin-it
    ```

2. **Build containers**

    ```bash
    docker compose build --no-cache
    ```

3. **Start containers**

    ```bash
    docker compose up
    ```

- Backend available at: [http://localhost:8000](http://localhost:8000)
- Frontend available at: [http://localhost:5173](http://localhost:5173)

---

## 🧹 Troubleshooting

### "You installed esbuild for another platform" error

- Cause: node_modules built on Windows, but running inside Linux container
- Solution:
  - Ensure `node_modules/` is listed in `.dockerignore`
  - Inside Dockerfile, do **not copy** `node_modules`
  - Always run `npm install` inside the container (`Dockerfile` handles it)

---

## 🗑️ Reset Containers

If you need a clean start:

```bash
docker compose down --volumes --remove-orphans
docker compose build --no-cache
docker compose up
```

---

## 🔄 Common Refresh Commands

Stop and rebuild after major code changes:

```
docker compose down
docker compose build
docker compose up
```

Rebuild only frontend:

```
docker compose build frontend
docker compose up frontend
```

Rebuild only backend:
```
docker compose build backend
docker compose up backend
```

---

## 🧠 Notes

- Volumes mount your local source code into the container (/app).

- Changes will hot-reload automatically in dev mode.

- Frontend uses Vite (npm run dev internally).

- Backend uses FastAPI/Uvicorn (--reload enabled).

---

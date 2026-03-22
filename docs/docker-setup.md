# Docker Setup Guide

---

## Pre-Requisites

- Docker Desktop installed
- Docker Compose plugin available (`docker compose version`)
- Git

---

## Quickstart

1. **Clone the repository**

    ```bash
    git clone https://github.com/Luke-Bradford/admin-it.git
    cd admin-it
    ```

2. **Create your environment file**

    ```bash
    cp .env.example .env
    ```

    The defaults work for local Docker Compose. Edit `.env` if you need to change CORS origins or the backend URL.

3. **Build containers**

    ```bash
    docker compose build --no-cache
    ```

4. **Start containers**

    ```bash
    docker compose up
    ```

- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend API: [http://localhost:8000](http://localhost:8000)

On first run, open the frontend and follow the setup wizard to configure your SQL Server connection and create the initial admin user.

---

## Windows / WSL2 Users

To run Docker inside a Windows 10/11 host:

1. **Enable Virtualization in BIOS**

2. **Enable WSL2 & Virtual Machine Platform**

    ```powershell
    dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
    ```

3. **Install WSL2**

    ```powershell
    wsl --install --no-distribution
    ```

4. **Restart your machine**

5. **Install Docker Desktop**
   - [Download Docker](https://www.docker.com/products/docker-desktop)
   - Ensure "Use WSL 2 based engine" is checked in settings

6. **Verify Docker works**

    ```powershell
    docker --version
    docker run hello-world
    ```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated list of origins the API accepts requests from |
| `VITE_BACKEND_URL` | `http://backend:8000` | Backend URL the Vite dev server proxies `/api/*` to |

For a deployed instance, set `CORS_ORIGINS` to your frontend's public URL and `VITE_BACKEND_URL` to the resolvable backend address.

---

## Troubleshooting

### "You installed esbuild for another platform" error

- **Cause**: `node_modules` was created on Windows, but you're running inside Linux
- **Solution**: ensure `node_modules/` is in `.dockerignore` and let the Dockerfile handle `npm install`

### Cannot start WSL / Docker

- Check virtualization is enabled in BIOS
- Make sure the "Virtual Machine Platform" feature is enabled
- Try restarting your system and Docker Desktop

---

## Reset Containers

```bash
docker compose down --volumes --remove-orphans
docker compose build --no-cache
docker compose up
```

## Common Refresh Commands

```bash
# Full restart after code changes
docker compose down && docker compose build && docker compose up

# Rebuild only one service
docker compose build frontend && docker compose up frontend
docker compose build backend && docker compose up backend
```

---

## Notes

- Volumes mount local source into the container — changes hot-reload automatically
- Backend uses Uvicorn with `--reload`; frontend uses Vite dev server
- The backend health check (`GET /ping`) must pass before the frontend container starts

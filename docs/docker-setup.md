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

## 🚚 Windows / WSL2 Users

To run Docker inside a Windows 10/11 VM or host:

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

7. (Optional) Install Ubuntu from the Microsoft Store:

    ```powershell
    wsl --list --online
    wsl --install -d Ubuntu
    ```

8. From within WSL:

    ```bash
    docker ps
    ```
    (Should return running containers)

---

## 🚩 Troubleshooting

### "You installed esbuild for another platform" error

- **Cause**: `node_modules` was created on Windows, but you're running inside Linux
- **Solution**:
  - Ensure `node_modules/` is listed in `.dockerignore`
  - Do not copy `node_modules` into Docker image
  - Let `Dockerfile` handle `npm install` inside the container

### Cannot start WSL / Docker

- Check virtualization is enabled in BIOS
- Make sure the "Virtual Machine Platform" feature is enabled
- Try restarting your system and Docker Desktop

---

## 🗑️ Reset Containers

```bash
docker compose down --volumes --remove-orphans
docker compose build --no-cache
docker compose up
```

---

## 🔄 Common Refresh Commands

Stop and rebuild after major code changes:

```bash
docker compose down
docker compose build
docker compose up
```

Rebuild only frontend:

```bash
docker compose build frontend
docker compose up frontend
```

Rebuild only backend:

```bash
docker compose build backend
docker compose up backend
```

---

## 🧠 Notes

- Volumes mount your local source code into the container (`/app`)
- Changes hot-reload automatically in development
- Frontend uses **Vite** (`npm run dev` internally)
- Backend uses **FastAPI** via **Uvicorn** with `--reload` enabled

---


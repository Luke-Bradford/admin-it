# ──────────────────────────────────
# Stage 1: builder (compile wheels)
# ──────────────────────────────────
FROM python:3.11-slim-bookworm AS builder

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# 1) Build-time deps: compilers, headers, ODBC dev libs
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential gcc g++ \
      unixodbc-dev libssl-dev \
      curl gnupg apt-transport-https ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# 2) Microsoft ODBC drivers (Debian 12 / bookworm repo)
# Note: packages.microsoft.com/config/debian/12/prod.list already includes
# [arch=... signed-by=/usr/share/keyrings/microsoft-prod.gpg] — the sed
# substitution is not needed and would break the entry if applied.
RUN curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
      | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
 && curl -fsSL https://packages.microsoft.com/config/debian/12/prod.list \
      > /etc/apt/sources.list.d/mssql-release.list \
 && apt-get update \
 && ACCEPT_EULA=Y apt-get install -y --no-install-recommends \
      msodbcsql17 msodbcsql18 \
 && rm -rf /var/lib/apt/lists/*

# 3) Build wheels for all Python deps
COPY requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir=/app/wheels -r requirements.txt


# ──────────────────────────────────
# Stage 2: runtime (lean!)
# ──────────────────────────────────
FROM python:3.11-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# 4) Runtime deps: ODBC runtime + MS drivers
# Note: packages.microsoft.com/config/debian/12/prod.list already includes
# [arch=... signed-by=/usr/share/keyrings/microsoft-prod.gpg] — no sed needed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      unixodbc libssl3 \
      curl gnupg apt-transport-https ca-certificates \
 && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
      | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
 && curl -fsSL https://packages.microsoft.com/config/debian/12/prod.list \
      > /etc/apt/sources.list.d/mssql-release.list \
 && apt-get update \
 && ACCEPT_EULA=Y apt-get install -y --no-install-recommends \
      msodbcsql17 msodbcsql18 \
 && rm -rf /var/lib/apt/lists/*

# 5) Install Python deps from our prebuilt wheels
COPY --from=builder /app/wheels /wheels
RUN pip install --no-cache /wheels/* \
 && rm -rf /wheels

# 6) Copy application code
COPY ./app ./app

# 7) Run
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000","--reload"]

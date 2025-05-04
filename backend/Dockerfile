# ──────────────────────────────────
# Stage 1: builder (compile wheels)
# ──────────────────────────────────
FROM python:3.9-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# 1) Build-time deps: compilers, headers, ODBC dev libs
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential gcc g++ \
      unixodbc-dev libssl-dev \
      curl gnupg apt-transport-https \
 && rm -rf /var/lib/apt/lists/*

# 2) Microsoft ODBC drivers
RUN curl https://packages.microsoft.com/keys/microsoft.asc | apt-key add - \
 && curl https://packages.microsoft.com/config/debian/10/prod.list \
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
FROM python:3.9-slim

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# 4) Runtime deps: just the ODBC runtime + minimal system libs
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      unixodbc libssl3 \
      curl gnupg apt-transport-https \
 && curl https://packages.microsoft.com/keys/microsoft.asc | apt-key add - \
 && curl https://packages.microsoft.com/config/debian/10/prod.list \
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

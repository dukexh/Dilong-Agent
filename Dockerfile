FROM node:22-alpine3.23 AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
RUN DILONG_BASE=/ npm run build

FROM nginx:alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/dist/ /usr/share/nginx/html/

FROM python:3.13-slim AS backend
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY backend/requirements-runtime.txt ./backend/requirements-runtime.txt
RUN python -m pip install --no-cache-dir -r backend/requirements-runtime.txt
COPY backend/ ./backend/
RUN mkdir -p /app/.dilong-runtime && chown 10001:10001 /app/.dilong-runtime
USER 10001:10001
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "51460", "--workers", "1", "--forwarded-allow-ips", "*"]

# Local Development Setup Guide

This document outlines the step-by-step procedure to configure, migrate, and run the Next.js frontend, FastAPI backend, PostgreSQL database, and Celery background workers concurrently.

---

## 1. System Prerequisites

Ensure your system meets the requirements (Linux/WSL2, Python 3.12, Node.js 20+, PostgreSQL 15+, and Redis).

### Install System Dependencies (Ubuntu/WSL2)
```bash
sudo apt update
sudo apt install -y build-essential python3.12 python3.12-venv python3.12-dev postgresql postgresql-contrib redis-server ffmpeg libsm6 libxext6
```

---

## 2. Environment Variables Configuration

Create the environment files for both components.

### A. FastAPI Backend Environment (`backend/.env`)

Create `backend/.env` with the following contents:

```env
# General Configurations
ENVIRONMENT=development
PROJECT_NAME="AI Media Processor"
SECRET_KEY="generate-a-secure-secret-key-for-local-development"
BACKEND_CORS_ORIGINS=["http://localhost:3000"]

# Database Configuration
# Format: postgresql+psycopg://user:password@host:port/dbname
DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/media_processor"

# Cache & Message Broker (Redis)
REDIS_URL="redis://localhost:6379/0"

# Cloudflare R2 Object Storage Configuration
R2_ACCOUNT_ID="your_cloudflare_account_id_here"
R2_ACCESS_KEY_ID="your_r2_access_key_id_here"
R2_SECRET_ACCESS_KEY="your_r2_secret_access_key_here"
R2_BUCKET_NAME="media-processor-assets-dev"
R2_PUBLIC_DOMAIN="https://pub-media-assets.cloudflare.com"

# AI Model Keys
GEMINI_API_KEY="your_gemini_api_key_here"
```

### B. Next.js Frontend Environment (`frontend/.env.local`)

Create `frontend/.env.local` with the following contents:

```env
# API Gateway Endpoint
NEXT_PUBLIC_API_URL="http://localhost:8000"

# WebSocket Endpoint for Job Tracking
NEXT_PUBLIC_WS_URL="ws://localhost:8000/api/ws"

# Direct Cloudflare R2 Access (For client side uploads if using presigned URLs)
NEXT_PUBLIC_R2_PUBLIC_DOMAIN="https://pub-media-assets.cloudflare.com"
```

---

## 3. Database Initialization & Migrations

Configure PostgreSQL and run migrations to build the tables.

### Setup PostgreSQL Database
Log into your local PostgreSQL instance and create the target database:

```bash
sudo -u postgres psql -c "CREATE DATABASE media_processor;"
sudo -u postgres psql -c "CREATE USER postgres WITH PASSWORD 'postgres';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE media_processor TO postgres;"
```

### Apply Migrations (Alembic)
From the `backend` directory, initialize and run Alembic migrations:

```bash
cd backend
source venv/bin/activate

# Generate migration scripts (if modifying models)
alembic revision --autogenerate -m "initial_schema"

# Apply migrations to the PostgreSQL database
alembic upgrade head
```

---

## 4. Running the Application

For a complete local development run, you must run the following four components concurrently. We recommend opening separate terminal sessions or using a multiplexer like `tmux`.

### Session 1: Redis Service
Start the Redis server (used as Celery's message broker and cache layer):

```bash
sudo service redis-server start
# Or if running manually:
redis-server
```

### Session 2: FastAPI Backend Server
Navigate to the `backend` directory, activate the virtual environment, and run Uvicorn:

```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### Session 3: Celery Background Worker
Run the background worker to handle image manipulation and LLM queries:

```bash
cd backend
source venv/bin/activate
celery -A app.workers.tasks worker --loglevel=info --concurrency=2
```

### Session 4: Next.js Frontend
Navigate to the `frontend` directory, install dependencies, and launch the dev server:

```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser to interact with the application.

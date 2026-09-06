# Golden SaaS Python foundation

This directory contains the initial Flask implementation alongside the existing
Node application. It is intentionally isolated so the current production
runtime is unchanged while the Python version is developed incrementally.
It uses Flask-SQLAlchemy with SQLite by default and Flask-Login for session
authentication.

## Setup

From this directory, create and activate a virtual environment, then install
the application and test dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[test]"
```

On Windows PowerShell, activate the environment with:

```powershell
.\.venv\Scripts\Activate.ps1
```

## Run

```bash
flask --app "app:create_app()" run --debug
```

The initial endpoints are:

- `GET /` - application metadata
- `GET /health` - health check for local development and deployment probes
- `POST /auth/register` - create and sign in a user
- `POST /auth/login` - sign in with email and password
- `POST /auth/logout` - end the current session
- `GET /auth/me` - return the signed-in user
- `GET /api/plans` - list active subscription plans
- `POST /api/checkout` - simulate checkout and activate a plan for the signed-in user
- `POST /checkout` - activate a plan from the dashboard

Set `DATABASE_URL` to use another SQLAlchemy-supported database URL. The
default is `sqlite:///golden_saas.db`.

The initial catalog contains `free` (Gratuito) and `premium` (Premium) plans.
New users start on the free plan. The checkout endpoints intentionally simulate
successful activation and do not process real payments.

The API foundation also includes a `Matrix` with up to three `Branch` records,
branch-scoped customers, motorcycles marked as `new` or `used`, and purchase or
sale transactions. All of these management endpoints require an authenticated
session and return JSON.

## Test

```bash
pytest
```

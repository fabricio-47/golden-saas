def test_index_returns_application_metadata(client):
    response = client.get("/")

    assert response.status_code == 200
    assert response.content_type == "application/json"
    assert response.get_json() == {
        "name": "Golden SaaS",
        "message": "Python SaaS foundation is running",
    }


def test_health_check_returns_ok(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.get_json() == {"status": "ok"}


def test_unknown_route_returns_not_found(client):
    response = client.get("/missing")

    assert response.status_code == 404


def test_user_can_register_and_access_current_user(client):
    response = client.post(
        "/auth/register",
        json={
            "name": "Ada Lovelace",
            "email": "ADA@example.com",
            "password": "correct horse battery staple",
        },
    )

    assert response.status_code == 201
    assert response.get_json()["user"]["email"] == "ada@example.com"
    assert "password" not in response.get_json()["user"]

    current_user = client.get("/auth/me")
    assert current_user.status_code == 200
    assert current_user.get_json()["user"]["name"] == "Ada Lovelace"


def test_duplicate_email_and_blank_password_are_rejected(client):
    payload = {
        "name": "Ada Lovelace",
        "email": "ada@example.com",
        "password": "secure-password",
    }
    assert client.post("/auth/register", json=payload).status_code == 201

    duplicate = client.post("/auth/register", json=payload)
    assert duplicate.status_code == 409

    blank_password = client.post(
        "/auth/register",
        json={"name": "Grace Hopper", "email": "grace@example.com", "password": "  "},
    )
    assert blank_password.status_code == 400


def test_login_and_logout(client):
    client.post(
        "/auth/register",
        json={
            "name": "Grace Hopper",
            "email": "grace@example.com",
            "password": "secure-password",
        },
    )
    client.post("/auth/logout")

    invalid = client.post(
        "/auth/login",
        json={"email": "grace@example.com", "password": "wrong-password"},
    )
    assert invalid.status_code == 401

    valid = client.post(
        "/auth/login",
        json={"email": "GRACE@example.com", "password": "secure-password"},
    )
    assert valid.status_code == 200


def test_login_page_contains_form_and_register_link(client):
    response = client.get("/login")

    assert response.status_code == 200
    assert b'<form method="post"' in response.data
    assert b'href="/register"' in response.data


def test_register_page_creates_user_and_redirects_to_dashboard(client):
    response = client.post(
        "/register",
        data={
            "name": "Katherine Johnson",
            "email": "katherine@example.com",
            "password": "secure-password",
        },
    )

    assert response.status_code == 302
    assert response.headers["Location"].endswith("/dashboard")

    dashboard = client.get("/dashboard")
    assert dashboard.status_code == 200
    assert b"Katherine" in dashboard.data
    assert b"katherine@example.com" in dashboard.data


def test_dashboard_redirects_guests_to_login(client):
    response = client.get("/dashboard")

    assert response.status_code == 302
    assert "/login?next=%2Fdashboard" in response.headers["Location"]


def test_plans_are_available_and_checkout_activates_premium(client):
    plans = client.get("/api/plans")

    assert plans.status_code == 200
    assert [plan["code"] for plan in plans.get_json()["plans"]] == ["free", "premium"]

    client.post(
        "/auth/register",
        json={
            "name": "Alan Turing",
            "email": "alan@example.com",
            "password": "secure-password",
        },
    )
    checkout = client.post("/api/checkout", json={"plan_code": "premium"})

    assert checkout.status_code == 200
    assert checkout.get_json()["subscription"]["plan"]["name"] == "Premium"

    me = client.get("/auth/me")
    assert me.get_json()["user"]["subscription"]["plan"]["code"] == "premium"


def test_checkout_rejects_unknown_plan(client):
    client.post(
        "/auth/register",
        json={
            "name": "Grace Hopper",
            "email": "grace@example.com",
            "password": "secure-password",
        },
    )
    response = client.post("/api/checkout", json={"plan_code": "enterprise"})

    assert response.status_code == 400
    assert response.get_json()["error"] == "Plano inválido ou indisponível."

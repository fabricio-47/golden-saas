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

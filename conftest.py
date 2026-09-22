import pytest

from app import create_app


@pytest.fixture()
def app():
    return create_app(
        {
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "TESTING": True,
            "SECRET_KEY": "test-secret",
        }
    )


@pytest.fixture()
def client(app):
    return app.test_client()

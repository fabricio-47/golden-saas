"""Flask application factory for the Python SaaS foundation."""

import os

from flask import Flask
from flask_login import LoginManager

from .extensions import db


login_manager = LoginManager()


def create_app(test_config: dict | None = None) -> Flask:
    """Create and configure a Flask application instance."""
    app = Flask(__name__)
    app.config.from_mapping(
        SECRET_KEY=os.getenv("SECRET_KEY", "dev-only-change-me"),
        SQLALCHEMY_DATABASE_URI=os.getenv(
            "DATABASE_URL",
            "sqlite:///golden_saas.db",
        ),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        TESTING=False,
    )

    if test_config:
        app.config.update(test_config)

    os.makedirs(app.instance_path, exist_ok=True)
    db.init_app(app)
    login_manager.init_app(app)
    login_manager.login_view = "login_page"
    login_manager.login_message = "Entre para acessar o dashboard."

    with app.app_context():
        from .models import User

        @login_manager.user_loader
        def load_user(user_id: str):
            return db.session.get(User, int(user_id))

        db.create_all()

    from .routes import register_routes

    register_routes(app)
    return app

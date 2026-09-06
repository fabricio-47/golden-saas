"""HTTP routes for the initial SaaS application."""

from flask import Flask, jsonify, request
from flask_login import current_user, login_required, login_user, logout_user

from .extensions import db
from .models import User

def register_routes(app: Flask) -> None:
    """Register the initial application routes."""

    @app.get("/")
    def index():
        return jsonify(
            name="Golden SaaS",
            message="Python SaaS foundation is running",
        )

    @app.get("/health")
    def health():
        return jsonify(status="ok")

    @app.post("/auth/register")
    def register():
        payload = request.get_json(silent=True) or {}
        name = str(payload.get("name", "")).strip()
        email = str(payload.get("email", "")).strip().lower()
        password = str(payload.get("password", ""))

        if not name or not email or not password.strip():
            return jsonify(error="name, email and password are required"), 400

        if User.query.filter_by(email=email).first():
            return jsonify(error="email is already registered"), 409

        user = User(name=name, email=email)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        login_user(user)
        return jsonify(user=user.to_dict()), 201

    @app.post("/auth/login")
    def login():
        payload = request.get_json(silent=True) or {}
        email = str(payload.get("email", "")).strip().lower()
        password = str(payload.get("password", ""))
        user = User.query.filter_by(email=email).first()

        if user is None or not user.check_password(password):
            return jsonify(error="invalid email or password"), 401

        login_user(user)
        return jsonify(user=user.to_dict())

    @app.post("/auth/logout")
    @login_required
    def logout():
        logout_user()
        return jsonify(message="logged out")

    @app.get("/auth/me")
    @login_required
    def me():
        return jsonify(user=current_user.to_dict())

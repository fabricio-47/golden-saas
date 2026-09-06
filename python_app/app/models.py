"""Database models for the SaaS foundation."""

from datetime import datetime, timezone

from werkzeug.security import check_password_hash, generate_password_hash
from flask_login import UserMixin

from .extensions import db


class User(UserMixin, db.Model):
    """Application user with email/password authentication."""

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    subscription = db.relationship(
        "Subscription",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    created_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "created_at": self.created_at.isoformat(),
            "subscription": self.subscription.to_dict() if self.subscription else None,
        }


class Plan(db.Model):
    """A subscription plan available for activation."""

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(50), unique=True, nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.String(255), nullable=False)
    price_cents = db.Column(db.Integer, nullable=False, default=0)
    active = db.Column(db.Boolean, nullable=False, default=True)
    subscriptions = db.relationship("Subscription", back_populates="plan")

    @property
    def price(self) -> float:
        return self.price_cents / 100

    def to_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "name": self.name,
            "description": self.description,
            "price": self.price,
            "active": self.active,
        }


class Subscription(db.Model):
    """The current plan activation for one user."""

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), unique=True, nullable=False)
    plan_id = db.Column(db.Integer, db.ForeignKey("plan.id"), nullable=False)
    status = db.Column(db.String(30), nullable=False, default="active")
    activated_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    user = db.relationship("User", back_populates="subscription")
    plan = db.relationship("Plan", back_populates="subscriptions")

    def to_dict(self) -> dict[str, object]:
        return {
            "plan": self.plan.to_dict(),
            "status": self.status,
            "activated_at": self.activated_at.isoformat(),
        }

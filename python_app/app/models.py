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


class Matrix(db.Model):
    """Head office that owns up to three branches."""

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    tax_id = db.Column(db.String(30), unique=True, nullable=True, index=True)
    created_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    branches = db.relationship(
        "Branch",
        back_populates="matrix",
        cascade="all, delete-orphan",
        order_by="Branch.id",
    )

    def to_dict(self, include_branches: bool = True) -> dict[str, object]:
        result = {
            "id": self.id,
            "name": self.name,
            "tax_id": self.tax_id,
            "created_at": self.created_at.isoformat(),
        }
        if include_branches:
            result["branches"] = [branch.to_dict(include_matrix=False) for branch in self.branches]
        return result


class Branch(db.Model):
    """Branch belonging to a matrix."""

    id = db.Column(db.Integer, primary_key=True)
    matrix_id = db.Column(db.Integer, db.ForeignKey("matrix.id"), nullable=False, index=True)
    name = db.Column(db.String(160), nullable=False)
    code = db.Column(db.String(30), nullable=False)
    address = db.Column(db.String(255), nullable=True)
    active = db.Column(db.Boolean, nullable=False, default=True)
    matrix = db.relationship("Matrix", back_populates="branches")
    customers = db.relationship("Customer", back_populates="branch")
    motorcycles = db.relationship("Motorcycle", back_populates="branch")
    transactions = db.relationship("MotorcycleTransaction", back_populates="branch")
    __table_args__ = (db.UniqueConstraint("matrix_id", "code", name="uq_branch_matrix_code"),)

    def to_dict(self, include_matrix: bool = True) -> dict[str, object]:
        result = {
            "id": self.id,
            "matrix_id": self.matrix_id,
            "name": self.name,
            "code": self.code,
            "address": self.address,
            "active": self.active,
        }
        if include_matrix:
            result["matrix"] = self.matrix.to_dict(include_branches=False)
        return result


class Customer(db.Model):
    """Customer registered at a branch."""

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey("branch.id"), nullable=False, index=True)
    name = db.Column(db.String(160), nullable=False)
    document = db.Column(db.String(40), nullable=True)
    email = db.Column(db.String(255), nullable=True)
    phone = db.Column(db.String(40), nullable=True)
    branch = db.relationship("Branch", back_populates="customers")
    motorcycles = db.relationship("Motorcycle", back_populates="owner")
    transactions = db.relationship("MotorcycleTransaction", back_populates="customer")

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "branch_id": self.branch_id,
            "name": self.name,
            "document": self.document,
            "email": self.email,
            "phone": self.phone,
        }


class Motorcycle(db.Model):
    """Motorcycle inventory item, either new or used."""

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey("branch.id"), nullable=False, index=True)
    owner_id = db.Column(db.Integer, db.ForeignKey("customer.id"), nullable=True)
    brand = db.Column(db.String(100), nullable=False)
    model = db.Column(db.String(100), nullable=False)
    year = db.Column(db.Integer, nullable=True)
    condition = db.Column(db.String(20), nullable=False)
    chassis_number = db.Column(db.String(100), nullable=True, unique=True)
    price_cents = db.Column(db.Integer, nullable=False, default=0)
    status = db.Column(db.String(20), nullable=False, default="available")
    branch = db.relationship("Branch", back_populates="motorcycles")
    owner = db.relationship("Customer", back_populates="motorcycles")
    transactions = db.relationship("MotorcycleTransaction", back_populates="motorcycle")

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "branch_id": self.branch_id,
            "owner_id": self.owner_id,
            "brand": self.brand,
            "model": self.model,
            "year": self.year,
            "condition": self.condition,
            "chassis_number": self.chassis_number,
            "price": self.price_cents / 100,
            "status": self.status,
        }


class MotorcycleTransaction(db.Model):
    """Purchase or sale of a motorcycle at a branch."""

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey("branch.id"), nullable=False, index=True)
    motorcycle_id = db.Column(db.Integer, db.ForeignKey("motorcycle.id"), nullable=False)
    customer_id = db.Column(db.Integer, db.ForeignKey("customer.id"), nullable=True)
    transaction_type = db.Column(db.String(20), nullable=False)
    amount_cents = db.Column(db.Integer, nullable=False)
    occurred_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    branch = db.relationship("Branch", back_populates="transactions")
    motorcycle = db.relationship("Motorcycle", back_populates="transactions")
    customer = db.relationship("Customer", back_populates="transactions")

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "branch_id": self.branch_id,
            "motorcycle_id": self.motorcycle_id,
            "customer_id": self.customer_id,
            "transaction_type": self.transaction_type,
            "amount": self.amount_cents / 100,
            "occurred_at": self.occurred_at.isoformat(),
        }

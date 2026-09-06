"""JSON API and HTML routes for the initial SaaS application."""

from datetime import datetime, timezone
from uuid import uuid4

from flask import Flask, flash, jsonify, redirect, render_template, request, url_for
from flask_login import current_user, login_required, login_user, logout_user

from .extensions import db
from .models import (
    Branch,
    Customer,
    Matrix,
    Motorcycle,
    MotorcycleTransaction,
    ElectronicInvoice,
    Part,
    PartTransaction,
    PriceTable,
    PriceTableEntry,
    Plan,
    Subscription,
    Supplier,
    Carrier,
    User,
)

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

    @app.get("/login")
    def login_page():
        if current_user.is_authenticated:
            return redirect(url_for("dashboard"))
        return render_template("login.html")

    @app.post("/login")
    def login_form():
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        user = User.query.filter_by(email=email).first()

        if user is None or not user.check_password(password):
            flash("E-mail ou senha inválidos.", "error")
            return render_template("login.html"), 401

        login_user(user)
        return redirect(url_for("dashboard"))

    @app.get("/register")
    def register_page():
        if current_user.is_authenticated:
            return redirect(url_for("dashboard"))
        return render_template("register.html")

    @app.post("/register")
    def register_form():
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        if not name or not email or not password.strip():
            flash("Preencha nome, e-mail e senha.", "error")
            return render_template("register.html"), 400

        if User.query.filter_by(email=email).first():
            flash("Este e-mail já está cadastrado.", "error")
            return render_template("register.html"), 409

        user = User(name=name, email=email)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        activate_subscription(user, "free")
        login_user(user)
        return redirect(url_for("dashboard"))

    @app.get("/dashboard")
    @login_required
    def dashboard():
        return render_template(
            "dashboard.html",
            user=current_user,
            plans=Plan.query.filter_by(active=True).order_by(Plan.price_cents).all(),
        )

    @app.get("/inventory/motorcycles")
    @login_required
    def motorcycle_inventory():
        branches = Branch.query.filter_by(active=True).order_by(Branch.name).all()
        selected_branch_id = request.args.get("branch_id", type=int)
        branch = db.session.get(Branch, selected_branch_id) if selected_branch_id else None
        if branch is None and branches:
            branch = branches[0]
        motorcycles = (
            Motorcycle.query.filter_by(branch_id=branch.id, status="available").all()
            if branch
            else []
        )
        customers = Customer.query.filter_by(branch_id=branch.id).order_by(Customer.name).all() if branch else []
        return render_template(
            "motorcycle_inventory.html",
            branches=branches,
            branch=branch,
            motorcycles=motorcycles,
            customers=customers,
        )

    @app.post("/inventory/motorcycles/sell")
    @login_required
    def sell_motorcycle_form():
        motorcycle_id = request.form.get("motorcycle_id", type=int)
        branch_id = request.form.get("branch_id", type=int)
        customer_id = request.form.get("customer_id", type=int)
        motorcycle = db.session.get(Motorcycle, motorcycle_id)
        customer = db.session.get(Customer, customer_id)
        if (
            motorcycle is None
            or customer is None
            or motorcycle.branch_id != branch_id
            or customer.branch_id != branch_id
            or motorcycle.status != "available"
        ):
            flash("Não foi possível realizar a venda. Confira a filial, a moto e o cliente.", "error")
            return redirect(url_for("motorcycle_inventory", branch_id=branch_id))
        transaction = MotorcycleTransaction(
            branch_id=branch_id,
            motorcycle=motorcycle,
            customer=customer,
            transaction_type="sale",
            amount_cents=motorcycle.price_cents,
        )
        motorcycle.status = "sold"
        motorcycle.owner = customer
        db.session.add(transaction)
        db.session.commit()
        flash(f"{motorcycle.brand} {motorcycle.model} vendida com sucesso.", "success")
        return redirect(url_for("motorcycle_inventory", branch_id=branch_id))

    @app.post("/checkout")
    @login_required
    def checkout_form():
        plan_code = request.form.get("plan_code", "").strip().lower()
        subscription, error = activate_subscription(current_user, plan_code)
        if error:
            flash(error, "error")
            return redirect(url_for("dashboard"))
        flash(f"Plano {subscription.plan.name} ativado com sucesso.", "success")
        return redirect(url_for("dashboard"))

    @app.post("/logout")
    @login_required
    def logout_form():
        logout_user()
        flash("Você saiu da sua conta.", "success")
        return redirect(url_for("login_page"))

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
        activate_subscription(user, "free")
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

    @app.get("/api/plans")
    def plans():
        return jsonify(plans=[plan.to_dict() for plan in Plan.query.filter_by(active=True).all()])

    @app.post("/api/checkout")
    @login_required
    def checkout():
        payload = request.get_json(silent=True) or {}
        plan_code = str(payload.get("plan_code", "")).strip().lower()
        subscription, error = activate_subscription(current_user, plan_code)
        if error:
            return jsonify(error=error), 400
        return jsonify(subscription=subscription.to_dict()), 200

    @app.post("/api/matrices")
    @login_required
    def create_matrix():
        payload = request.get_json(silent=True) or {}
        name = str(payload.get("name", "")).strip()
        tax_id = str(payload.get("tax_id", "")).strip() or None
        if not name:
            return jsonify(error="name is required"), 400
        if tax_id and Matrix.query.filter_by(tax_id=tax_id).first():
            return jsonify(error="tax_id is already registered"), 409
        matrix = Matrix(name=name, tax_id=tax_id)
        db.session.add(matrix)
        db.session.commit()
        return jsonify(matrix=matrix.to_dict()), 201

    @app.get("/api/matrices")
    @login_required
    def list_matrices():
        return jsonify(matrices=[matrix.to_dict() for matrix in Matrix.query.all()])

    @app.get("/api/matrices/<int:matrix_id>")
    @login_required
    def get_matrix(matrix_id):
        matrix = db.session.get(Matrix, matrix_id)
        if matrix is None:
            return jsonify(error="matrix not found"), 404
        return jsonify(matrix=matrix.to_dict())

    @app.patch("/api/matrices/<int:matrix_id>")
    @login_required
    def update_matrix(matrix_id):
        matrix = db.session.get(Matrix, matrix_id)
        if matrix is None:
            return jsonify(error="matrix not found"), 404
        payload = request.get_json(silent=True) or {}
        if "name" in payload:
            matrix.name = str(payload["name"]).strip()
        if not matrix.name:
            return jsonify(error="name is required"), 400
        db.session.commit()
        return jsonify(matrix=matrix.to_dict())

    @app.post("/api/matrices/<int:matrix_id>/branches")
    @login_required
    def create_branch(matrix_id):
        matrix = db.session.get(Matrix, matrix_id)
        payload = request.get_json(silent=True) or {}
        if matrix is None:
            return jsonify(error="matrix not found"), 404
        if len(matrix.branches) >= 3:
            return jsonify(error="a matrix can have at most 3 branches"), 409
        name = str(payload.get("name", "")).strip()
        code = str(payload.get("code", "")).strip().upper()
        if not name or not code:
            return jsonify(error="name and code are required"), 400
        branch = Branch(
            matrix=matrix,
            name=name,
            code=code,
            address=str(payload.get("address", "")).strip() or None,
        )
        db.session.add(branch)
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
            return jsonify(error="branch code is already registered for this matrix"), 409
        return jsonify(branch=branch.to_dict()), 201

    @app.get("/api/branches/<int:branch_id>")
    @login_required
    def get_branch(branch_id):
        branch = db.session.get(Branch, branch_id)
        if branch is None:
            return jsonify(error="branch not found"), 404
        return jsonify(branch=branch.to_dict())

    @app.patch("/api/branches/<int:branch_id>")
    @login_required
    def update_branch(branch_id):
        branch = db.session.get(Branch, branch_id)
        if branch is None:
            return jsonify(error="branch not found"), 404
        payload = request.get_json(silent=True) or {}
        for field in ("name", "address"):
            if field in payload:
                setattr(branch, field, str(payload[field]).strip() or None)
        if "active" in payload:
            branch.active = bool(payload["active"])
        if not branch.name:
            return jsonify(error="name is required"), 400
        db.session.commit()
        return jsonify(branch=branch.to_dict())

    @app.delete("/api/branches/<int:branch_id>")
    @login_required
    def delete_branch(branch_id):
        branch = db.session.get(Branch, branch_id)
        if branch is None:
            return jsonify(error="branch not found"), 404
        db.session.delete(branch)
        db.session.commit()
        return jsonify(message="branch deleted")

    @app.post("/api/branches/<int:branch_id>/customers")
    @login_required
    def create_customer(branch_id):
        branch = db.session.get(Branch, branch_id)
        payload = request.get_json(silent=True) or {}
        if branch is None:
            return jsonify(error="branch not found"), 404
        name = str(payload.get("name", "")).strip()
        if not name:
            return jsonify(error="name is required"), 400
        customer = Customer(
            branch=branch,
            name=name,
            document=str(payload.get("document", "")).strip() or None,
            email=str(payload.get("email", "")).strip().lower() or None,
            phone=str(payload.get("phone", "")).strip() or None,
        )
        db.session.add(customer)
        db.session.commit()
        return jsonify(customer=customer.to_dict()), 201

    @app.get("/api/branches/<int:branch_id>/customers")
    @login_required
    def list_customers(branch_id):
        if db.session.get(Branch, branch_id) is None:
            return jsonify(error="branch not found"), 404
        customers = Customer.query.filter_by(branch_id=branch_id).all()
        return jsonify(customers=[customer.to_dict() for customer in customers])

    @app.get("/api/customers/<int:customer_id>")
    @login_required
    def get_customer(customer_id):
        customer = db.session.get(Customer, customer_id)
        if customer is None:
            return jsonify(error="customer not found"), 404
        return jsonify(customer=customer.to_dict())

    @app.patch("/api/customers/<int:customer_id>")
    @login_required
    def update_customer(customer_id):
        customer = db.session.get(Customer, customer_id)
        if customer is None:
            return jsonify(error="customer not found"), 404
        payload = request.get_json(silent=True) or {}
        if "name" in payload:
            customer.name = str(payload["name"]).strip()
        for field in ("document", "phone"):
            if field in payload:
                setattr(customer, field, str(payload[field]).strip() or None)
        if "email" in payload:
            customer.email = str(payload["email"]).strip().lower() or None
        if not customer.name:
            return jsonify(error="name is required"), 400
        db.session.commit()
        return jsonify(customer=customer.to_dict())

    @app.delete("/api/customers/<int:customer_id>")
    @login_required
    def delete_customer(customer_id):
        customer = db.session.get(Customer, customer_id)
        if customer is None:
            return jsonify(error="customer not found"), 404
        db.session.delete(customer)
        db.session.commit()
        return jsonify(message="customer deleted")

    @app.post("/api/branches/<int:branch_id>/motorcycles")
    @login_required
    def create_motorcycle(branch_id):
        branch = db.session.get(Branch, branch_id)
        payload = request.get_json(silent=True) or {}
        if branch is None:
            return jsonify(error="branch not found"), 404
        motorcycle, error = build_motorcycle(payload, branch)
        if error:
            return jsonify(error=error), 400
        db.session.add(motorcycle)
        db.session.commit()
        return jsonify(motorcycle=motorcycle.to_dict()), 201

    @app.get("/api/branches/<int:branch_id>/motorcycles")
    @login_required
    def list_motorcycles(branch_id):
        if db.session.get(Branch, branch_id) is None:
            return jsonify(error="branch not found"), 404
        motorcycles = Motorcycle.query.filter_by(branch_id=branch_id).all()
        return jsonify(motorcycles=[motorcycle.to_dict() for motorcycle in motorcycles])

    @app.get("/api/motorcycles/<int:motorcycle_id>")
    @login_required
    def get_motorcycle(motorcycle_id):
        motorcycle = db.session.get(Motorcycle, motorcycle_id)
        if motorcycle is None:
            return jsonify(error="motorcycle not found"), 404
        return jsonify(motorcycle=motorcycle.to_dict())

    @app.patch("/api/motorcycles/<int:motorcycle_id>")
    @login_required
    def update_motorcycle(motorcycle_id):
        motorcycle = db.session.get(Motorcycle, motorcycle_id)
        if motorcycle is None:
            return jsonify(error="motorcycle not found"), 404
        payload = request.get_json(silent=True) or {}
        for field in ("brand", "model", "condition", "status", "chassis_number"):
            if field in payload:
                setattr(motorcycle, field, str(payload[field]).strip())
        if "year" in payload:
            motorcycle.year = int(payload["year"]) if payload["year"] else None
        if "price" in payload:
            motorcycle.price_cents = parse_amount(payload["price"])
        if not motorcycle.brand or not motorcycle.model:
            return jsonify(error="brand and model are required"), 400
        db.session.commit()
        return jsonify(motorcycle=motorcycle.to_dict())

    @app.delete("/api/motorcycles/<int:motorcycle_id>")
    @login_required
    def delete_motorcycle(motorcycle_id):
        motorcycle = db.session.get(Motorcycle, motorcycle_id)
        if motorcycle is None:
            return jsonify(error="motorcycle not found"), 404
        db.session.delete(motorcycle)
        db.session.commit()
        return jsonify(message="motorcycle deleted")

    @app.post("/api/branches/<int:branch_id>/motorcycle-transactions")
    @login_required
    def create_motorcycle_transaction(branch_id):
        branch = db.session.get(Branch, branch_id)
        payload = request.get_json(silent=True) or {}
        motorcycle = db.session.get(Motorcycle, payload.get("motorcycle_id"))
        if branch is None or motorcycle is None or motorcycle.branch_id != branch_id:
            return jsonify(error="branch or motorcycle not found"), 404
        transaction_type = str(payload.get("transaction_type", "")).strip().lower()
        if transaction_type not in {"purchase", "sale"}:
            return jsonify(error="transaction_type must be purchase or sale"), 400
        amount = payload.get("amount")
        if amount is None:
            return jsonify(error="amount is required"), 400
        customer = None
        if payload.get("customer_id") is not None:
            customer = db.session.get(Customer, payload["customer_id"])
            if customer is None or customer.branch_id != branch_id:
                return jsonify(error="customer not found in this branch"), 404
        transaction = MotorcycleTransaction(
            branch=branch,
            motorcycle=motorcycle,
            customer=customer,
            transaction_type=transaction_type,
            amount_cents=parse_amount(amount),
        )
        motorcycle.status = "sold" if transaction_type == "sale" else "available"
        if transaction_type == "sale":
            motorcycle.owner = customer
        db.session.add(transaction)
        db.session.commit()
        return jsonify(transaction=transaction.to_dict()), 201

    @app.get("/api/branches/<int:branch_id>/motorcycle-transactions")
    @login_required
    def list_motorcycle_transactions(branch_id):
        if db.session.get(Branch, branch_id) is None:
            return jsonify(error="branch not found"), 404
        transactions = MotorcycleTransaction.query.filter_by(branch_id=branch_id).all()
        return jsonify(transactions=[transaction.to_dict() for transaction in transactions])

    @app.get("/api/motorcycle-transactions/<int:transaction_id>")
    @login_required
    def get_motorcycle_transaction(transaction_id):
        transaction = db.session.get(MotorcycleTransaction, transaction_id)
        if transaction is None:
            return jsonify(error="transaction not found"), 404
        return jsonify(transaction=transaction.to_dict())

    @app.patch("/api/motorcycle-transactions/<int:transaction_id>")
    @login_required
    def update_motorcycle_transaction(transaction_id):
        transaction = db.session.get(MotorcycleTransaction, transaction_id)
        if transaction is None:
            return jsonify(error="transaction not found"), 404
        payload = request.get_json(silent=True) or {}
        if "amount" in payload:
            try:
                transaction.amount_cents = parse_amount(payload["amount"])
            except (TypeError, ValueError):
                return jsonify(error="amount must be a valid number"), 400
        if "transaction_type" in payload:
            transaction_type = str(payload["transaction_type"]).strip().lower()
            if transaction_type not in {"purchase", "sale"}:
                return jsonify(error="transaction_type must be purchase or sale"), 400
            transaction.transaction_type = transaction_type
            transaction.motorcycle.status = "sold" if transaction_type == "sale" else "available"
        db.session.commit()
        return jsonify(transaction=transaction.to_dict())

    @app.delete("/api/motorcycle-transactions/<int:transaction_id>")
    @login_required
    def delete_motorcycle_transaction(transaction_id):
        transaction = db.session.get(MotorcycleTransaction, transaction_id)
        if transaction is None:
            return jsonify(error="transaction not found"), 404
        db.session.delete(transaction)
        db.session.commit()
        return jsonify(message="transaction deleted")

    @app.post("/api/branches/<int:branch_id>/suppliers")
    @login_required
    def create_supplier(branch_id):
        return create_partner(branch_id, Supplier, "supplier")

    @app.get("/api/branches/<int:branch_id>/suppliers")
    @login_required
    def list_suppliers(branch_id):
        return list_partners(branch_id, Supplier, "suppliers")

    @app.get("/api/suppliers/<int:partner_id>")
    @login_required
    def get_supplier(partner_id):
        return get_partner(partner_id, Supplier, "supplier")

    @app.patch("/api/suppliers/<int:partner_id>")
    @login_required
    def update_supplier(partner_id):
        return update_partner(partner_id, Supplier, "supplier")

    @app.delete("/api/suppliers/<int:partner_id>")
    @login_required
    def delete_supplier(partner_id):
        return delete_partner(partner_id, Supplier, "supplier")

    @app.post("/api/branches/<int:branch_id>/carriers")
    @login_required
    def create_carrier(branch_id):
        return create_partner(branch_id, Carrier, "carrier")

    @app.get("/api/branches/<int:branch_id>/carriers")
    @login_required
    def list_carriers(branch_id):
        return list_partners(branch_id, Carrier, "carriers")

    @app.get("/api/carriers/<int:partner_id>")
    @login_required
    def get_carrier(partner_id):
        return get_partner(partner_id, Carrier, "carrier")

    @app.patch("/api/carriers/<int:partner_id>")
    @login_required
    def update_carrier(partner_id):
        return update_partner(partner_id, Carrier, "carrier")

    @app.delete("/api/carriers/<int:partner_id>")
    @login_required
    def delete_carrier(partner_id):
        return delete_partner(partner_id, Carrier, "carrier")

    @app.post("/api/branches/<int:branch_id>/parts")
    @login_required
    def create_part(branch_id):
        branch = db.session.get(Branch, branch_id)
        payload = request.get_json(silent=True) or {}
        if branch is None:
            return jsonify(error="branch not found"), 404
        name = str(payload.get("name", "")).strip()
        sku = str(payload.get("sku", "")).strip().upper()
        if not name or not sku:
            return jsonify(error="name and sku are required"), 400
        supplier_id = payload.get("supplier_id")
        supplier = db.session.get(Supplier, supplier_id) if supplier_id else None
        if supplier_id and (supplier is None or supplier.branch_id != branch_id):
            return jsonify(error="supplier not found in this branch"), 404
        try:
            part = Part(
                branch=branch,
                supplier=supplier,
                name=name,
                sku=sku,
                description=str(payload.get("description", "")).strip() or None,
                unit_price_cents=parse_amount(payload.get("unit_price", 0)),
                stock_quantity=parse_quantity(payload.get("stock_quantity", 0)),
            )
            db.session.add(part)
            db.session.commit()
        except (TypeError, ValueError):
            db.session.rollback()
            return jsonify(error="unit_price and stock_quantity must be valid"), 400
        except Exception:
            db.session.rollback()
            return jsonify(error="sku is already registered for this branch"), 409
        return jsonify(part=part.to_dict()), 201

    @app.get("/api/branches/<int:branch_id>/parts")
    @login_required
    def list_parts(branch_id):
        if db.session.get(Branch, branch_id) is None:
            return jsonify(error="branch not found"), 404
        parts = Part.query.filter_by(branch_id=branch_id).all()
        return jsonify(parts=[part.to_dict() for part in parts])

    @app.get("/api/parts/<int:part_id>")
    @login_required
    def get_part(part_id):
        part = db.session.get(Part, part_id)
        if part is None:
            return jsonify(error="part not found"), 404
        return jsonify(part=part.to_dict())

    @app.patch("/api/parts/<int:part_id>")
    @login_required
    def update_part(part_id):
        part = db.session.get(Part, part_id)
        if part is None:
            return jsonify(error="part not found"), 404
        payload = request.get_json(silent=True) or {}
        if "name" in payload:
            part.name = str(payload["name"]).strip()
        if "description" in payload:
            part.description = str(payload["description"]).strip() or None
        if "unit_price" in payload:
            try:
                part.unit_price_cents = parse_amount(payload["unit_price"])
            except (TypeError, ValueError):
                return jsonify(error="unit_price must be a valid number"), 400
        if "stock_quantity" in payload:
            try:
                part.stock_quantity = parse_quantity(payload["stock_quantity"])
            except (TypeError, ValueError):
                return jsonify(error="stock_quantity must be a valid integer"), 400
        if "active" in payload:
            part.active = bool(payload["active"])
        if not part.name:
            return jsonify(error="name is required"), 400
        db.session.commit()
        return jsonify(part=part.to_dict())

    @app.delete("/api/parts/<int:part_id>")
    @login_required
    def delete_part(part_id):
        part = db.session.get(Part, part_id)
        if part is None:
            return jsonify(error="part not found"), 404
        db.session.delete(part)
        db.session.commit()
        return jsonify(message="part deleted")

    @app.post("/api/branches/<int:branch_id>/part-transactions")
    @login_required
    def create_part_transaction(branch_id):
        branch = db.session.get(Branch, branch_id)
        payload = request.get_json(silent=True) or {}
        part = db.session.get(Part, payload.get("part_id"))
        if branch is None or part is None or part.branch_id != branch_id:
            return jsonify(error="branch or part not found"), 404
        transaction_type = str(payload.get("transaction_type", "")).strip().lower()
        if transaction_type not in {"purchase", "sale"}:
            return jsonify(error="transaction_type must be purchase or sale"), 400
        try:
            quantity = parse_quantity(payload.get("quantity"))
            unit_price_cents = parse_amount(payload.get("unit_price"))
        except (TypeError, ValueError):
            return jsonify(error="quantity and unit_price must be valid"), 400
        if quantity <= 0 or unit_price_cents < 0:
            return jsonify(error="quantity must be positive and unit_price cannot be negative"), 400
        if transaction_type == "sale" and part.stock_quantity < quantity:
            return jsonify(error="insufficient stock"), 409
        supplier = get_related_partner(payload, Supplier, branch_id)
        carrier = get_related_partner(payload, Carrier, branch_id)
        if supplier[1] or carrier[1]:
            return jsonify(error=supplier[1] or carrier[1]), 404
        customer = None
        if payload.get("customer_id") is not None:
            customer = db.session.get(Customer, payload["customer_id"])
            if customer is None or customer.branch_id != branch_id:
                return jsonify(error="customer not found in this branch"), 404
        transaction = PartTransaction(
            branch=branch,
            part=part,
            supplier=supplier[0],
            carrier=carrier[0],
            customer=customer,
            transaction_type=transaction_type,
            quantity=quantity,
            unit_price_cents=unit_price_cents,
        )
        part.stock_quantity += quantity if transaction_type == "purchase" else -quantity
        db.session.add(transaction)
        db.session.commit()
        return jsonify(transaction=transaction.to_dict()), 201

    @app.get("/api/branches/<int:branch_id>/part-transactions")
    @login_required
    def list_part_transactions(branch_id):
        if db.session.get(Branch, branch_id) is None:
            return jsonify(error="branch not found"), 404
        transactions = PartTransaction.query.filter_by(branch_id=branch_id).all()
        return jsonify(transactions=[transaction.to_dict() for transaction in transactions])

    @app.get("/api/part-transactions/<int:transaction_id>")
    @login_required
    def get_part_transaction(transaction_id):
        transaction = db.session.get(PartTransaction, transaction_id)
        if transaction is None:
            return jsonify(error="transaction not found"), 404
        return jsonify(transaction=transaction.to_dict())

    @app.delete("/api/part-transactions/<int:transaction_id>")
    @login_required
    def delete_part_transaction(transaction_id):
        transaction = db.session.get(PartTransaction, transaction_id)
        if transaction is None:
            return jsonify(error="transaction not found"), 404
        transaction.part.stock_quantity += (
            transaction.quantity if transaction.transaction_type == "sale" else -transaction.quantity
        )
        if transaction.part.stock_quantity < 0:
            return jsonify(error="cannot remove transaction because stock would be negative"), 409
        db.session.delete(transaction)
        db.session.commit()
        return jsonify(message="transaction deleted")

    @app.post("/api/branches/<int:branch_id>/price-tables")
    @login_required
    def create_price_table(branch_id):
        branch = db.session.get(Branch, branch_id)
        payload = request.get_json(silent=True) or {}
        name = str(payload.get("name", "")).strip()
        if branch is None:
            return jsonify(error="branch not found"), 404
        if not name:
            return jsonify(error="name is required"), 400
        table = PriceTable(branch=branch, name=name)
        db.session.add(table)
        db.session.commit()
        return jsonify(price_table=table.to_dict()), 201

    @app.get("/api/branches/<int:branch_id>/price-tables")
    @login_required
    def list_price_tables(branch_id):
        if db.session.get(Branch, branch_id) is None:
            return jsonify(error="branch not found"), 404
        tables = PriceTable.query.filter_by(branch_id=branch_id).all()
        return jsonify(price_tables=[table.to_dict() for table in tables])

    @app.post("/api/price-tables/<int:table_id>/entries")
    @login_required
    def create_price_table_entry(table_id):
        table = db.session.get(PriceTable, table_id)
        payload = request.get_json(silent=True) or {}
        item_type = str(payload.get("item_type", "")).strip().lower()
        if table is None:
            return jsonify(error="price table not found"), 404
        if item_type not in {"motorcycle", "part"}:
            return jsonify(error="item_type must be motorcycle or part"), 400
        item_id = payload.get("item_id")
        item = db.session.get(Motorcycle if item_type == "motorcycle" else Part, item_id)
        if item is None or item.branch_id != table.branch_id:
            return jsonify(error="item not found in this branch"), 404
        try:
            price_cents = parse_amount(payload.get("price"))
        except (TypeError, ValueError):
            return jsonify(error="price must be a valid number"), 400
        if price_cents < 0:
            return jsonify(error="price cannot be negative"), 400
        entry = PriceTableEntry(
            price_table=table,
            item_type=item_type,
            motorcycle=item if item_type == "motorcycle" else None,
            part=item if item_type == "part" else None,
            price_cents=price_cents,
        )
        db.session.add(entry)
        db.session.commit()
        return jsonify(entry=entry.to_dict()), 201

    @app.patch("/api/price-tables/<int:table_id>")
    @login_required
    def update_price_table(table_id):
        table = db.session.get(PriceTable, table_id)
        if table is None:
            return jsonify(error="price table not found"), 404
        payload = request.get_json(silent=True) or {}
        if "name" in payload:
            table.name = str(payload["name"]).strip()
        if "active" in payload:
            table.active = bool(payload["active"])
        if not table.name:
            return jsonify(error="name is required"), 400
        db.session.commit()
        return jsonify(price_table=table.to_dict())

    @app.post("/api/price-tables/<int:table_id>/apply")
    @login_required
    def apply_price_table(table_id):
        table = db.session.get(PriceTable, table_id)
        if table is None or not table.active:
            return jsonify(error="price table not found or inactive"), 404
        updated = 0
        for entry in table.entries:
            item = entry.motorcycle if entry.item_type == "motorcycle" else entry.part
            if item is not None:
                if entry.item_type == "motorcycle":
                    item.price_cents = entry.price_cents
                else:
                    item.unit_price_cents = entry.price_cents
                updated += 1
        db.session.commit()
        return jsonify(updated=updated, price_table=table.to_dict())

    @app.post("/api/motorcycle-transactions/<int:transaction_id>/invoice")
    @login_required
    def issue_motorcycle_invoice(transaction_id):
        transaction = db.session.get(MotorcycleTransaction, transaction_id)
        if transaction is None:
            return jsonify(error="transaction not found"), 404
        if transaction.invoice:
            return jsonify(invoice=transaction.invoice.to_dict()), 200
        invoice = ElectronicInvoice(
            branch_id=transaction.branch_id,
            customer_id=transaction.customer_id,
            motorcycle_transaction=transaction,
            number=next_invoice_number(),
            status="simulated",
            total_cents=transaction.amount_cents,
        )
        db.session.add(invoice)
        db.session.commit()
        return jsonify(invoice=invoice.to_dict()), 201

    @app.post("/api/part-transactions/<int:transaction_id>/invoice")
    @login_required
    def issue_part_invoice(transaction_id):
        transaction = db.session.get(PartTransaction, transaction_id)
        if transaction is None:
            return jsonify(error="transaction not found"), 404
        if transaction.invoice:
            return jsonify(invoice=transaction.invoice.to_dict()), 200
        invoice = ElectronicInvoice(
            branch_id=transaction.branch_id,
            customer_id=transaction.customer_id,
            part_transaction=transaction,
            number=next_invoice_number(),
            status="simulated",
            total_cents=transaction.quantity * transaction.unit_price_cents,
        )
        db.session.add(invoice)
        db.session.commit()
        return jsonify(invoice=invoice.to_dict()), 201

    @app.get("/api/invoices/<int:invoice_id>")
    @login_required
    def get_invoice(invoice_id):
        invoice = db.session.get(ElectronicInvoice, invoice_id)
        if invoice is None:
            return jsonify(error="invoice not found"), 404
        return jsonify(invoice=invoice.to_dict())

    @app.get("/api/branches/<int:branch_id>/invoices")
    @login_required
    def list_invoices(branch_id):
        if db.session.get(Branch, branch_id) is None:
            return jsonify(error="branch not found"), 404
        invoices = ElectronicInvoice.query.filter_by(branch_id=branch_id).all()
        return jsonify(invoices=[invoice.to_dict() for invoice in invoices])


def activate_subscription(user: User, plan_code: str) -> tuple[Subscription | None, str | None]:
    """Simulate a successful checkout and activate the selected plan."""
    plan = Plan.query.filter_by(code=plan_code, active=True).first()
    if plan is None:
        return None, "Plano inválido ou indisponível."

    subscription = user.subscription
    if subscription is None:
        subscription = Subscription(user=user, plan=plan, status="active")
        db.session.add(subscription)
    else:
        subscription.plan = plan
        subscription.status = "active"
        subscription.activated_at = datetime.now(timezone.utc)
    db.session.commit()
    return subscription, None


def parse_amount(value: object) -> int:
    """Convert a decimal amount to cents."""
    return round(float(value) * 100)


def next_invoice_number() -> str:
    """Generate a unique identifier for the simulated NF-e."""
    return f"SIM-{datetime.now(timezone.utc):%Y%m%d%H%M%S}-{uuid4().hex[:8].upper()}"


def parse_quantity(value: object) -> int:
    """Convert an inventory quantity to a non-negative integer."""
    quantity = int(value)
    if quantity < 0:
        raise ValueError("quantity cannot be negative")
    return quantity


def create_partner(branch_id: int, model: type, key: str):
    branch = db.session.get(Branch, branch_id)
    payload = request.get_json(silent=True) or {}
    if branch is None:
        return jsonify(error="branch not found"), 404
    name = str(payload.get("name", "")).strip()
    if not name:
        return jsonify(error="name is required"), 400
    partner = model(
        branch=branch,
        name=name,
        document=str(payload.get("document", "")).strip() or None,
        email=str(payload.get("email", "")).strip().lower() or None,
        phone=str(payload.get("phone", "")).strip() or None,
    )
    db.session.add(partner)
    db.session.commit()
    return jsonify(**{key: partner.to_dict()}), 201


def list_partners(branch_id: int, model: type, key: str):
    if db.session.get(Branch, branch_id) is None:
        return jsonify(error="branch not found"), 404
    partners = model.query.filter_by(branch_id=branch_id).all()
    return jsonify(**{key: [partner.to_dict() for partner in partners]})


def get_partner(partner_id: int, model: type, key: str):
    partner = db.session.get(model, partner_id)
    if partner is None:
        return jsonify(error=f"{key} not found"), 404
    return jsonify(**{key: partner.to_dict()})


def update_partner(partner_id: int, model: type, key: str):
    partner = db.session.get(model, partner_id)
    if partner is None:
        return jsonify(error=f"{key} not found"), 404
    payload = request.get_json(silent=True) or {}
    if "name" in payload:
        partner.name = str(payload["name"]).strip()
    for field in ("document", "phone"):
        if field in payload:
            setattr(partner, field, str(payload[field]).strip() or None)
    if "email" in payload:
        partner.email = str(payload["email"]).strip().lower() or None
    if not partner.name:
        return jsonify(error="name is required"), 400
    db.session.commit()
    return jsonify(**{key: partner.to_dict()})


def delete_partner(partner_id: int, model: type, key: str):
    partner = db.session.get(model, partner_id)
    if partner is None:
        return jsonify(error=f"{key} not found"), 404
    db.session.delete(partner)
    db.session.commit()
    return jsonify(message=f"{key} deleted")


def get_related_partner(payload: dict, model: type, branch_id: int):
    field = "supplier_id" if model is Supplier else "carrier_id"
    partner_id = payload.get(field)
    if partner_id is None:
        return None, None
    partner = db.session.get(model, partner_id)
    if partner is None or partner.branch_id != branch_id:
        label = "supplier" if model is Supplier else "carrier"
        return None, f"{label} not found in this branch"
    return partner, None


def build_motorcycle(payload: dict, branch: Branch) -> tuple[Motorcycle | None, str | None]:
    brand = str(payload.get("brand", "")).strip()
    model = str(payload.get("model", "")).strip()
    condition = str(payload.get("condition", "")).strip().lower()
    if not brand or not model:
        return None, "brand and model are required"
    if condition not in {"new", "used"}:
        return None, "condition must be new or used"
    try:
        price_cents = parse_amount(payload.get("price", 0))
    except (TypeError, ValueError):
        return None, "price must be a valid number"
    return Motorcycle(
        branch=branch,
        brand=brand,
        model=model,
        year=int(payload["year"]) if payload.get("year") else None,
        condition=condition,
        chassis_number=str(payload.get("chassis_number", "")).strip() or None,
        price_cents=price_cents,
    ), None

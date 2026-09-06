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


def authenticate(client):
    response = client.post(
        "/auth/register",
        json={
            "name": "Admin",
            "email": "admin@example.com",
            "password": "secure-password",
        },
    )
    assert response.status_code == 201


def test_matrix_allows_at_most_three_branches(client):
    authenticate(client)
    matrix = client.post("/api/matrices", json={"name": "Grupo Golden"})
    assert matrix.status_code == 201
    matrix_id = matrix.get_json()["matrix"]["id"]

    for number in range(1, 4):
        response = client.post(
            f"/api/matrices/{matrix_id}/branches",
            json={"name": f"Filial {number}", "code": f"F{number}"},
        )
        assert response.status_code == 201

    fourth = client.post(
        f"/api/matrices/{matrix_id}/branches",
        json={"name": "Filial 4", "code": "F4"},
    )
    assert fourth.status_code == 409
    assert "at most 3" in fourth.get_json()["error"]


def test_customer_and_motorcycle_purchase_sale_crud_is_branch_scoped(client):
    authenticate(client)
    matrix = client.post("/api/matrices", json={"name": "Grupo Golden"}).get_json()["matrix"]
    branch = client.post(
        f"/api/matrices/{matrix['id']}/branches",
        json={"name": "Matriz", "code": "HQ"},
    ).get_json()["branch"]
    branch_id = branch["id"]

    customer = client.post(
        f"/api/branches/{branch_id}/customers",
        json={"name": "Cliente Um", "email": "cliente@example.com"},
    )
    assert customer.status_code == 201
    customer_id = customer.get_json()["customer"]["id"]

    motorcycle = client.post(
        f"/api/branches/{branch_id}/motorcycles",
        json={
            "brand": "Golden",
            "model": "City",
            "condition": "used",
            "year": 2022,
            "price": 12500.50,
        },
    )
    assert motorcycle.status_code == 201
    motorcycle_id = motorcycle.get_json()["motorcycle"]["id"]

    purchase = client.post(
        f"/api/branches/{branch_id}/motorcycle-transactions",
        json={
            "motorcycle_id": motorcycle_id,
            "transaction_type": "purchase",
            "amount": 9000,
        },
    )
    assert purchase.status_code == 201

    sale = client.post(
        f"/api/branches/{branch_id}/motorcycle-transactions",
        json={
            "motorcycle_id": motorcycle_id,
            "customer_id": customer_id,
            "transaction_type": "sale",
            "amount": 12500.50,
        },
    )
    assert sale.status_code == 201
    assert sale.get_json()["transaction"]["transaction_type"] == "sale"

    updated = client.patch(
        f"/api/customers/{customer_id}",
        json={"phone": "11999999999"},
    )
    assert updated.status_code == 200
    assert updated.get_json()["customer"]["phone"] == "11999999999"

    motorcycles = client.get(f"/api/branches/{branch_id}/motorcycles")
    assert motorcycles.status_code == 200
    assert motorcycles.get_json()["motorcycles"][0]["status"] == "sold"


def test_parts_suppliers_carriers_and_stock_transactions_are_branch_scoped(client):
    authenticate(client)
    matrix = client.post("/api/matrices", json={"name": "Grupo Golden"}).get_json()["matrix"]
    branch = client.post(
        f"/api/matrices/{matrix['id']}/branches",
        json={"name": "Filial Pecas", "code": "P1"},
    ).get_json()["branch"]
    branch_id = branch["id"]

    supplier = client.post(
        f"/api/branches/{branch_id}/suppliers",
        json={"name": "Fornecedor Central", "email": "fornecedor@example.com"},
    )
    carrier = client.post(
        f"/api/branches/{branch_id}/carriers",
        json={"name": "Transporte Expresso"},
    )
    assert supplier.status_code == 201
    assert carrier.status_code == 201
    supplier_id = supplier.get_json()["supplier"]["id"]
    carrier_id = carrier.get_json()["carrier"]["id"]

    customer = client.post(
        f"/api/branches/{branch_id}/customers",
        json={"name": "Cliente da Peça"},
    ).get_json()["customer"]
    part = client.post(
        f"/api/branches/{branch_id}/parts",
        json={
            "name": "Pastilha de freio",
            "sku": "BRK-001",
            "supplier_id": supplier_id,
            "stock_quantity": 2,
            "unit_price": 35.50,
        },
    )
    assert part.status_code == 201
    part_id = part.get_json()["part"]["id"]

    purchase = client.post(
        f"/api/branches/{branch_id}/part-transactions",
        json={
            "part_id": part_id,
            "supplier_id": supplier_id,
            "carrier_id": carrier_id,
            "transaction_type": "purchase",
            "quantity": 5,
            "unit_price": 20,
        },
    )
    assert purchase.status_code == 201
    assert purchase.get_json()["transaction"]["total"] == 100.0

    sale = client.post(
        f"/api/branches/{branch_id}/part-transactions",
        json={
            "part_id": part_id,
            "customer_id": customer["id"],
            "transaction_type": "sale",
            "quantity": 3,
            "unit_price": 35.50,
        },
    )
    assert sale.status_code == 201

    listed = client.get(f"/api/branches/{branch_id}/parts")
    assert listed.status_code == 200
    assert listed.get_json()["parts"][0]["stock_quantity"] == 4

    updated = client.patch(
        f"/api/suppliers/{supplier_id}",
        json={"phone": "11988887777"},
    )
    assert updated.status_code == 200
    assert updated.get_json()["supplier"]["phone"] == "11988887777"


def test_part_sale_rejects_insufficient_stock(client):
    authenticate(client)
    matrix = client.post("/api/matrices", json={"name": "Grupo Golden"}).get_json()["matrix"]
    branch = client.post(
        f"/api/matrices/{matrix['id']}/branches",
        json={"name": "Filial", "code": "F1"},
    ).get_json()["branch"]
    part = client.post(
        f"/api/branches/{branch['id']}/parts",
        json={"name": "Cabo", "sku": "CAB-1", "stock_quantity": 1},
    ).get_json()["part"]

    response = client.post(
        f"/api/branches/{branch['id']}/part-transactions",
        json={
            "part_id": part["id"],
            "transaction_type": "sale",
            "quantity": 2,
            "unit_price": 10,
        },
    )
    assert response.status_code == 409
    assert response.get_json()["error"] == "insufficient stock"


def test_motorcycle_inventory_page_lists_branch_stock_and_simulates_sale(client):
    authenticate(client)
    matrix = client.post("/api/matrices", json={"name": "Grupo Visual"}).get_json()["matrix"]
    branch = client.post(
        f"/api/matrices/{matrix['id']}/branches",
        json={"name": "Filial Centro", "code": "CTR"},
    ).get_json()["branch"]
    customer = client.post(
        f"/api/branches/{branch['id']}/customers",
        json={"name": "Cliente Visual"},
    ).get_json()["customer"]
    motorcycle = client.post(
        f"/api/branches/{branch['id']}/motorcycles",
        json={
            "brand": "Golden",
            "model": "Urban",
            "condition": "new",
            "year": 2025,
            "price": 18990,
        },
    ).get_json()["motorcycle"]

    page = client.get(f"/inventory/motorcycles?branch_id={branch['id']}")
    assert page.status_code == 200
    assert b"Golden Urban" in page.data
    assert b"Simular venda" in page.data
    assert b"tailwindcss.com" in page.data

    sale = client.post(
        "/inventory/motorcycles/sell",
        data={
            "branch_id": branch["id"],
            "motorcycle_id": motorcycle["id"],
            "customer_id": customer["id"],
        },
    )
    assert sale.status_code == 302
    assert "Filial Centro" not in sale.data.decode()

    inventory_after_sale = client.get(f"/inventory/motorcycles?branch_id={branch['id']}")
    assert b"Nenhuma moto dispon" in inventory_after_sale.data


def test_price_table_updates_motorcycle_and_part_prices(client):
    authenticate(client)
    matrix = client.post("/api/matrices", json={"name": "Grupo Preços"}).get_json()["matrix"]
    branch = client.post(
        f"/api/matrices/{matrix['id']}/branches",
        json={"name": "Filial Preços", "code": "PRC"},
    ).get_json()["branch"]
    motorcycle = client.post(
        f"/api/branches/{branch['id']}/motorcycles",
        json={"brand": "Golden", "model": "Tour", "condition": "new", "price": 1000},
    ).get_json()["motorcycle"]
    part = client.post(
        f"/api/branches/{branch['id']}/parts",
        json={"name": "Bateria", "sku": "BAT-1", "unit_price": 100},
    ).get_json()["part"]
    table = client.post(
        f"/api/branches/{branch['id']}/price-tables",
        json={"name": "Tabela Premium"},
    ).get_json()["price_table"]

    motorcycle_entry = client.post(
        f"/api/price-tables/{table['id']}/entries",
        json={"item_type": "motorcycle", "item_id": motorcycle["id"], "price": 1200},
    )
    part_entry = client.post(
        f"/api/price-tables/{table['id']}/entries",
        json={"item_type": "part", "item_id": part["id"], "price": 130},
    )
    assert motorcycle_entry.status_code == 201
    assert part_entry.status_code == 201

    applied = client.post(f"/api/price-tables/{table['id']}/apply")
    assert applied.status_code == 200
    assert applied.get_json()["updated"] == 2
    assert client.get(f"/api/motorcycles/{motorcycle['id']}").get_json()["motorcycle"]["price"] == 1200.0
    assert client.get(f"/api/parts/{part['id']}").get_json()["part"]["unit_price"] == 130.0


def test_simulated_nfe_is_linked_to_motorcycle_transaction(client):
    authenticate(client)
    matrix = client.post("/api/matrices", json={"name": "Grupo Fiscal"}).get_json()["matrix"]
    branch = client.post(
        f"/api/matrices/{matrix['id']}/branches",
        json={"name": "Filial Fiscal", "code": "FIS"},
    ).get_json()["branch"]
    customer = client.post(
        f"/api/branches/{branch['id']}/customers",
        json={"name": "Cliente NF"},
    ).get_json()["customer"]
    motorcycle = client.post(
        f"/api/branches/{branch['id']}/motorcycles",
        json={"brand": "Golden", "model": "One", "condition": "used", "price": 5000},
    ).get_json()["motorcycle"]
    transaction = client.post(
        f"/api/branches/{branch['id']}/motorcycle-transactions",
        json={
            "motorcycle_id": motorcycle["id"],
            "customer_id": customer["id"],
            "transaction_type": "sale",
            "amount": 5000,
        },
    ).get_json()["transaction"]

    invoice = client.post(f"/api/motorcycle-transactions/{transaction['id']}/invoice")
    assert invoice.status_code == 201
    invoice_data = invoice.get_json()["invoice"]
    assert invoice_data["status"] == "simulated"
    assert invoice_data["number"].startswith("SIM-")
    assert invoice_data["total"] == 5000.0

    same_invoice = client.post(f"/api/motorcycle-transactions/{transaction['id']}/invoice")
    assert same_invoice.status_code == 200
    assert same_invoice.get_json()["invoice"]["id"] == invoice_data["id"]

    listed = client.get(f"/api/branches/{branch['id']}/invoices")
    assert len(listed.get_json()["invoices"]) == 1


def test_parts_inventory_page_manages_supplier_part_and_purchase(client):
    authenticate(client)
    matrix = client.post("/api/matrices", json={"name": "Grupo Peças"}).get_json()["matrix"]
    branch = client.post(
        f"/api/matrices/{matrix['id']}/branches",
        json={"name": "Filial Estoque", "code": "EST"},
    ).get_json()["branch"]

    page = client.get(f"/inventory/parts?branch_id={branch['id']}")
    assert page.status_code == 200
    assert b"Pe\xc3\xa7as e fornecedores" in page.data
    assert b"cdn.tailwindcss.com" in page.data
    assert b"Registrar compra" in page.data

    supplier = client.post(
        "/inventory/parts/suppliers",
        data={
            "branch_id": branch["id"],
            "name": "Distribuidora Alfa",
            "email": "alfa@example.com",
        },
    )
    assert supplier.status_code == 302

    suppliers = client.get(f"/api/branches/{branch['id']}/suppliers").get_json()["suppliers"]
    supplier_id = suppliers[0]["id"]
    part = client.post(
        "/inventory/parts",
        data={
            "branch_id": branch["id"],
            "name": "Filtro de ar",
            "sku": "FLT-001",
            "unit_price": "45.00",
            "stock_quantity": "2",
            "supplier_id": supplier_id,
        },
    )
    assert part.status_code == 302
    part_id = client.get(f"/api/branches/{branch['id']}/parts").get_json()["parts"][0]["id"]

    purchase = client.post(
        "/inventory/parts/purchase",
        data={
            "branch_id": branch["id"],
            "part_id": part_id,
            "supplier_id": supplier_id,
            "quantity": "5",
            "unit_price": "30.00",
        },
    )
    assert purchase.status_code == 302
    inventory = client.get(f"/api/branches/{branch['id']}/parts").get_json()["parts"]
    assert inventory[0]["stock_quantity"] == 7


def test_parts_inventory_rejects_purchase_from_another_branch(client):
    authenticate(client)
    matrix = client.post("/api/matrices", json={"name": "Grupo Filiais"}).get_json()["matrix"]
    first = client.post(
        f"/api/matrices/{matrix['id']}/branches",
        json={"name": "Primeira", "code": "P1"},
    ).get_json()["branch"]
    second = client.post(
        f"/api/matrices/{matrix['id']}/branches",
        json={"name": "Segunda", "code": "P2"},
    ).get_json()["branch"]
    part = client.post(
        f"/api/branches/{first['id']}/parts",
        json={"name": "Pneu", "sku": "PNE-1", "stock_quantity": 1},
    ).get_json()["part"]

    response = client.post(
        "/inventory/parts/purchase",
        data={
            "branch_id": second["id"],
            "part_id": part["id"],
            "quantity": "2",
            "unit_price": "20",
        },
    )
    assert response.status_code == 302
    assert client.get(f"/api/branches/{first['id']}/parts").get_json()["parts"][0]["stock_quantity"] == 1

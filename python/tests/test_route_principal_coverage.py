"""Route-level principal enforcement coverage for the HTTP front door."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from cognito_test_support import make_cognito_test_keys, mint_id_token
from fastapi.testclient import TestClient

from chatticus.control_plane import ControlPlane
from chatticus.http.app import create_app
from chatticus.http.paths import org_path
from chatticus.http.principal import (
    is_no_principal_route,
    is_worker_bootstrap_route,
    is_worker_route_path,
)
from chatticus.org_records import ANTHUS_TENANT_ID

NOW = datetime(2026, 8, 31, 12, 0, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("path", "method", "expected"),
    [
        ("/health", "GET", True),
        ("/auth/callback", "GET", True),
        (org_path("anthus", "/bots"), "POST", False),
        (org_path("anthus", "/workers/register"), "POST", True),
        (org_path("anthus", "/turns/t1/claim"), "POST", False),
        (org_path("anthus", "/channels/c1/messages"), "POST", False),
        (org_path("anthus", "/turns/t1/stream"), "GET", False),
    ],
)
def test_principal_route_classification(path: str, method: str, expected: bool) -> None:
    if expected:
        assert is_no_principal_route(path) or is_worker_bootstrap_route(
            path, method=method
        )
    else:
        assert not is_no_principal_route(path)
        assert not is_worker_bootstrap_route(path, method=method)


def test_worker_route_paths_are_classified() -> None:
    assert is_worker_route_path(org_path("anthus", "/workers/cpu-1/heartbeat"))
    assert is_worker_route_path(org_path("anthus", "/turns/t1/chunks"))
    assert not is_worker_route_path(org_path("anthus", "/workers/register"))
    assert not is_worker_route_path(org_path("anthus", "/channels"))


def test_user_org_routes_require_cognito_token() -> None:
    keys = make_cognito_test_keys()
    plane = ControlPlane()
    plane.admin_seed_organization(
        ANTHUS_TENANT_ID,
        "owner@example.com",
        name="Anthus",
        now=NOW,
    )
    client = TestClient(
        create_app(plane, invoke_key="", cognito_verifier=keys.verifier())
    )
    for path, payload in (
        (org_path(ANTHUS_TENANT_ID, "/bots"), {"user_id": "ryan", "name": "Helper"}),
        (
            org_path(ANTHUS_TENANT_ID, "/channels"),
            {"user_id": "ryan", "bot_ids": []},
        ),
    ):
        denied = client.post(path, json=payload)
        assert denied.status_code == 403, denied.text
        token = mint_id_token(keys, email="owner@example.com")
        allowed = client.post(
            path,
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert allowed.status_code == 200, allowed.text


def test_worker_register_stays_open_without_user_or_worker_principal() -> None:
    keys = make_cognito_test_keys()
    plane = ControlPlane()
    client = TestClient(
        create_app(plane, invoke_key="", cognito_verifier=keys.verifier())
    )
    response = client.post(
        org_path(ANTHUS_TENANT_ID, "/workers/register"),
        json={
            "worker_id": "exercise-worker",
            "cost_class": "local",
            "capabilities": ["cpu"],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["token"]

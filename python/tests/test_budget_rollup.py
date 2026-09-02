"""Unit tests for daily budget rollup helpers."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from chatticus.budget_alerts import FakeBudgetAlertsPublisher
from chatticus.budget_rollup.alert_recorder import record_budget_alert_from_sns
from chatticus.budget_rollup.runner import (
    _highest_band_crossed,
    run_daily_rollup,
)
from chatticus.cost_explorer import FakeCostExplorerReader
from chatticus.messaging.store import InMemoryMessagingStore
from chatticus.org_records import OrgRecordsKernel
from chatticus.vendor_ledger import BILLED_VIA_VENDOR, VendorLedgerRow


def _seed_enabled_org(
    store: InMemoryMessagingStore, tenant_id: str, *, now: datetime
) -> None:
    kernel = OrgRecordsKernel(store)
    kernel.admin_seed_organization(
        tenant_id,
        "owner@example.com",
        name="Anthus Labs",
        now=now,
    )


def test_highest_band_crossed_returns_top_band_only() -> None:
    assert _highest_band_crossed(Decimal("55"), Decimal("100"), (50, 80, 100)) == 50
    assert _highest_band_crossed(Decimal("85"), Decimal("100"), (50, 80, 100)) == 80


def test_run_daily_rollup_skips_vendor_threshold_while_ce_pending() -> None:
    now = datetime(2026, 8, 31, 6, 0, tzinfo=UTC)
    store = InMemoryMessagingStore()
    _seed_enabled_org(store, "anthus", now=now)
    store.insert_vendor_ledger_row(
        VendorLedgerRow(
            tenant_id="anthus",
            turn_id="turn-1",
            vendor="openai",
            model="gpt-test",
            input_tokens=1,
            output_tokens=1,
            billed_via=BILLED_VIA_VENDOR,
            input_price_per_million_usd=Decimal("2"),
            output_price_per_million_usd=Decimal("4"),
            cost_usd=Decimal("10"),
            recorded_at=datetime(2026, 8, 31, 12, 0, tzinfo=UTC),
        )
    )
    cost_explorer = FakeCostExplorerReader()
    cost_explorer.set_day_pending("development", date(2026, 8, 31))
    alerts = FakeBudgetAlertsPublisher()
    run_daily_rollup(
        store=store,
        cost_explorer=cost_explorer,
        alerts=alerts,
        environment="development",
        rollup_date=date(2026, 8, 31),
        monthly_limit_usd=Decimal("100"),
        now=now,
    )
    row = store.get_budget_rollup_row("anthus", "development", date(2026, 8, 31))
    assert row is not None
    assert row.ce_status == "pending"
    assert row.aws_cost_usd is None
    assert alerts.published == []


def test_record_budget_alert_ignores_rollup_threshold_messages() -> None:
    now = datetime(2026, 8, 31, 6, 0, tzinfo=UTC)
    store = InMemoryMessagingStore()
    recorded = record_budget_alert_from_sns(
        store=store,
        environment="development",
        rollup_date=date(2026, 8, 31),
        sns_message='{"source":"chatticus.daily_rollup","kind":"vendor_threshold"}',
        now=now,
    )
    assert recorded is False
    assert store.get_account_budget_rollup_row("development", date(2026, 8, 31)) is None

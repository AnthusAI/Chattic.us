"""Request principal: who is calling and whether they may use the product."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from chatticus.models import MemberRole

Role = MemberRole


class PrincipalKind(StrEnum):
    """Kind of authenticated caller."""

    USER = "user"
    WORKER = "worker"


class MembershipStatus(StrEnum):
    """Whether a user principal may reach enabled-member routes."""

    ENABLED = "enabled"
    WAITLISTED = "waitlisted"


@dataclass(frozen=True)
class Principal:
    """Resolved caller for one HTTP request."""

    kind: PrincipalKind
    tenant_id: str
    user_id: str | None = None
    worker_id: str | None = None
    membership_status: MembershipStatus | None = None
    role: Role | None = None

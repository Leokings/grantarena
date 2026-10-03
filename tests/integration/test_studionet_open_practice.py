"""Opt-in, idempotent creation of a zero-pool public practice round on StudioNet."""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from genlayer_py import create_account
from gltest import get_contract_factory

from tests.integration.test_studionet_v2 import _read, _write


ADDRESS = "0x1ce8DB3eD235dEdF7e2Ec9E4318EbdD99Ad43F6f"
ROUND_KEY = "public-practice-2026-oct"

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("RUN_STUDIONET_PRACTICE") != "1",
        reason="opt-in permanent StudioNet practice round",
    ),
]


def test_open_decision_only_practice_round():
    root = Path(__file__).resolve().parents[2]
    owner_key = (root / ".env.funded-canary").read_text(encoding="ascii").strip()
    owner = create_account(owner_key)
    factory = get_contract_factory(contract_file_path=root / "contracts" / "grant_arena.py")
    contract = factory.build_contract(ADDRESS, account=owner)

    info = _read(contract, "get_contract_info", [])
    assert info["version"] == "grantarena/v2"
    for round_id in range(1, int(info["round_count"]) + 1):
        record = _read(contract, "get_round", [round_id])
        if record["round_key"] == ROUND_KEY and record["creator"].lower() == str(owner.address).lower():
            assert int(record["pool_atto"]) == 0
            print(f"PRACTICE_ROUND_EXISTING id={round_id} status={record['status']}", flush=True)
            return

    deadline = int((datetime.now(timezone.utc) + timedelta(days=45)).timestamp())
    criteria = [
        {
            "id": "public-usefulness",
            "label": "Public usefulness",
            "description": "Explain who benefits, what problem is solved, and how the public can measure the result.",
            "weight": 55,
        },
        {
            "id": "delivery-plan",
            "label": "Delivery plan",
            "description": "Explain milestones, ownership, acceptance tests, and realistic delivery risks.",
            "weight": 45,
        },
    ]
    receipt = _write(
        ADDRESS,
        "create_round",
        owner,
        [
            ROUND_KEY,
            "Open practice round - no payout",
            "A public practice round for first-time GrantArena applicants. This round has no prize pool or payout. Submit a real plan to inspect AI rubric scoring and the public on-chain record; do not share private information.",
            deadline,
            3 * 24 * 60 * 60,
            1,
            60,
            0,
            "0x0000000000000000000000000000000000000000",
            json.dumps(criteria),
            json.dumps([10_000]),
        ],
    )
    info_after = _read(contract, "get_contract_info", [])
    round_id = int(info_after["round_count"])
    record = _read(contract, "get_round", [round_id])
    assert record["round_key"] == ROUND_KEY
    assert record["status"] == "OPEN"
    assert int(record["pool_atto"]) == 0
    assert int(record["submission_deadline"]) == deadline
    print(f"PRACTICE_ROUND_CREATED id={round_id} tx={receipt.get('hash')}", flush=True)

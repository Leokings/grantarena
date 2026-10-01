"""Opt-in native-value canary against the existing StudioNet deployment.

Transfers 0.005 StudioNet test GEN from the already unlocked CLI test wallet to
a dedicated local canary wallet, then verifies cancellation and EOA credit.
The canary's generated key is stored in a Git-ignored local file for recovery.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from gltest import create_accounts, get_contract_factory
from gltest.assertions import tx_execution_succeeded
from gltest.types import TransactionHashVariant, TransactionStatus
from genlayer_py import create_account

from tests.integration.test_studionet_live import CONTRACT_ADDRESS, _rpc


POOL_ATTO = 10**15  # 0.001 developer-network GEN
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("RUN_STUDIONET_FUNDED") != "1",
        reason="opt-in funded StudioNet canary",
    ),
]


def _ok(receipt):
    assert tx_execution_succeeded(receipt), json.dumps(receipt, indent=2, default=str)
    assert receipt.get("status_name") == TransactionStatus.FINALIZED.value
    return receipt


def _balance(address: str) -> int:
    result = _rpc("eth_getBalance", [address, "latest"])
    return int(result, 16) if isinstance(result, str) else int(result)


def test_funded_round_cancellation_and_external_withdrawal():
    # Keep the opt-in test wallet recoverable if a hosted network call fails.
    # This path is excluded from Git by .env.* in the project ignore file.
    key_path = Path(__file__).resolve().parents[2] / ".env.funded-canary"
    if key_path.exists():
        owner = create_account(key_path.read_text(encoding="ascii").strip())
    else:
        owner = create_accounts(1)[0]
        key_path.write_text(owner.key.hex(), encoding="ascii")
    source = Path(__file__).resolve().parents[2] / "contracts" / "grant_arena.py"
    factory = get_contract_factory(contract_file_path=source)
    contract = factory.build_contract(CONTRACT_ADDRESS, account=owner)
    key = f"value-canary-{int(datetime.now(timezone.utc).timestamp())}"
    cli = shutil.which("genlayer.cmd") or shutil.which("genlayer")
    assert cli is not None, "GenLayer CLI is not installed on PATH"

    funded_balance = _balance(str(owner.address))
    if funded_balance < POOL_ATTO:
        transfer = subprocess.run(
            [
                cli, "account", "send", str(owner.address), "0.005gen",
                "--network", "studionet", "--account", "ic-builds-bradbury",
            ],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        assert transfer.returncode == 0, transfer.stderr[-500:]
        for _ in range(30):
            funded_balance = _balance(str(owner.address))
            if funded_balance >= POOL_ATTO:
                break
            time.sleep(2)
    assert funded_balance >= POOL_ATTO, "StudioNet transfer was not credited to the canary account"

    before = contract.get_contract_info(args=[]).call(
        transaction_hash_variant=TransactionHashVariant.LATEST_FINAL
    )
    resume_round_id = int(os.environ.get("CANARY_ROUND_ID", "0"))
    expected_round_id = resume_round_id or int(before["round_count"]) + 1
    criteria = [
        {
            "id": "impact",
            "label": "Public impact",
            "description": "Describe the people served and the measurable public outcome.",
            "weight": 60,
        },
        {
            "id": "delivery",
            "label": "Delivery plan",
            "description": "Describe the owned milestones, acceptance tests, and risks.",
            "weight": 40,
        },
    ]
    deadline = int((datetime.now(timezone.utc) + timedelta(days=1)).timestamp())
    created_hash = None
    if not resume_round_id:
        created = _ok(contract.create_round(args=[
            key,
            "Native value canary",
            "Verify that real StudioNet native test GEN can enter and leave this intelligent contract.",
            deadline,
            60,
            1,
            50,
            0,
            json.dumps(criteria, separators=(",", ":")),
            json.dumps([10_000]),
        ]).transact(value=POOL_ATTO, wait_transaction_status=TransactionStatus.FINALIZED))
        created_hash = created["hash"]

    round_record = contract.get_round(args=[expected_round_id]).call(
        transaction_hash_variant=TransactionHashVariant.LATEST_FINAL
    )
    assert int(round_record["pool_atto"]) == POOL_ATTO
    assert round_record["creator"].lower() == str(owner.address).lower()
    assert round_record["status"] == "OPEN"
    balance_after_create = _balance(str(owner.address))
    if not resume_round_id:
        assert balance_after_create <= funded_balance - POOL_ATTO

    cancelled = _ok(contract.cancel_empty_round(args=[expected_round_id]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    ))
    claimable = contract.get_claimable(args=[owner.address]).call(
        transaction_hash_variant=TransactionHashVariant.LATEST_FINAL
    )
    assert int(claimable) == POOL_ATTO

    withdrawal = _ok(contract.withdraw(args=[]).transact(
        wait_transaction_status=TransactionStatus.FINALIZED
    ))
    queued = contract.get_withdrawal(args=[int(before["withdrawal_count"]) + 1]).call(
        transaction_hash_variant=TransactionHashVariant.LATEST_FINAL
    )
    assert queued["status"] == "TRANSFER_QUEUED"
    assert int(queued["amount_atto"]) == POOL_ATTO
    assert int(contract.get_claimable(args=[owner.address]).call(
        transaction_hash_variant=TransactionHashVariant.LATEST_FINAL
    )) == 0

    balance_after_withdrawal = 0
    for _ in range(20):
        balance_after_withdrawal = _balance(str(owner.address))
        if balance_after_withdrawal >= balance_after_create + POOL_ATTO:
            break
        time.sleep(2)
    assert balance_after_withdrawal >= balance_after_create + POOL_ATTO

    print("GRANTARENA_FUNDED_CANARY=" + json.dumps({
        "schema": "grantarena-funded-canary/v1",
        "contract_address": CONTRACT_ADDRESS,
        "round_id": expected_round_id,
        "pool_atto": POOL_ATTO,
        "create_transaction": created_hash,
        "cancel_transaction": cancelled["hash"],
        "withdraw_transaction": withdrawal["hash"],
        "owner_address": str(owner.address),
        "balance_after_create": balance_after_create,
        "balance_after_withdrawal": balance_after_withdrawal,
        "external_credit_observed": True,
    }, sort_keys=True))

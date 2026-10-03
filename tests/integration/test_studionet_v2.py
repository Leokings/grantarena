"""Opt-in StudioNet v2 funded attestation and payout canary (test GEN only)."""

from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest
from genlayer_py import create_account
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded
from gltest.clients import get_gl_client
from gltest.types import TransactionHashVariant, TransactionStatus
from gltest.utils import extract_contract_address

from tests.integration.test_studionet_live import _rpc


POOL_ATTO = 1_000_000_000_000_000
AWARD_ATTO = 600_000_000_000_000

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(os.environ.get("RUN_STUDIONET_V2") != "1", reason="opt-in live v2 test"),
]


def _ok(receipt: dict[str, Any]) -> dict[str, Any]:
    assert receipt.get("status_name") == TransactionStatus.FINALIZED.value, receipt
    assert tx_execution_succeeded(receipt), json.dumps(receipt, indent=2, default=str)
    return receipt


def _read(contract: Any, method: str, args: list[Any]) -> Any:
    for attempt in range(5):
        try:
            return getattr(contract, method)(args=args).call(
                transaction_hash_variant=TransactionHashVariant.LATEST_FINAL
            )
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2**attempt)
    raise AssertionError("unreachable")


def _balance(address: str) -> int:
    for attempt in range(5):
        try:
            return int(_rpc("eth_getBalance", [address, "latest"]), 16)
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2**attempt)
    raise AssertionError("unreachable")


def _write(address: str, method: str, account: Any, args: list[Any], value: int = 0) -> dict[str, Any]:
    client = get_gl_client()
    # Never retry an ambiguous send: it could create a duplicate transaction.
    tx_hash = client.write_contract(address=address, function_name=method, account=account, value=value, leader_only=False, args=args)
    print(f"V2_TX {method} {tx_hash}", flush=True)
    until = time.monotonic() + 900
    while time.monotonic() < until:
        try:
            receipt = client.get_transaction(tx_hash)
        except Exception as error:
            print(f"V2_RPC_RETRY {method} {type(error).__name__}", flush=True)
            time.sleep(3)
            continue
        if receipt.get("status_name") == TransactionStatus.FINALIZED.value:
            return _ok(receipt)
        if receipt.get("status_name") == TransactionStatus.CANCELED.value:
            pytest.fail(f"{method} was canceled: {tx_hash}")
        time.sleep(3)
    pytest.fail(f"{method} did not finalize: {tx_hash}")


def test_studionet_v2_attested_award_and_withdrawal():
    root = Path(__file__).resolve().parents[2]
    owner_key = (root / ".env.funded-canary").read_text(encoding="ascii").strip()
    owner_key_bytes = bytes.fromhex(owner_key.removeprefix("0x"))
    owner = create_account(owner_key)
    applicant = create_account(hashlib.sha256(owner_key_bytes + b"grantarena-v2-applicant").digest())
    reviewer = create_account(hashlib.sha256(owner_key_bytes + b"grantarena-v2-reviewer").digest())
    assert len({str(owner.address).lower(), str(applicant.address).lower(), str(reviewer.address).lower()}) == 3
    assert _balance(str(owner.address)) >= POOL_ATTO

    factory = get_contract_factory(contract_file_path=root / "contracts" / "grant_arena.py")
    deployed = _ok(factory.deploy_contract_tx(args=[], account=owner, wait_transaction_status=TransactionStatus.FINALIZED))
    address = extract_contract_address(deployed)
    assert address is not None
    print(f"V2_DEPLOYED {address} tx={deployed.get('hash')}", flush=True)
    admin = factory.build_contract(address, account=owner)
    assert _read(admin, "get_contract_info", [])["version"] == "grantarena/v2"

    now = int(datetime.now(timezone.utc).timestamp())
    deadline = now + 180
    criteria = [
        {"id": "impact", "label": "Public impact", "description": "Describe beneficiaries, measurable public outcomes, and how results will be independently published.", "weight": 55},
        {"id": "delivery", "label": "Delivery confidence", "description": "Describe milestones, named owners, acceptance tests, and fallback plans for delivery risks.", "weight": 45},
    ]
    created = _write(address, "create_round", owner, [
        "reviewed-award-v2", "Reviewed public tools award",
        "Test a public grant round where independent reviewer attestation is required before any test-GEN award can be credited.",
        deadline, 60, 1, 25, 0, str(reviewer.address), json.dumps(criteria), json.dumps([10_000]),
    ], value=POOL_ATTO)
    round_record = _read(admin, "get_round", [1])
    assert round_record["reviewer"].lower() == str(reviewer.address).lower()
    assert int(round_record["pool_atto"]) == POOL_ATTO

    answers = {
        "impact": "The proposed open-source dashboard will help small maintainers prioritize dependency alerts. Its pilot targets 25 repositories, publishes weekly active projects and confirmed alerts resolved, and releases anonymized measurements with an independent review checklist each month.",
        "delivery": "A named two-person team will deliver ingestion in week two, a maintainer dashboard in week four, and a documented API in week six. Acceptance tests cover malformed inputs, access control, deterministic fixtures, and provider-outage recovery using cached snapshots.",
    }
    submitted = _write(address, "submit_proposal", applicant, [
        1, "public-dependency-dashboard", "Public dependency dashboard",
        "A public dependency-health dashboard for small open-source teams, with a staged pilot, measurable outcomes, and open release artifacts.",
        AWARD_ATTO, json.dumps(answers), json.dumps(["https://github.com/genlayerlabs"]),
    ])
    proposal = _read(admin, "get_proposal", [1])
    assert proposal["status"] == "QUALIFIED", proposal
    assert int(proposal["attested_at"]) == 0
    digest = proposal["evidence_digest"]
    assert len(digest) == 64

    attested = _write(address, "attest_proposal", reviewer, [
        1, digest,
        "For this StudioNet canary I reviewed the exact proposal digest and public reference; this signature tests the payout gate, not the truth of project claims.",
    ])
    proposal = _read(admin, "get_proposal", [1])
    assert proposal["attested_digest"] == digest
    assert proposal["attested_by"].lower() == str(reviewer.address).lower()

    wait_seconds = int(round_record["appeal_deadline"]) - int(datetime.now(timezone.utc).timestamp()) + 3
    while wait_seconds > 0:
        print(f"V2_APPEAL_WAIT seconds={wait_seconds}", flush=True)
        time.sleep(min(30, wait_seconds))
        wait_seconds = int(round_record["appeal_deadline"]) - int(datetime.now(timezone.utc).timestamp()) + 3
    finalized = _write(address, "finalize_round", owner, [1])
    round_record = _read(admin, "get_round", [1])
    proposal = _read(admin, "get_proposal", [1])
    assert round_record["status"] == "FINALIZED"
    assert round_record["winner_ids"] == [1]
    assert int(round_record["allocated_atto"]) == AWARD_ATTO
    assert proposal["status"] == "FUNDED" and int(proposal["award_atto"]) == AWARD_ATTO
    assert int(_read(admin, "get_claimable", [applicant.address])) == AWARD_ATTO

    before_winner_balance = _balance(str(applicant.address))
    withdrawn = _write(address, "withdraw", applicant, [])
    for _ in range(40):
        if _balance(str(applicant.address)) >= before_winner_balance + AWARD_ATTO:
            break
        time.sleep(3)
    after_winner_balance = _balance(str(applicant.address))
    assert after_winner_balance >= before_winner_balance + AWARD_ATTO
    assert int(_read(admin, "get_claimable", [applicant.address])) == 0
    info = _read(admin, "get_contract_info", [])
    assert int(info["total_escrow_atto"]) + int(info["total_claimable_atto"]) == int(info["total_liability_atto"])

    print("GRANTARENA_V2_EVIDENCE=" + json.dumps({
        "schema": "grantarena-studionet-attested-award/v2",
        "network": "GenLayer StudioNet",
        "contractAddress": address,
        "deploymentTransaction": str(deployed.get("hash")),
        "roundId": 1,
        "proposalId": 1,
        "creatorAddress": str(owner.address),
        "reviewerAddress": str(reviewer.address),
        "winnerAddress": str(applicant.address),
        "proposalDigest": digest,
        "poolAtto": str(POOL_ATTO),
        "awardAtto": str(AWARD_ATTO),
        "winnerBalanceBeforeAtto": str(before_winner_balance),
        "winnerBalanceAfterAtto": str(after_winner_balance),
        "transactions": {
            "createRound": str(created.get("hash")),
            "submitProposal": str(submitted.get("hash")),
            "attestProposal": str(attested.get("hash")),
            "finalizeRound": str(finalized.get("hash")),
            "winnerWithdraw": str(withdrawn.get("hash")),
        },
    }, sort_keys=True), flush=True)

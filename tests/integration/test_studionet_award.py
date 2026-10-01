"""Opt-in, recoverable StudioNet contest and funded-winner payout canary.

Run with:
    $env:RUN_STUDIONET_AWARD = "1"
    gltest tests/integration/test_studionet_award.py -v -s --network studionet

The owner key is the Git/Vercel-ignored key from the funded cancellation canary.
The applicant key is deterministically derived from it, so a network interruption
cannot strand an unrecoverable test payout. This uses only StudioNet test GEN.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import pytest
from genlayer_py import create_account
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded
from gltest.clients import get_gl_client
from gltest.types import TransactionHashVariant, TransactionStatus

from tests.integration.test_studionet_live import CONTRACT_ADDRESS, _rpc


POOL_ATTO = 1_000_000_000_000_000  # 0.001 StudioNet test GEN
REQUEST_ATTO = 600_000_000_000_000  # 0.0006 test GEN to the winner
ROUND_KEY = "contest-award-canary-20261001"
PROPOSAL_KEY = "maintainer-signal-award-canary"

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("RUN_STUDIONET_AWARD") != "1",
        reason="opt-in funded StudioNet contest and payout",
    ),
]


def _retry(action: Callable[[], Any], *, attempts: int = 5) -> Any:
    for attempt in range(attempts):
        try:
            return action()
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(min(2**attempt, 8))
    raise AssertionError("unreachable")


def _read(contract: Any, method: str, args: list[Any]) -> Any:
    return _retry(
        lambda: getattr(contract, method)(args=args).call(
            transaction_hash_variant=TransactionHashVariant.LATEST_FINAL
        )
    )


def _balance(address: str) -> int:
    raw = _retry(lambda: _rpc("eth_getBalance", [address, "latest"]))
    return int(raw, 16) if isinstance(raw, str) else int(raw)


def _write(method: str, account: Any, args: list[Any], value: int = 0) -> dict[str, Any]:
    client = get_gl_client()
    # Do not retry an ambiguous send: that could create a duplicate transaction.
    # The round/proposal lookup below makes rerunning this test recoverable.
    tx_hash = client.write_contract(
        address=CONTRACT_ADDRESS,
        function_name=method,
        account=account,
        value=value,
        leader_only=False,
        args=args,
    )
    print(f"STUDIONET_TX {method} {tx_hash}", flush=True)
    until = time.monotonic() + 900
    last_status = "not observed"
    last_report = 0.0
    while time.monotonic() < until:
        try:
            receipt = client.get_transaction(tx_hash)
        except Exception as error:
            print(f"STUDIONET_RPC_RETRY {method} {type(error).__name__}", flush=True)
            time.sleep(3)
            continue
        last_status = str(receipt.get("status_name", "unknown"))
        if last_status == TransactionStatus.FINALIZED.value:
            assert tx_execution_succeeded(receipt), json.dumps(receipt, indent=2, default=str)
            assert receipt.get("result_name") in (None, "AGREE", "MAJORITY_AGREE")
            return {"hash": str(tx_hash), "receipt": receipt}
        if last_status == TransactionStatus.CANCELED.value:
            pytest.fail(f"{method} was canceled: {tx_hash}")
        if time.monotonic() - last_report > 30:
            print(f"STUDIONET_PENDING {method} {last_status}", flush=True)
            last_report = time.monotonic()
        time.sleep(3)
    pytest.fail(f"{method} {tx_hash} did not finalize in 15 minutes; last={last_status}")


def _find_round(contract: Any) -> dict[str, Any] | None:
    info = _read(contract, "get_contract_info", [])
    for round_id in range(1, int(info["round_count"]) + 1):
        round_record = _read(contract, "get_round", [round_id])
        if round_record["round_key"] == ROUND_KEY:
            return round_record
    return None


def test_live_contest_and_funded_winner_payout():
    root = Path(__file__).resolve().parents[2]
    owner_key = (root / ".env.funded-canary").read_text(encoding="ascii").strip()
    owner = create_account(owner_key)
    # Domain-separated derivation; do not log either private key.
    applicant_key = hashlib.sha256(
        bytes.fromhex(owner_key.removeprefix("0x")) + b"grantarena-award-applicant-v1"
    ).digest()
    applicant = create_account(applicant_key)
    source = root / "contracts" / "grant_arena.py"
    factory = get_contract_factory(contract_file_path=source)
    admin = factory.build_contract(CONTRACT_ADDRESS, account=owner)
    proposer = factory.build_contract(CONTRACT_ADDRESS, account=applicant)
    txs: dict[str, str] = {}

    initial_owner_balance = _balance(str(owner.address))
    initial_applicant_balance = _balance(str(applicant.address))
    round_record = _find_round(admin)
    if round_record is None:
        assert initial_owner_balance >= POOL_ATTO
        deadline = int(datetime.now(timezone.utc).timestamp()) + 4 * 60
        criteria = [
            {"id": "impact", "label": "Public impact", "description": "Identify the people served, the problem solved, and a measurable public outcome.", "weight": 55},
            {"id": "delivery", "label": "Delivery confidence", "description": "Provide concrete milestones, ownership, acceptance tests, and meaningful delivery risks.", "weight": 45},
        ]
        result = _write("create_round", owner, [
            ROUND_KEY,
            "Maintainer Signal test award",
            "Fund an open dependency-health dashboard for small maintainers, with measurable public benefit and a credible delivery plan.",
            deadline,
            6 * 60,
            1,
            50,
            0,
            json.dumps(criteria, separators=(",", ":")),
            json.dumps([10_000]),
        ], value=POOL_ATTO)
        txs["create_round"] = result["hash"]
        round_record = _find_round(admin)
    assert round_record is not None
    round_id = int(round_record["round_id"])
    assert round_record["creator"].lower() == str(owner.address).lower()
    assert int(round_record["pool_atto"]) == POOL_ATTO
    print(f"STUDIONET_ROUND {round_id} creator={owner.address} applicant={applicant.address}", flush=True)

    if int(round_record["proposal_count"]) == 0:
        answers = {
            "impact": (
                "We will give small open-source teams a public health dashboard for their dependencies. "
                "The first release targets 25 maintainers and measures weekly active projects, confirmed "
                "alerts resolved, and median time from alert to resolution. All aggregate metrics and the "
                "evaluation methodology will be published under an open license."
            ),
            "delivery": (
                "A named two-person team will deliver an ingestion service in week two, maintainer dashboard "
                "in week four, and documented API plus independent security review in week six. Acceptance "
                "tests cover deterministic fixtures, malformed inputs, access controls, and a 99 percent "
                "successful replay target. Risks include upstream rate limits; cached snapshots and backoff "
                "are the documented fallback."
            ),
        }
        result = _write("submit_proposal", applicant, [
            round_id,
            PROPOSAL_KEY,
            "Maintainer Signal",
            "An open dependency-health dashboard that helps small maintainer teams find, prioritize, and resolve actionable ecosystem risks.",
            REQUEST_ATTO,
            json.dumps(answers, separators=(",", ":")),
            json.dumps(["https://github.com/genlayerlabs"]),
        ])
        txs["submit_proposal"] = result["hash"]
        round_record = _read(admin, "get_round", [round_id])
    assert int(round_record["proposal_count"]) == 1
    proposal_id = int(round_record["proposal_ids"][0])
    proposal = _read(admin, "get_proposal", [proposal_id])
    assert proposal["proposer"].lower() == str(applicant.address).lower()
    assert proposal["proposal_key"] == PROPOSAL_KEY
    assert proposal["status"] == ("FUNDED" if round_record["status"] == "FINALIZED" else "QUALIFIED"), proposal
    print(f"STUDIONET_PROPOSAL {proposal_id} score={proposal['weighted_score']}", flush=True)

    if not proposal["contest_used"]:
        addendum = (
            "After submission, two independent maintainers agreed to test the dashboard with 25 repositories. "
            "Their signed acceptance checklist will record false alerts and time to resolution."
        )
        result = _write("contest_proposal", applicant, [proposal_id, addendum])
        txs["contest_proposal"] = result["hash"]
        proposal = _read(admin, "get_proposal", [proposal_id])
    assert proposal["contest_used"] is True
    assert len(proposal["contest_addendum"]) >= 80
    assert proposal["status"] == ("FUNDED" if round_record["status"] == "FINALIZED" else "QUALIFIED"), proposal
    print(f"STUDIONET_CONTEST {proposal_id} score={proposal['weighted_score']}", flush=True)

    round_record = _read(admin, "get_round", [round_id])
    if round_record["status"] == "OPEN":
        remaining = int(round_record["appeal_deadline"]) - int(datetime.now(timezone.utc).timestamp())
        while remaining > 0:
            print(f"STUDIONET_APPEAL_WAIT remaining_seconds={remaining}", flush=True)
            time.sleep(min(30, remaining + 2))
            remaining = int(round_record["appeal_deadline"]) - int(datetime.now(timezone.utc).timestamp())
        time.sleep(3)
        result = _write("finalize_round", owner, [round_id])
        txs["finalize_round"] = result["hash"]
        round_record = _read(admin, "get_round", [round_id])
    assert round_record["status"] == "FINALIZED"
    assert round_record["winner_ids"] == [proposal_id]
    assert int(round_record["allocated_atto"]) == REQUEST_ATTO
    assert int(round_record["returned_atto"]) == POOL_ATTO - REQUEST_ATTO
    proposal = _read(admin, "get_proposal", [proposal_id])
    assert proposal["status"] == "FUNDED"
    assert int(proposal["award_atto"]) == REQUEST_ATTO
    winner_claimable = int(_read(admin, "get_claimable", [applicant.address]))
    owner_claimable = int(_read(admin, "get_claimable", [owner.address]))
    assert winner_claimable in (0, REQUEST_ATTO)
    assert owner_claimable in (0, POOL_ATTO - REQUEST_ATTO)

    before_applicant_withdrawal = _balance(str(applicant.address))
    if winner_claimable:
        result = _write("withdraw", applicant, [])
        txs["winner_withdraw"] = result["hash"]
        for _ in range(40):
            if _balance(str(applicant.address)) >= before_applicant_withdrawal + REQUEST_ATTO:
                break
            time.sleep(3)
    final_applicant_balance = _balance(str(applicant.address))
    assert final_applicant_balance >= before_applicant_withdrawal + winner_claimable
    assert final_applicant_balance >= REQUEST_ATTO
    assert int(_read(admin, "get_claimable", [applicant.address])) == 0

    before_owner_withdrawal = _balance(str(owner.address))
    if owner_claimable:
        result = _write("withdraw", owner, [])
        txs["owner_remainder_withdraw"] = result["hash"]
        for _ in range(40):
            if _balance(str(owner.address)) >= before_owner_withdrawal + owner_claimable:
                break
            time.sleep(3)
    final_owner_balance = _balance(str(owner.address))
    assert final_owner_balance >= before_owner_withdrawal + owner_claimable
    assert int(_read(admin, "get_claimable", [owner.address])) == 0
    info = _read(admin, "get_contract_info", [])
    assert int(info["total_escrow_atto"]) + int(info["total_claimable_atto"]) == int(info["total_liability_atto"])

    print("GRANTARENA_AWARD_EVIDENCE=" + json.dumps({
        "schema": "grantarena-studionet-award/v1",
        "contract_address": CONTRACT_ADDRESS,
        "round_id": round_id,
        "proposal_id": proposal_id,
        "pool_atto": POOL_ATTO,
        "winner_award_atto": REQUEST_ATTO,
        "creator_remainder_atto": POOL_ATTO - REQUEST_ATTO,
        "proposal_status": proposal["status"],
        "contest_used": proposal["contest_used"],
        "round_status": round_record["status"],
        "winner_address": str(applicant.address),
        "creator_address": str(owner.address),
        "initial_owner_balance_atto": initial_owner_balance,
        "final_owner_balance_atto": final_owner_balance,
        "initial_winner_balance_atto": initial_applicant_balance,
        "final_winner_balance_atto": final_applicant_balance,
        "transactions": txs,
    }, sort_keys=True), flush=True)

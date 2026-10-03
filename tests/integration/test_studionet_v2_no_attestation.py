"""Opt-in StudioNet test: a qualified, unreviewed funded proposal receives no award."""

from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest
from genlayer_py import create_account
from gltest import get_contract_factory

from tests.integration.test_studionet_v2 import _balance, _read, _write


ADDRESS = "0x1ce8DB3eD235dEdF7e2Ec9E4318EbdD99Ad43F6f"
POOL_ATTO = 100_000_000_000_000  # 0.0001 StudioNet test GEN
ROUND_KEY = "unattested-award-v2"

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(os.environ.get("RUN_STUDIONET_V2_NEGATIVE") != "1", reason="opt-in live negative payout test"),
]


def test_studionet_unattested_qualified_proposal_is_not_paid():
    root = Path(__file__).resolve().parents[2]
    owner_key = (root / ".env.funded-canary").read_text(encoding="ascii").strip()
    owner_key_bytes = bytes.fromhex(owner_key.removeprefix("0x"))
    owner = create_account(owner_key)
    applicant = create_account(hashlib.sha256(owner_key_bytes + b"grantarena-v2-applicant").digest())
    reviewer = create_account(hashlib.sha256(owner_key_bytes + b"grantarena-v2-reviewer").digest())
    factory = get_contract_factory(contract_file_path=root / "contracts" / "grant_arena.py")
    admin = factory.build_contract(ADDRESS, account=owner)
    assert _read(admin, "get_contract_info", [])["version"] == "grantarena/v2"

    info = _read(admin, "get_contract_info", [])
    round_record = None
    for round_id in range(1, int(info["round_count"]) + 1):
        candidate = _read(admin, "get_round", [round_id])
        if candidate["round_key"] == ROUND_KEY:
            round_record = candidate
            break
    creator_claimable_before = int(_read(admin, "get_claimable", [owner.address]))
    transactions: dict[str, str] = {}
    if round_record is None:
        assert _balance(str(owner.address)) >= POOL_ATTO
        deadline = int(datetime.now(timezone.utc).timestamp()) + 180
        criteria = [
            {"id": "impact", "label": "Public impact", "description": "Explain the beneficiaries, outcome metrics, and evidence for the claimed public benefit.", "weight": 55},
            {"id": "delivery", "label": "Delivery confidence", "description": "Explain owners, milestones, acceptance tests, and delivery risk controls.", "weight": 45},
        ]
        created = _write(ADDRESS, "create_round", owner, [
            ROUND_KEY, "Unattested payout gate test",
            "This StudioNet canary tests whether a qualified proposal without the named reviewer's signature is excluded from funded awards.",
            deadline, 60, 1, 25, 0, str(reviewer.address), json.dumps(criteria), json.dumps([10_000]),
        ], value=POOL_ATTO)
        transactions["createRound"] = str(created.get("hash"))
        round_record = _read(admin, "get_round", [int(info["round_count"]) + 1])
    assert round_record is not None
    round_id = int(round_record["round_id"])
    assert int(round_record["pool_atto"]) == POOL_ATTO
    assert round_record["reviewer"].lower() == str(reviewer.address).lower()

    if int(round_record["proposal_count"]) == 0:
        answers = {
            "impact": "The proposed public dependency dashboard serves small maintainers, publishes monthly usage and alert-resolution metrics, and includes a pilot across 25 repositories with openly documented methodology and anonymized results.",
            "delivery": "A named team plans three milestones covering ingestion, dashboard, and a documented API. Acceptance tests include malformed input handling, access control, deterministic replay, and recovery from upstream provider outages.",
        }
        submitted = _write(ADDRESS, "submit_proposal", applicant, [
            round_id, "unsigned-review-canary", "Unsigned review canary",
            "This canary deliberately leaves reviewer attestation absent while otherwise supplying a complete grant proposal and HTTPS reference.",
            POOL_ATTO, json.dumps(answers), json.dumps(["https://github.com/genlayerlabs"]),
        ])
        transactions["submitProposal"] = str(submitted.get("hash"))
        round_record = _read(admin, "get_round", [round_id])
    proposal_id = int(round_record["proposal_ids"][0])
    proposal = _read(admin, "get_proposal", [proposal_id])
    assert proposal["status"] == "QUALIFIED", proposal
    assert int(proposal["attested_at"]) == 0

    if round_record["status"] == "OPEN":
        wait_seconds = int(round_record["appeal_deadline"]) - int(datetime.now(timezone.utc).timestamp()) + 3
        while wait_seconds > 0:
            print(f"V2_NEGATIVE_APPEAL_WAIT seconds={wait_seconds}", flush=True)
            time.sleep(min(30, wait_seconds))
            wait_seconds = int(round_record["appeal_deadline"]) - int(datetime.now(timezone.utc).timestamp()) + 3
        finalized = _write(ADDRESS, "finalize_round", owner, [round_id])
        transactions["finalizeRound"] = str(finalized.get("hash"))
        round_record = _read(admin, "get_round", [round_id])
    proposal = _read(admin, "get_proposal", [proposal_id])
    assert round_record["status"] == "FINALIZED"
    assert round_record["winner_ids"] == []
    assert int(round_record["allocated_atto"]) == 0
    assert int(round_record["returned_atto"]) == POOL_ATTO
    assert proposal["status"] == "QUALIFIED" and int(proposal["award_atto"]) == 0
    assert int(_read(admin, "get_claimable", [applicant.address])) == 0
    minimum_creator_credit = POOL_ATTO if round_record["status"] == "FINALIZED" and not transactions else creator_claimable_before + POOL_ATTO
    assert int(_read(admin, "get_claimable", [owner.address])) >= minimum_creator_credit
    print("GRANTARENA_V2_NO_ATTESTATION=" + json.dumps({
        "contractAddress": ADDRESS,
        "roundId": round_id,
        "proposalId": proposal_id,
        "proposalScore": proposal["weighted_score"],
        "attestedAt": proposal["attested_at"],
        "winnerIds": round_record["winner_ids"],
        "allocatedAtto": round_record["allocated_atto"],
        "returnedAtto": round_record["returned_atto"],
        "transactions": transactions,
    }, sort_keys=True), flush=True)

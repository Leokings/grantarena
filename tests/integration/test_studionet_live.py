"""Opt-in live verification for the deployed GrantArena contract.

Run with:
    $env:RUN_STUDIONET = "1"
    gltest tests/integration/test_studionet_live.py -v -s --network studionet

The test creates disposable in-memory accounts. StudioNet is gasless, so no
private key or funded wallet is written to the repository.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib import request

import pytest
from gltest import create_accounts, get_contract_factory
from gltest.assertions import tx_execution_succeeded
from gltest.types import TransactionHashVariant, TransactionStatus


CONTRACT_ADDRESS = "0x9459d5b6e3da734255C5ae6039Ed104d9D74F3B3"
DEPLOYMENT_TRANSACTION = "0xb34fe17f803162072c96b1d34a45c0811a053d1e17f21ef0ff5e42cd1e2ae40f"
STUDIONET_RPC = "https://studio.genlayer.com/api"

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("RUN_STUDIONET") != "1",
        reason="opt-in live StudioNet test",
    ),
]


def _ok(receipt: dict[str, Any]) -> dict[str, Any]:
    assert tx_execution_succeeded(receipt), json.dumps(receipt, indent=2, default=str)
    assert receipt.get("status_name") == TransactionStatus.FINALIZED.value
    assert receipt.get("result_name") in (None, "AGREE", "MAJORITY_AGREE")
    assert receipt.get("tx_execution_result_name") in (None, "FINISHED_WITH_RETURN")
    return receipt


def _rpc(method: str, params: list[Any]) -> Any:
    body = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    ).encode("utf-8")
    call = request.Request(
        STUDIONET_RPC,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "GrantArena-Verification/1.0",
        },
    )
    with request.urlopen(call, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    assert "error" not in payload, json.dumps(payload.get("error"), sort_keys=True)
    return payload["result"]


def test_studionet_live_round_and_consensus_proposal():
    creator, applicant = create_accounts(2)
    source = Path(__file__).resolve().parents[2] / "contracts" / "grant_arena_v1.py"
    factory = get_contract_factory(contract_file_path=source)
    creator_contract = factory.build_contract(CONTRACT_ADDRESS, account=creator)
    applicant_contract = factory.build_contract(CONTRACT_ADDRESS, account=applicant)

    before = creator_contract.get_contract_info(args=[]).call(
        transaction_hash_variant=TransactionHashVariant.LATEST_FINAL
    )
    expected_round_id = int(before["round_count"]) + 1
    unique_key = f"public-goods-{expected_round_id}"
    deadline = int((datetime.now(timezone.utc) + timedelta(days=120)).timestamp())
    criteria = [
        {
            "id": "impact",
            "label": "Public impact",
            "description": "Identify the people served, the problem solved, and a measurable public outcome.",
            "weight": 55,
        },
        {
            "id": "delivery",
            "label": "Delivery confidence",
            "description": "Provide concrete milestones, ownership, acceptance tests, and meaningful delivery risks.",
            "weight": 45,
        },
    ]

    created = _ok(
        creator_contract.create_round(
            args=[
                unique_key,
                "Open Public Goods Sprint",
                "Support useful open infrastructure with measurable community benefit and a credible delivery plan.",
                deadline,
                7 * 24 * 60 * 60,
                1,
                50,
                0,
                json.dumps(criteria, separators=(",", ":")),
                json.dumps([10_000]),
            ]
        ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    )

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
    submitted = _ok(
        applicant_contract.submit_proposal(
            args=[
                expected_round_id,
                f"maintainer-signal-{expected_round_id}",
                "Maintainer Signal",
                "An open dependency-health dashboard that helps small maintainer teams find, prioritize, and resolve actionable ecosystem risks.",
                50_000_000_000_000_000,
                json.dumps(answers, separators=(",", ":")),
                json.dumps(["https://github.com/genlayerlabs"]),
            ]
        ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    )

    round_record = creator_contract.get_round(args=[expected_round_id]).call(
        transaction_hash_variant=TransactionHashVariant.LATEST_FINAL
    )
    proposal_id = int(round_record["proposal_ids"][0])
    proposal = creator_contract.get_proposal(args=[proposal_id]).call(
        transaction_hash_variant=TransactionHashVariant.LATEST_FINAL
    )

    local_source = source.read_bytes()
    deployed_source = base64.b64decode(
        _rpc("gen_getContractCode", [CONTRACT_ADDRESS]), validate=True
    )
    schema = _rpc("gen_getContractSchema", [CONTRACT_ADDRESS])
    required_methods = {
        "create_round",
        "submit_proposal",
        "contest_proposal",
        "finalize_round",
        "get_round",
        "get_proposal",
        "list_rounds",
        "list_round_proposals",
    }

    assert deployed_source == local_source
    assert required_methods <= set(schema["methods"])
    assert int(round_record["round_id"]) == expected_round_id
    assert int(round_record["proposal_count"]) == 1
    assert proposal["status"] in {"QUALIFIED", "REJECTED"}
    assert len(proposal["grades"]) == 2
    assert 0 <= int(proposal["weighted_score"]) <= 100

    evidence = {
        "schema": "grantarena-live-evidence/v1",
        "network": {"name": "studionet", "chain_id": 61999, "rpc": STUDIONET_RPC},
        "contract_address": CONTRACT_ADDRESS,
        "deployment_transaction_hash": DEPLOYMENT_TRANSACTION,
        "create_round_transaction_hash": created["hash"],
        "submit_proposal_transaction_hash": submitted["hash"],
        "round_id": expected_round_id,
        "proposal_id": proposal_id,
        "round_status": round_record["status"],
        "proposal_status": proposal["status"],
        "proposal_score": int(proposal["weighted_score"]),
        "proposal_grades": proposal["grades"],
        "creator_address": str(creator.address),
        "applicant_address": str(applicant.address),
        "consensus": submitted.get("result_name"),
        "execution": submitted.get("tx_execution_result_name"),
        "source_sha256": hashlib.sha256(local_source).hexdigest(),
        "deployed_source_sha256": hashlib.sha256(deployed_source).hexdigest(),
        "source_exact": deployed_source == local_source,
        "schema_methods_verified": sorted(required_methods),
    }
    print("GRANTARENA_STUDIONET_EVIDENCE=" + json.dumps(evidence, sort_keys=True))

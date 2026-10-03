import json
from pathlib import Path

from gltest import get_contract_factory, get_validator_factory
from gltest.accounts import create_accounts
from gltest.assertions import tx_execution_succeeded
from gltest.types import TransactionStatus
from gltest.utils import extract_contract_address


def _ok(receipt):
    assert tx_execution_succeeded(receipt), json.dumps(receipt, default=str)


def test_five_validator_grant_scoring_flow():
    owner, applicant = create_accounts(2)
    source = Path(__file__).resolve().parents[2] / "contracts" / "grant_arena.py"
    factory = get_contract_factory(contract_file_path=source)
    deployed = factory.deploy_contract_tx(args=[], account=owner, wait_transaction_status=TransactionStatus.FINALIZED)
    _ok(deployed)
    admin = factory.build_contract(extract_contract_address(deployed), account=owner)
    applicant_contract = factory.build_contract(admin.address, account=applicant)
    criteria = [
        {"id": "impact", "label": "Public impact", "description": "Explain target users and a measurable public outcome for the proposed work.", "weight": 60},
        {"id": "delivery", "label": "Delivery confidence", "description": "Explain milestones, ownership, acceptance tests, and meaningful delivery risks.", "weight": 40},
    ]
    context = {"genvm_datetime": "2026-10-01T12:00:00Z"}
    _ok(admin.create_round(args=["open-infra-2026", "Open infrastructure grants", "Fund durable public infrastructure with measurable adoption and a credible delivery plan.", 1_790_859_600, 3600, 1, 60, 0, "0x0000000000000000000000000000000000000000", json.dumps(criteria), json.dumps([10000])]).transact(value=0, transaction_context=context, wait_transaction_status=TransactionStatus.FINALIZED))
    validators = get_validator_factory().batch_create_mock_validators(
        5,
        mock_llm_response={"nondet_exec_prompt": {"Evaluate this grant proposal": json.dumps({"grades": ["STRONG", "STRONG"]})}},
    )
    tx_context = {
        "validators": [validator.to_dict() for validator in validators],
        "genvm_datetime": "2026-10-01T12:01:00Z",
    }
    answers = {
        "impact": "The public index serves maintainers and measures adoption through independently published monthly users, confirmed alerts resolved, response time, and a documented pilot across several open-source communities over six months.",
        "delivery": "Three named milestones cover indexing, dashboard delivery, and an audited public API with acceptance tests, identified owners, weekly source releases, risk tracking, and fallback procedures for data provider outages.",
    }
    submitted = applicant_contract.submit_proposal(args=[1, "civic-signal", "Civic Signal", "A public observability layer for community infrastructure with transparent progress and durable open data.", 7_000, json.dumps(answers), json.dumps(["https://example.org/project"])]).transact(value=0, transaction_context=tx_context, wait_transaction_status=TransactionStatus.FINALIZED)
    _ok(submitted)
    proposal = admin.get_proposal(args=[1]).call()
    assert proposal["status"] == "QUALIFIED"
    assert proposal["weighted_score"] == 75
    assert proposal["criterion_scores"] == [75, 75]

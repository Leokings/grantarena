import json


BASE = 1_790_856_000
DEADLINE = BASE + 3_600
APPEAL = 3_600
POOL = 10_000
BOND = 10

CRITERIA = [
    {
        "id": "impact",
        "label": "Public impact",
        "description": "Explain the specific public benefit, target users, and a measurable outcome.",
        "weight": 60,
    },
    {
        "id": "delivery",
        "label": "Delivery confidence",
        "description": "Explain the implementation plan, milestones, ownership, and material delivery risks.",
        "weight": 40,
    },
]

ANSWERS_A = {
    "impact": "The project will give 500 community maintainers a public dashboard and measures success through verified monthly usage and response time.",
    "delivery": "A two-person team will ship the indexer, dashboard, and public API in three milestones with weekly source releases and an explicit fallback plan.",
}

ANSWERS_B = {
    "impact": "The program serves open-source stewards with an auditable grant-discovery feed and measures successful matches and completed milestones.",
    "delivery": "The delivery plan has discovery, pilot, and production phases, named owners, acceptance tests, and a documented contingency for provider outages.",
}


def _address(value) -> str:
    if isinstance(value, (bytes, bytearray)):
        return "0x" + bytes(value).hex()
    return str(value).lower()


def _create(contract, vm, owner, **overrides):
    vm.sender = owner
    vm.value = overrides.pop("pool", POOL)
    values = {
        "round_key": "open-infra-2026",
        "title": "Open infrastructure grants",
        "mission": "Fund durable public infrastructure with measurable community adoption and a credible delivery plan.",
        "deadline": DEADLINE,
        "appeal": APPEAL,
        "winners": 2,
        "minimum": 60,
        "bond": BOND,
        "criteria": CRITERIA,
        "payouts": [7000, 3000],
    }
    values.update(overrides)
    try:
        return contract.create_round(
            values["round_key"],
            values["title"],
            values["mission"],
            values["deadline"],
            values["appeal"],
            values["winners"],
            values["minimum"],
            values["bond"],
            json.dumps(values["criteria"]),
            json.dumps(values["payouts"]),
        )
    finally:
        vm.value = 0


def _submit(
    contract,
    vm,
    proposer,
    *,
    key="civic-signal",
    title="Civic Signal",
    summary="A public observability layer for community-maintained infrastructure with transparent progress and durable open data.",
    requested=7_000,
    answers=None,
    grades=None,
    evidence=None,
    round_id=1,
    bond=BOND,
):
    vm.sender = proposer
    vm.value = bond
    vm.clear_mocks()
    vm.mock_llm(
        r".*Evaluate this grant proposal.*",
        json.dumps({"grades": grades or ["STRONG", "STRONG"], "summary": "Specific impact and a credible staged delivery plan."}),
    )
    try:
        return contract.submit_proposal(
            round_id,
            key,
            title,
            summary,
            requested,
            json.dumps(answers or ANSWERS_A),
            json.dumps(evidence or ["https://example.org/project"]),
        )
    finally:
        vm.value = 0


def test_create_round_locks_pool_and_exposes_full_policy(contract, direct_vm, direct_alice):
    round_id = _create(contract, direct_vm, direct_alice)
    state = contract.get_round(round_id)
    info = contract.get_contract_info()
    assert round_id == 1
    assert state["schema"] == "grantarena/round/v1"
    assert state["pool_atto"] == POOL
    assert state["status"] == "OPEN"
    assert [item["weight"] for item in state["criteria"]] == [60, 40]
    assert info["total_escrow_atto"] == POOL
    assert info["total_liability_atto"] == POOL


def test_round_policy_and_payout_validation_are_deterministic(contract, direct_vm, direct_alice):
    broken = [dict(CRITERIA[0]), dict(CRITERIA[1])]
    broken[1]["weight"] = 30
    with direct_vm.expect_revert("criteria_weights_must_total_100"):
        _create(contract, direct_vm, direct_alice, criteria=broken)
    with direct_vm.expect_revert("payouts_must_total_10000"):
        _create(contract, direct_vm, direct_alice, payouts=[6000, 3000])
    with direct_vm.expect_revert("invalid_submission_deadline"):
        _create(contract, direct_vm, direct_alice, deadline=BASE + 30)


def test_round_key_is_unique_per_creator(contract, direct_vm, direct_alice):
    _create(contract, direct_vm, direct_alice)
    with direct_vm.expect_revert("round_key_exists"):
        _create(contract, direct_vm, direct_alice)


def test_semantic_grades_become_deterministic_weighted_score(contract, direct_vm, direct_alice, direct_bob):
    _create(contract, direct_vm, direct_alice)
    proposal_id = _submit(contract, direct_vm, direct_bob)
    proposal = contract.get_proposal(proposal_id)
    round_state = contract.get_round(1)
    assert proposal["criterion_scores"] == [75, 75]
    assert proposal["weighted_score"] == 75
    assert proposal["status"] == "QUALIFIED"
    assert round_state["qualified_count"] == 1
    assert contract.get_contract_info()["total_escrow_atto"] == POOL + BOND


def test_unaddressed_criterion_is_capped_before_model_runs(contract, direct_vm, direct_alice, direct_bob):
    _create(contract, direct_vm, direct_alice, minimum=40)
    answers = dict(ANSWERS_A)
    answers["impact"] = ""
    proposal_id = _submit(contract, direct_vm, direct_bob, answers=answers, grades=["EXCELLENT", "STRONG"])
    proposal = contract.get_proposal(proposal_id)
    assert proposal["criterion_scores"] == [25, 75]
    assert proposal["weighted_score"] == 45
    assert proposal["status"] == "QUALIFIED"


def test_short_answer_cannot_score_above_fair(contract, direct_vm, direct_alice, direct_bob):
    _create(contract, direct_vm, direct_alice, minimum=40)
    answers = dict(ANSWERS_A)
    answers["delivery"] = "We will ship quickly with a small experienced team."
    proposal_id = _submit(contract, direct_vm, direct_bob, answers=answers, grades=["STRONG", "EXCELLENT"])
    assert contract.get_proposal(proposal_id)["criterion_scores"] == [75, 50]


def test_bond_sender_and_unique_wallet_guards(contract, direct_vm, direct_alice, direct_bob):
    _create(contract, direct_vm, direct_alice)
    direct_vm.sender = direct_alice
    direct_vm.value = BOND
    direct_vm.mock_llm(r".*Evaluate this grant proposal.*", json.dumps({"grades": ["STRONG", "STRONG"], "summary": "Credible enough for this test case."}))
    with direct_vm.expect_revert("creator_cannot_submit"):
        contract.submit_proposal(1, "owner-entry", "Owner entry", "This owner-controlled proposal must be rejected before any semantic evaluation can influence state.", 1000, json.dumps(ANSWERS_A), "[]")
    direct_vm.sender = direct_bob
    direct_vm.value = BOND - 1
    with direct_vm.expect_revert("incorrect_proposal_bond"):
        contract.submit_proposal(1, "wrong-bond", "Wrong bond", "This otherwise valid proposal deliberately attaches the wrong temporary anti-spam bond amount.", 1000, json.dumps(ANSWERS_A), "[]")
    direct_vm.value = 0
    _submit(contract, direct_vm, direct_bob)
    with direct_vm.expect_revert("wallet_already_submitted"):
        _submit(contract, direct_vm, direct_bob, key="second-entry")


def test_malformed_model_output_never_mutates_state(contract, direct_vm, direct_alice, direct_bob):
    _create(contract, direct_vm, direct_alice)
    direct_vm.sender = direct_bob
    direct_vm.value = BOND
    direct_vm.mock_llm(r".*Evaluate this grant proposal.*", json.dumps({"score": 99}))
    with direct_vm.expect_revert("[LLM_ERROR] invalid_evaluation_shape"):
        contract.submit_proposal(1, "bad-model", "Bad model", "This valid-looking proposal should not be stored when the model violates the required response schema.", 1000, json.dumps(ANSWERS_A), "[]")
    direct_vm.value = 0
    assert contract.get_round(1)["proposal_count"] == 0


def test_contest_is_one_time_proposer_only_and_updates_qualification(contract, direct_vm, direct_alice, direct_bob, direct_charlie):
    _create(contract, direct_vm, direct_alice)
    proposal_id = _submit(contract, direct_vm, direct_bob, grades=["WEAK", "WEAK"])
    assert contract.get_proposal(proposal_id)["status"] == "REJECTED"
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("only_proposer"):
        contract.contest_proposal(proposal_id, "New audited adoption figures and a signed delivery schedule now provide material criterion-specific evidence for review.")
    direct_vm.sender = direct_bob
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*Evaluate this grant proposal.*", json.dumps({"grades": ["STRONG", "STRONG"], "summary": "The novel evidence materially strengthens both criteria."}))
    contract.contest_proposal(proposal_id, "New audited adoption figures and a signed delivery schedule now provide material criterion-specific evidence for review.")
    assert contract.get_proposal(proposal_id)["status"] == "QUALIFIED"
    assert contract.get_round(1)["qualified_count"] == 1
    with direct_vm.expect_revert("contest_already_used"):
        contract.contest_proposal(proposal_id, "A second long addendum is forbidden even when it contains additional material and exceeds the minimum length.")


def test_finalization_waits_for_appeal_window(contract, direct_vm, direct_alice):
    _create(contract, direct_vm, direct_alice)
    with direct_vm.expect_revert("appeal_window_open"):
        contract.finalize_round(1)


def test_finalize_ranks_deterministically_and_credits_awards_and_bonds(contract, direct_vm, direct_alice, direct_bob, direct_charlie):
    _create(contract, direct_vm, direct_alice)
    first_id = _submit(contract, direct_vm, direct_bob, requested=7_000, grades=["STRONG", "STRONG"])
    second_id = _submit(contract, direct_vm, direct_charlie, key="open-steward", title="Open Steward", requested=3_000, answers=ANSWERS_B, grades=["STRONG", "STRONG"])
    direct_vm.sender = direct_charlie
    direct_vm.warp("2026-10-01T14:01:00Z")
    contract.finalize_round(1)
    state = contract.get_round(1)
    assert state["status"] == "FINALIZED"
    assert state["winner_ids"] == [second_id, first_id]
    assert contract.get_proposal(second_id)["rank"] == 1
    assert contract.get_proposal(second_id)["award_atto"] == 3_000
    assert contract.get_proposal(first_id)["rank"] == 2
    assert contract.get_proposal(first_id)["award_atto"] == 3_000
    assert contract.get_claimable(direct_charlie) == 3_000 + BOND
    assert contract.get_claimable(direct_bob) == 3_000 + BOND
    assert contract.get_claimable(direct_alice) == 4_000
    info = contract.get_contract_info()
    assert info["total_escrow_atto"] == 0
    assert info["total_claimable_atto"] == POOL + 2 * BOND
    assert info["total_liability_atto"] == POOL + 2 * BOND


def test_score_breaks_tie_before_requested_amount(contract, direct_vm, direct_alice, direct_bob, direct_charlie):
    _create(contract, direct_vm, direct_alice)
    first_id = _submit(contract, direct_vm, direct_bob, requested=2_000, grades=["STRONG", "STRONG"])
    second_id = _submit(contract, direct_vm, direct_charlie, key="excellent", title="Excellent proposal", requested=7_000, answers=ANSWERS_B, grades=["EXCELLENT", "EXCELLENT"])
    direct_vm.warp("2026-10-01T14:01:00Z")
    contract.finalize_round(1)
    assert contract.get_round(1)["winner_ids"] == [second_id, first_id]


def test_cancel_empty_round_returns_pool_but_never_rugs_submitters(contract, direct_vm, direct_alice, direct_bob):
    _create(contract, direct_vm, direct_alice)
    contract.cancel_empty_round(1)
    assert contract.get_round(1)["status"] == "CANCELLED"
    assert contract.get_claimable(direct_alice) == POOL
    _create(contract, direct_vm, direct_alice, round_key="second-round")
    _submit(contract, direct_vm, direct_bob, key="second-round-proposal", round_id=2)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("round_not_empty_open"):
        contract.cancel_empty_round(2)


def test_withdrawal_is_one_time_and_preserves_liability_accounting(contract, direct_vm, direct_alice, direct_bob):
    _create(contract, direct_vm, direct_alice, winners=1, payouts=[10_000], bond=0)
    _submit(contract, direct_vm, direct_bob, requested=4_000, bond=0)
    direct_vm.warp("2026-10-01T14:01:00Z")
    direct_vm.sender = direct_alice
    contract.finalize_round(1)
    assert contract.get_claimable(direct_bob) == 4_000
    assert contract.get_claimable(direct_alice) == 6_000

    direct_vm.sender = direct_bob
    withdrawal_id = contract.withdraw()
    withdrawal = contract.get_withdrawal(withdrawal_id)
    info = contract.get_contract_info()
    assert withdrawal["amount_atto"] == 4_000
    assert withdrawal["status"] == "TRANSFER_QUEUED"
    assert contract.get_claimable(direct_bob) == 0
    assert info["total_claimable_atto"] == 6_000
    assert info["total_liability_atto"] == 6_000
    assert info["total_withdrawn_atto"] == 4_000
    with direct_vm.expect_revert("nothing_to_withdraw"):
        contract.withdraw()


def test_list_views_are_bounded_and_agent_friendly(contract, direct_vm, direct_alice, direct_bob):
    _create(contract, direct_vm, direct_alice)
    proposal_id = _submit(contract, direct_vm, direct_bob)
    rounds = json.loads(contract.list_rounds(0, 10))
    proposals = json.loads(contract.list_round_proposals(1))
    assert rounds[0]["round_id"] == 1
    assert proposals[0]["proposal_id"] == proposal_id
    with direct_vm.expect_revert("invalid_page_limit"):
        contract.list_rounds(0, 21)


def test_invalid_evidence_and_answer_shapes_fail_before_consensus(contract, direct_vm, direct_alice, direct_bob):
    _create(contract, direct_vm, direct_alice)
    direct_vm.sender = direct_bob
    direct_vm.value = BOND
    with direct_vm.expect_revert("answers_must_match_criteria"):
        contract.submit_proposal(1, "missing-answer", "Missing answer", "This proposal omits a required criterion answer and therefore cannot proceed to semantic evaluation.", 1000, json.dumps({"impact": ANSWERS_A["impact"]}), "[]")
    with direct_vm.expect_revert("invalid_evidence_url"):
        contract.submit_proposal(1, "bad-evidence", "Bad evidence", "This proposal uses an unsafe non-HTTPS evidence location and therefore must fail deterministic validation.", 1000, json.dumps(ANSWERS_A), json.dumps(["http://localhost/private"]))
    direct_vm.value = 0

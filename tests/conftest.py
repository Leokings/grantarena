"""Shared GrantArena direct-mode fixture."""

from pathlib import Path

import pytest

from tests.gltest_windows_compat import install_windows_direct_compatibility


CONTRACT_PATH = Path(__file__).resolve().parents[1] / "contracts" / "grant_arena.py"
DIRECT_SDK_VERSION = "v0.2.16"

install_windows_direct_compatibility()


@pytest.fixture
def contract(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    direct_vm.value = 0
    direct_vm.warp("2026-10-01T12:00:00Z")
    return direct_deploy(str(CONTRACT_PATH), sdk_version=DIRECT_SDK_VERSION)

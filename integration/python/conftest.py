"""Shared fixtures for the live contract probe.

Each test gets a real ``CopassClient`` pointed at staging (or wherever
``COPASS_API_URL`` resolves). Skipped automatically when the env var
``COPASS_INTEGRATION_API_KEY`` is missing — local dev / forked CI
shouldn't accidentally hit a live API just by running ``pytest``.
"""

from __future__ import annotations

import os

import pytest

from copass_core import ApiKeyAuth, CopassClient


@pytest.fixture(scope="session")
def api_key() -> str:
    key = os.environ.get("COPASS_INTEGRATION_API_KEY")
    if not key:
        pytest.skip(
            "COPASS_INTEGRATION_API_KEY not set — skipping live contract probe."
        )
    return key


@pytest.fixture(scope="session")
def sandbox_id() -> str:
    sb = os.environ.get("COPASS_INTEGRATION_SANDBOX_ID")
    if not sb:
        pytest.skip("COPASS_INTEGRATION_SANDBOX_ID not set.")
    return sb


@pytest.fixture(scope="session")
def api_url() -> str:
    return os.environ.get("COPASS_API_URL", "https://ai.staging.copass.id")


@pytest.fixture
def client(api_key: str, api_url: str) -> CopassClient:
    return CopassClient(auth=ApiKeyAuth(key=api_key), api_url=api_url)

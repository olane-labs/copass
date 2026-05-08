"""Shared fixtures for the full SDK contract test suite.

These tests are mock-based — every HTTP call is intercepted by respx
and asserted against the expected URL, headers, and body shape. No
network or live API access required.

The suite acts as a pre-publish deploy guard: when the SDK refactors
break a request shape or stop unpacking a response field, the matching
test fails before the package can be released to PyPI.
"""

from __future__ import annotations

import pytest

from copass_core import ApiKeyAuth, CopassClient


@pytest.fixture
def client() -> CopassClient:
    """An auth'd client wired to a stub host. No real network calls."""
    return CopassClient(auth=ApiKeyAuth(key="olk_test"), api_url="http://test")

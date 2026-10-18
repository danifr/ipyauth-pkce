"""
Tests for the strengthened ``is_url`` validator.

``is_url`` previously accepted anything starting with the literal ``http`` —
including malformed values like ``httpfoo`` or a scheme with no host. It now
parses the value structurally and enforces scheme, hostname, credential, and
local-development rules.
"""

import pytest

from ipyauth_pkce.ipyauth_widget._util import is_url


VALID = [
    'https://example.com',
    'https://example.com/callback/',
    'https://keycloak.example.com/auth',
    'https://sub.domain.example.com:8443/path?q=1#frag',
    'https://example.com:443',
    # http is allowed for localhost development
    'http://localhost:8888/callback/',
    'http://localhost',
    'http://127.0.0.1:8888/callback/',
    'http://[::1]:8888/callback/',
    'https://localhost:8888/callback/',
]

INVALID = [
    # not strings / empty
    '',
    None,
    123,
    # bad or missing scheme
    'ftp://example.com',
    'example.com',
    'www.example.com/callback',
    '//example.com',
    'javascript:alert(1)',
    # the classic false positives the old startswith('http') accepted
    'httpfoo',
    'https',
    'http:',
    'http://',
    'https://',
    # http for a non-localhost host must be rejected
    'http://example.com',
    'http://example.com/callback/',
    'http://192.168.1.10/callback',
    # embedded credentials
    'https://user:pass@example.com/callback',
    'https://user@example.com/callback',
    # malformed port
    'https://example.com:notaport/',
    'https://example.com:99999/',
]


@pytest.mark.parametrize('value', VALID)
def test_accepts_valid_urls(value):
    assert is_url(value) is True


@pytest.mark.parametrize('value', INVALID)
def test_rejects_invalid_urls(value):
    assert is_url(value) is False


def test_https_allowed_for_any_host_but_http_only_for_localhost():
    assert is_url('https://api.example.com') is True
    assert is_url('http://api.example.com') is False
    assert is_url('http://localhost') is True

"""Per-IP rate limits key on client_ip(): it must never trust a header the caller can forge."""

from types import SimpleNamespace

import pytest
from pydantic import SecretStr
from starlette.requests import Request

from app.api.deps import client_ip
from app.config import Settings

INTERNAL = "web-to-api-" + "Q8vN3mLw" * 5


def request_from(settings: Settings, headers: dict[str, str], peer: str = "10.0.0.9") -> Request:
    return Request(
        {
            "type": "http",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
            "client": (peer, 40000),
            "app": SimpleNamespace(state=SimpleNamespace(settings=settings)),
        }
    )


@pytest.fixture
def render(settings: Settings) -> Settings:
    """As deployed: one proxy (Render) in front, and a secret shared with the web server."""
    return settings.model_copy(update={"internal_api_secret": SecretStr(INTERNAL), "proxy_hops": 1})


def test_without_a_proxy_the_tcp_peer_is_used_and_headers_are_ignored(settings):
    forged = {"X-Forwarded-For": "1.2.3.4", "X-Client-IP": "5.6.7.8"}
    assert client_ip(request_from(settings, forged)) == "10.0.0.9"


def test_behind_one_proxy_only_the_entry_it_appended_counts(render):
    # The client sent "1.2.3.4"; Render appended the real peer, 203.0.113.5.
    req = request_from(render, {"X-Forwarded-For": "1.2.3.4, 203.0.113.5"})
    assert client_ip(req) == "203.0.113.5"


def test_web_server_forwards_the_visitor_with_the_shared_secret(render):
    headers = {
        "X-Client-IP": "198.51.100.7",
        "X-Internal-Auth": INTERNAL,
        "X-Forwarded-For": "203.0.113.99",  # the web server's own address, appended by Render
    }
    assert client_ip(request_from(render, headers)) == "198.51.100.7"


@pytest.mark.parametrize("auth", [None, "", "wrong-secret", INTERNAL[:-1]])
def test_x_client_ip_without_the_right_secret_is_ignored(render, auth):
    headers = {"X-Client-IP": "198.51.100.7", "X-Forwarded-For": "203.0.113.5"}
    if auth is not None:
        headers["X-Internal-Auth"] = auth
    assert client_ip(request_from(render, headers)) == "203.0.113.5"


def test_garbage_addresses_fall_through_to_the_next_source(render):
    headers = {"X-Client-IP": "<script>", "X-Internal-Auth": INTERNAL, "X-Forwarded-For": "nope"}
    assert client_ip(request_from(render, headers)) == "10.0.0.9"


def test_ipv6_is_accepted_and_normalised(render):
    req = request_from(render, {"X-Forwarded-For": "2001:DB8:0:0::1"})
    assert client_ip(req) == "2001:db8::1"


def test_a_weak_internal_secret_is_refused(settings):
    with pytest.raises(ValueError, match="at least 32 bytes"):
        Settings.model_validate({**settings.model_dump(), "internal_api_secret": "short"})


def test_health_checks_the_database(client):
    assert client.get("/health").json() == {"status": "ok"}

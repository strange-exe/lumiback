"""The app's own log lines reach stderr at INFO (uvicorn configures only its own loggers)."""

import io
import logging
import sys

import pytest

from app.main import configure_logging


def _ours() -> list[logging.StreamHandler]:
    return [h for h in logging.getLogger("app").handlers if getattr(h, "_lumiback", False)]


@pytest.fixture
def output():
    configure_logging()
    [handler] = _ours()
    buffer = io.StringIO()
    previous = handler.setStream(buffer)
    yield buffer
    handler.setStream(previous)


def test_the_handler_writes_to_stderr():
    configure_logging()
    [handler] = _ours()
    assert handler.stream in (sys.stderr, sys.__stderr__)


def test_info_lines_from_app_modules_are_kept(output):
    logging.getLogger("app.jobs.expiry").info("ended %d expired share sessions", 2)
    assert "INFO app.jobs.expiry: ended 2 expired share sessions" in output.getvalue()


def test_debug_lines_are_still_dropped(output):
    logging.getLogger("app.push").debug("noise")
    assert "noise" not in output.getvalue()


def test_configuring_twice_adds_one_handler():
    configure_logging()
    configure_logging()
    assert len(_ours()) == 1

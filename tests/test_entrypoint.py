"""The package must expose an ``app`` attribute for gunicorn's ``app:app``."""

import app as app_module


def test_package_exposes_app_for_gunicorn():
    application = app_module.app
    assert callable(application)

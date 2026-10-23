"""JSON API. Each feature is its own blueprint; add new modules here."""
from .auth import bp as auth_bp
from .budget import bp as budget_bp
from .entries import bp as entries_bp
from .investments import bp as investments_bp
from .loans import bp as loans_bp
from .masters import bp as masters_bp
from .reports import bp as reports_bp
from .system import bp as system_bp

BLUEPRINTS = (auth_bp, entries_bp, investments_bp, loans_bp, masters_bp, budget_bp, reports_bp, system_bp)


def register_blueprints(app):
    for bp in BLUEPRINTS:
        app.register_blueprint(bp, url_prefix="/api")

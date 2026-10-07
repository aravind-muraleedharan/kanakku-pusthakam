"""Error type used by the API for clean JSON error responses."""


class ApiError(Exception):
    """Raise from any API handler to return {"error": message} with the given HTTP status."""

    def __init__(self, message, status=400, field=None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.field = field

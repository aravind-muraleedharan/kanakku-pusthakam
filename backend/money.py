"""Rupee <-> paise helpers. All amounts are stored as whole paise to avoid rounding errors."""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


def to_paise(value):
    """Convert a rupee amount ('1,250.50', 1250.5, '1250') to integer paise. Returns None if empty."""
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return None
    try:
        rupees = Decimal(str(value).replace(",", "").strip())
    except InvalidOperation:
        raise ValueError(f"'{value}' is not a valid amount")
    return int((rupees * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def to_rupees(paise):
    """Convert integer paise to a float rupee amount for JSON output."""
    if paise is None:
        return None
    return round(paise / 100, 2)

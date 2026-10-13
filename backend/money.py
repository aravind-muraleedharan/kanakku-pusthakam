"""Rupee <-> paise helpers. All amounts are stored as whole paise to avoid rounding errors."""
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

MAX_RUPEES = Decimal("1000000000000")          # ₹1 lakh crore: far above any personal amount
_AMOUNT_RE = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)$")


def to_paise(value):
    """Convert a rupee amount ('1,250.50', 1250.5, '1250') to integer paise. Returns None if empty.

    Only plain numbers are accepted: no exponents (1e5), NaN/Infinity, or absurdly large values.
    """
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise ValueError("Enter the amount as a number")
    text = str(value).replace(",", "").strip()
    if isinstance(value, float):
        text = f"{value:.2f}" if abs(value) < float(MAX_RUPEES) else "inf"
    if not _AMOUNT_RE.match(text):
        raise ValueError(f"'{str(value)[:30]}' is not a valid amount")
    try:
        rupees = Decimal(text)
    except InvalidOperation:
        raise ValueError(f"'{str(value)[:30]}' is not a valid amount")
    if abs(rupees) > MAX_RUPEES:
        raise ValueError("That amount is too large")
    return int((rupees * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def to_rupees(paise):
    """Convert integer paise to a float rupee amount for JSON output."""
    if paise is None:
        return None
    return round(paise / 100, 2)

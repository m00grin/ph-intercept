import hashlib
import hmac
import secrets

from .config import HIDE_DOMAIN

# Fresh key per start: tokens can't be matched against a list of hashed
# common domains, and they don't carry over between restarts.
_DOMAIN_KEY = secrets.token_bytes(32)


def public_domain(domain: str) -> str:
    """The domain as sent to the browser: as-is, or an opaque token with HIDE_DOMAIN."""
    if not HIDE_DOMAIN:
        return domain
    return hmac.new(_DOMAIN_KEY, domain.lower().encode(), hashlib.sha256).hexdigest()[:16]

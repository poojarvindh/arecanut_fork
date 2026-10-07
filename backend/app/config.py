import secrets
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Centralized, environment-driven configuration. Nothing sensitive is
    hardcoded — every value here is meant to be overridden via real
    environment variables (or a secrets manager) in a deployed environment.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # "development" relaxes a few safety checks (e.g. allows an ephemeral JWT
    # secret so the app still boots with zero config for local dev). Every
    # other value must be "staging" or "production" in a real deployment.
    ENV: str = "development"

    DATABASE_URL: str = ""

    # No insecure default in non-dev environments — see get_settings() below,
    # which refuses to start the app in production without a real secret.
    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14

    # Comma-separated allow-list; "*" is only tolerated in development (default,
    # since the app is also loaded from a Capacitor WebView / arbitrary LAN IP
    # during dev/demo). Production MUST set this to explicit origin(s).
    CORS_ORIGINS: str = "*"
    # "*" disables host-header checking — fine for local/LAN dev (phone hitting
    # a raw IP), but a real deployment MUST set this to its actual hostname(s).
    ALLOWED_HOSTS: str = "*"

    # Must stay comfortably above MAX_FAILED_LOGINS (auth.py, currently 5) — this
    # is a per-IP brute-force guard, not the account lockout. When it was equal
    # to MAX_FAILED_LOGINS, a single account's 5 legitimate wrong-password
    # attempts would hit this IP-wide limit at nearly the same request count,
    # so the user saw a generic "Rate limit exceeded" 429 instead of the
    # intended, clearer "Account temporarily locked" 423 — and since several
    # field users can share one office/LAN IP, it could also block a different
    # user's unrelated login attempts. Set high enough that the account-level
    # lockout is always what actually fires first for a single stuck user.
    RATE_LIMIT_LOGIN: str = "15/minute"
    RATE_LIMIT_DEFAULT: str = "120/minute"

    # ---- Password reset / outbound email ----
    PASSWORD_RESET_EXPIRE_MINUTES: int = 30
    RATE_LIMIT_PASSWORD_RESET: str = "3/hour"
    # Base URL of the deployed frontend, used to build the reset link that gets
    # emailed (e.g. "https://survey.example.org"). Falls back to the Vite dev
    # server origin for local testing.
    APP_BASE_URL: str = "http://localhost:3701"

    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "no-reply@arecanut-survey.local"
    SMTP_USE_TLS: bool = True

    @property
    def smtp_configured(self) -> bool:
        return bool(self.SMTP_HOST and self.SMTP_USER and self.SMTP_PASSWORD)

    @property
    def is_production(self) -> bool:
        return self.ENV.lower() == "production"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def allowed_hosts_list(self) -> list[str]:
        return [h.strip() for h in self.ALLOWED_HOSTS.split(",") if h.strip()]


@lru_cache
def get_settings() -> Settings:
    s = Settings()

    if not s.JWT_SECRET:
        if s.is_production:
            raise RuntimeError(
                "JWT_SECRET is not set. Refusing to start in production without a real "
                "secret (set it via your secrets manager / environment, e.g. "
                "`openssl rand -hex 32`)."
            )
        # Dev-only fallback: random per-process, so tokens don't survive a
        # restart and nobody is tempted to rely on a fixed dev secret.
        s.JWT_SECRET = secrets.token_hex(32)

    if s.is_production and "*" in s.cors_origins_list:
        raise RuntimeError("CORS_ORIGINS must not be '*' in production.")

    return s

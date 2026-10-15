import re
import json
from collections import Counter
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
import datetime

from .config import get_settings
from .db import Base, engine, get_db, sync_missing_columns, sync_nullable_columns, migrate_roles_and_permissions
from . import models as m
from .schemas import (
    SurveyIn, SurveyOut, SurveyDraftIn, FarmerLookup, LoginIn, TokenOut, UserOut, RefreshIn, LogoutIn,
    ForgotPasswordIn, ResetPasswordIn, PlotBoundaryIn, PlotBoundaryOut, PlotSummaryOut,
    UserAdminOut, UserCreateIn, UserUpdateIn,
)
import json as _json
from .auth import (
    verify_password, hash_password, validate_password_strength, create_access_token,
    get_current_user, require_role, require_permission, PERMISSION_MODULES,
    issue_refresh_token, rotate_refresh_token, revoke_refresh_token, revoke_all_refresh_tokens,
    register_failed_login, register_successful_login, is_locked, audit,
    issue_password_reset_token, consume_password_reset_token,
)
from .email_utils import send_password_reset_email
from .master_data import router as master_data_router
from .fpo_consultation import router as fpo_consultation_router

settings = get_settings()
Base.metadata.create_all(bind=engine)
sync_missing_columns()
sync_nullable_columns()
migrate_roles_and_permissions()

app = FastAPI(
    title="Arecanut Farmer Data Collection API",
    description="REST API for the Karnataka arecanut farmer survey app — auth, "
    "master data, farmer surveys, plot boundaries, FPO consultations, and the "
    "admin dashboard. Authenticate with POST /api/auth/login, then click "
    "'Authorize' above and paste the returned access_token as a Bearer token.",
    version="1.0.0",
    debug=not settings.is_production,
)

# ---------------- security middleware ----------------

limiter = Limiter(key_func=get_remote_address, default_limits=[settings.RATE_LIMIT_DEFAULT])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """OWASP-recommended response headers — defends against clickjacking, MIME
    sniffing, referrer leakage, and (for the rare HTML response) XSS via CSP."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(self), camera=(self), microphone=()"
        if request.url.path in ("/docs", "/redoc"):
            # Swagger UI / ReDoc load their JS+CSS from jsdelivr's CDN by
            # default — the site-wide "default-src 'none'" CSP below would
            # otherwise silently block those assets and render a blank page.
            response.headers["Content-Security-Policy"] = (
                "default-src 'none'; frame-ancestors 'none'; "
                "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "img-src 'self' data: https://fastapi.tiangolo.com; "
                "font-src 'self' data:; "
                "connect-src 'self'"
            )
        else:
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return response


app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts_list or ["*"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    # No cookies are used (auth is Bearer-token based), so credentialed CORS
    # isn't needed — and keeping it off lets "*" work as an origin in dev.
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(master_data_router)
app.include_router(fpo_consultation_router)


# ---------------- AUTH ----------------

def _perm_list(user: m.User) -> list:
    return [p for p in (user.permissions or "").split(",") if p]


@app.post("/api/auth/login", response_model=TokenOut, tags=["Auth"])
@limiter.limit(settings.RATE_LIMIT_LOGIN)
def login(request: Request, payload: LoginIn, db: Session = Depends(get_db)):
    user = db.query(m.User).filter(m.User.username == payload.username).first()

    if not user or not user.is_active:
        audit(db, request, "login_failed", username=payload.username, detail="unknown or inactive user")
        raise HTTPException(status_code=401, detail="Invalid username or password")

    if is_locked(user):
        audit(db, request, "login_blocked_locked", user=user)
        raise HTTPException(status_code=423, detail="Account temporarily locked due to repeated failed logins. Try again later.")

    if not verify_password(payload.password, user.password_hash):
        register_failed_login(db, user)
        audit(db, request, "login_failed", user=user, detail="bad password")
        raise HTTPException(status_code=401, detail="Invalid username or password")

    register_successful_login(db, user)
    audit(db, request, "login_success", user=user)
    access_token = create_access_token(user)
    refresh_token = issue_refresh_token(db, user)
    return TokenOut(
        access_token=access_token, refresh_token=refresh_token,
        role=user.role, username=user.username, full_name=user.full_name,
        permissions=_perm_list(user),
    )


@app.post("/api/auth/refresh", response_model=TokenOut, tags=["Auth"])
@limiter.limit(settings.RATE_LIMIT_LOGIN)
def refresh(request: Request, payload: RefreshIn, db: Session = Depends(get_db)):
    user, new_refresh = rotate_refresh_token(db, payload.refresh_token)
    access_token = create_access_token(user)
    return TokenOut(
        access_token=access_token, refresh_token=new_refresh,
        role=user.role, username=user.username, full_name=user.full_name,
        permissions=_perm_list(user),
    )


@app.post("/api/auth/logout", tags=["Auth"])
def logout(payload: LogoutIn, db: Session = Depends(get_db)):
    revoke_refresh_token(db, payload.refresh_token)
    return {"ok": True}


@app.get("/api/auth/me", response_model=UserOut, tags=["Auth"])
def me(user: m.User = Depends(get_current_user)):
    return UserOut(username=user.username, full_name=user.full_name, role=user.role, permissions=_perm_list(user))


# ---------------- USER MANAGEMENT (admin only) ----------------
# Exactly one "admin" account may ever exist — enforced in create_user and
# update_user below, not just at seed time. Every mutation is audit-logged.

@app.get("/api/users", response_model=list[UserAdminOut], tags=["Users"])
def list_users(db: Session = Depends(get_db), admin: m.User = Depends(require_role("admin"))):
    return db.query(m.User).order_by(m.User.created_at).all()


@app.get("/api/users/permission-modules", tags=["Users"])
def get_permission_modules(admin: m.User = Depends(require_role("admin"))):
    """The fixed set of module keys the User Management screen renders as
    checkboxes — a single source of truth shared with auth.PERMISSION_MODULES,
    so a future module only needs to be added in one place."""
    return PERMISSION_MODULES


@app.post("/api/users", response_model=UserAdminOut, tags=["Users"])
def create_user(
    request: Request,
    payload: UserCreateIn,
    db: Session = Depends(get_db),
    admin: m.User = Depends(require_role("admin")),
):
    if payload.role == "admin":
        existing_admin = db.query(m.User).filter(m.User.role == "admin").first()
        if existing_admin:
            raise HTTPException(status_code=400, detail="An admin account already exists — only one admin is permitted.")

    if db.query(m.User).filter(m.User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="That username is already taken.")

    weakness = validate_password_strength(payload.password)
    if weakness:
        raise HTTPException(status_code=400, detail=weakness)

    user = m.User(
        username=payload.username,
        full_name=payload.full_name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=payload.role,
        permissions=",".join(payload.permissions) if payload.role == "field" else None,
        created_by_user_id=admin.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    audit(db, request, "user_create", user=admin, resource=f"user:{user.id}", detail=f"created {user.username} (role={user.role})")
    return user


@app.put("/api/users/{user_id}", response_model=UserAdminOut, tags=["Users"])
def update_user(
    user_id: int,
    request: Request,
    payload: UserUpdateIn,
    db: Session = Depends(get_db),
    admin: m.User = Depends(require_role("admin")),
):
    user = db.query(m.User).get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.role is not None and payload.role != user.role:
        if payload.role == "admin":
            existing_admin = db.query(m.User).filter(m.User.role == "admin", m.User.id != user_id).first()
            if existing_admin:
                raise HTTPException(status_code=400, detail="An admin account already exists — only one admin is permitted.")
        elif user.role == "admin":
            raise HTTPException(status_code=400, detail="The sole admin account cannot be demoted — promote another user to admin first if you need to change this.")
        user.role = payload.role

    if user.role == "admin" and payload.is_active is False:
        raise HTTPException(status_code=400, detail="The admin account cannot be deactivated.")

    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.email is not None:
        user.email = payload.email
    if payload.permissions is not None:
        user.permissions = ",".join(payload.permissions)
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.new_password:
        weakness = validate_password_strength(payload.new_password)
        if weakness:
            raise HTTPException(status_code=400, detail=weakness)
        user.password_hash = hash_password(payload.new_password)
        revoke_all_refresh_tokens(db, user.id)  # force re-login everywhere on password change

    db.commit()
    db.refresh(user)
    audit(db, request, "user_update", user=admin, resource=f"user:{user.id}", detail=f"updated {user.username}")
    return user


@app.post("/api/auth/forgot-password", tags=["Auth"])
@limiter.limit(settings.RATE_LIMIT_PASSWORD_RESET)
def forgot_password(request: Request, payload: ForgotPasswordIn, db: Session = Depends(get_db)):
    """
    Always returns the same generic response whether or not the identifier is
    registered — this prevents user enumeration (OWASP A07 / API3). The actual
    email is only sent when a matching, active account exists.
    """
    generic_response = {"ok": True, "detail": "If an account matches, a password reset email has been sent."}

    identifier = payload.identifier.strip()
    user = (
        db.query(m.User)
        .filter((m.User.username == identifier) | (m.User.email == identifier))
        .first()
    )
    if not user or not user.is_active:
        audit(db, request, "password_reset_requested_unknown", username=identifier)
        return generic_response

    if not user.email:
        # Account has no email on file — nothing we can do, but don't reveal that.
        audit(db, request, "password_reset_requested_no_email", user=user)
        return generic_response

    raw_token = issue_password_reset_token(db, user)
    reset_link = f"{settings.APP_BASE_URL.rstrip('/')}/reset-password?token={raw_token}"
    send_password_reset_email(user.email, user.full_name, reset_link, settings.PASSWORD_RESET_EXPIRE_MINUTES)
    audit(db, request, "password_reset_requested", user=user)
    return generic_response


@app.post("/api/auth/reset-password", tags=["Auth"])
@limiter.limit(settings.RATE_LIMIT_PASSWORD_RESET)
def reset_password(request: Request, payload: ResetPasswordIn, db: Session = Depends(get_db)):
    # Validate the new password BEFORE consuming the token — a rejected weak
    # password must not burn the (single-use) reset link.
    weakness = validate_password_strength(payload.new_password)
    if weakness:
        raise HTTPException(status_code=400, detail=weakness)

    user = consume_password_reset_token(db, payload.token)
    user.password_hash = hash_password(payload.new_password)
    user.failed_login_count = 0
    user.locked_until = None
    db.commit()

    # Force every existing session (this device and any other) to re-login —
    # a password reset should invalidate whatever a possible attacker was holding.
    revoke_all_refresh_tokens(db, user.id)
    audit(db, request, "password_reset_completed", user=user)
    return {"ok": True}


# ---------------- MASTER DATA ----------------

@app.get("/api/masters/districts", tags=["Master Data"])
def get_districts(db: Session = Depends(get_db)):
    return [d.name for d in db.query(m.District).order_by(m.District.name).all()]


@app.get("/api/masters/talukas", tags=["Master Data"])
def get_talukas(district: str = Query(...), db: Session = Depends(get_db)):
    d = db.query(m.District).filter(m.District.name == district).first()
    if not d:
        return []
    return [t.name for t in d.talukas]


@app.get("/api/masters/villages", tags=["Master Data"])
def get_villages(district: str = Query(...), taluka: str = Query(...), db: Session = Depends(get_db)):
    t = (
        db.query(m.Taluka)
        .join(m.District)
        .filter(m.District.name == district, m.Taluka.name == taluka)
        .first()
    )
    if not t:
        return []
    return [v.name for v in t.villages]


@app.get("/api/masters/villages-flat", tags=["Master Data"])
def get_villages_flat(db: Session = Depends(get_db)):
    """Every village with its parent taluka & district, for reverse (village-first) lookup."""
    rows = (
        db.query(m.Village, m.Taluka, m.District)
        .join(m.Taluka, m.Village.taluka_id == m.Taluka.id)
        .join(m.District, m.Taluka.district_id == m.District.id)
        .order_by(m.Village.name)
        .all()
    )
    return [
        {"village": v.name, "taluka": t.name, "district": d.name}
        for v, t, d in rows
    ]


@app.get("/api/masters/societies", tags=["Master Data"])
def get_societies(taluka: Optional[str] = None, db: Session = Depends(get_db)):
    """
    Without a taluka filter, returns every society (used by admin screens / legacy
    lookups). With ?taluka=NAME, returns only FPCs/societies mapped to that taluka
    plus every state-level society — this is what the survey wizard's dynamic FPC
    dropdown uses, per the client's "FPC list should be scoped to the selected
    Taluka, plus State-level Societies" requirement.
    """
    q = db.query(m.Society)
    if taluka:
        taluka_row = db.query(m.Taluka).filter(m.Taluka.name == taluka).first()
        taluka_id = taluka_row.id if taluka_row else -1
        q = q.filter((m.Society.taluka_id == taluka_id) | (m.Society.is_state_level == True))  # noqa: E712
    return [s.name for s in q.order_by(m.Society.name).all()]


@app.get("/api/masters/crops", tags=["Master Data"])
def get_crops(db: Session = Depends(get_db)):
    return [c.name for c in db.query(m.CropMaster).order_by(m.CropMaster.name).all()]


@app.get("/api/masters/schemes", tags=["Master Data"])
def get_schemes(db: Session = Depends(get_db)):
    return [s.name for s in db.query(m.SchemeMaster).order_by(m.SchemeMaster.name).all()]


@app.get("/api/masters/machines", tags=["Master Data"])
def get_machines(db: Session = Depends(get_db)):
    return [x.name for x in db.query(m.MachineMaster).order_by(m.MachineMaster.sort_order).all()]


@app.get("/api/masters/options", tags=["Master Data"])
def get_options(list_code: str = Query(...), db: Session = Depends(get_db)):
    rows = (
        db.query(m.OptionMaster)
        .filter(m.OptionMaster.list_code == list_code)
        .order_by(m.OptionMaster.sort_order)
        .all()
    )
    return [r.label for r in rows]


# ---------------- FARMER MASTER LOOKUP (Module 0: search by Aadhaar/Mobile) ----------------

@app.get("/api/farmer-master/lookup", response_model=Optional[FarmerLookup], tags=["Farmer Lookup"])
def lookup_farmer(q: str = Query(..., description="Aadhaar, Mobile number, or Farmer ID"), db: Session = Depends(get_db), user: m.User = Depends(get_current_user)):
    q = q.strip()
    # Mobile/Aadhaar stay exact-match — they're sensitive identifiers, and partial
    # matching on them would be both a privacy smell and ambiguous (many farmers
    # could share a partial digit sequence). Farmer ID is different: it's not
    # sensitive, and was found to only match when typed with the exact case and
    # full "NCCF/KA/0007" format — a user typing "0007" or "ncaf/ka/0007" got no
    # result even though the farmer exists. Farmer ID now matches case-insensitively
    # and on a partial/contains basis, same as how this ID appears in the UI elsewhere.
    fm = (
        db.query(m.FarmerMaster)
        .filter(
            (m.FarmerMaster.mobile_no == q)
            | (m.FarmerMaster.aadhaar_no == q)
            | (func.lower(m.FarmerMaster.farmer_id).contains(q.lower()))
        )
        .first()
    )
    if not fm:
        raise HTTPException(status_code=404, detail="No matching farmer found in Registration Portal")
    village = db.query(m.Village).get(fm.village_id)
    taluka = db.query(m.Taluka).get(village.taluka_id) if village else None
    district = db.query(m.District).get(taluka.district_id) if taluka else None
    return FarmerLookup(
        farmer_id=fm.farmer_id, farmer_name=fm.farmer_name, mobile_no=fm.mobile_no,
        gender=fm.gender, age=fm.age, guardian_name=fm.guardian_name,
        village=village.name if village else None, taluka=taluka.name if taluka else None,
        district=district.name if district else None,
    )


# ---------------- SURVEY CRUD ----------------

EXACT_FILTER_FIELDS = [
    "district", "taluka", "village", "society_assoc", "sale_type", "marketing_channel",
    "sale_month", "storage_source", "logistics_provider", "credit_linkage", "credit_source",
    "scheme_availed", "scheme_name", "soil_test_done", "crop_insurance", "input_source",
    "input_challenges", "tech_adoption",
]
CONTAINS_FILTER_FIELDS = [
    "society_benefits", "cultivation_challenges", "irrigation_source", "mech_owned", "mech_rented",
]

# CR-19: columns a user may sort the Farmer Records list / export by. A fixed
# whitelist, not an arbitrary getattr(FarmerSurvey, sort_by) — sort_by is
# client-controlled input, and an unchecked attribute lookup would let a
# request probe for (or sort by) columns that were never meant to be exposed
# this way, e.g. password-adjacent or internal bookkeeping fields.
SORTABLE_FIELDS = {
    "farmer_name": m.FarmerSurvey.farmer_name,
    "village": m.FarmerSurvey.village,
    "district": m.FarmerSurvey.district,
    "survey_year": m.FarmerSurvey.survey_year,
    "areca_area_acres": m.FarmerSurvey.areca_area_acres,
    "yield_raw_qtl": m.FarmerSurvey.yield_raw_qtl,
    "total_income_inr": m.FarmerSurvey.total_income_inr,
    "entry_timestamp": m.FarmerSurvey.entry_timestamp,
}


def build_survey_query(
    db: Session, q, farmer_id, district, taluka, village, society_assoc, sale_type,
    marketing_channel, sale_month, storage_source, logistics_provider, credit_linkage,
    credit_source, scheme_availed, scheme_name, soil_test_done, crop_insurance,
    input_source, input_challenges, tech_adoption, society_benefits,
    cultivation_challenges, irrigation_source, mech_owned, mech_rented,
    sort_by, sort_dir, status=None,
):
    """Shared by GET /api/surveys and GET /api/surveys/export (CR-19) so the
    export always reflects exactly the filters/sort the list view is
    currently showing, never a second, independently-maintained copy."""
    query = db.query(m.FarmerSurvey)
    if farmer_id:
        query = query.filter(m.FarmerSurvey.farmer_id == farmer_id)  # CR-18: Farmer History view
    if status == "draft":
        query = query.filter(m.FarmerSurvey.status == "draft")
    elif status == "submitted":
        # NULL means "submitted" for every row saved before Save as Draft
        # existed — they necessarily went through the old all-or-nothing
        # validation, so excluding NULL here would hide most real records.
        query = query.filter((m.FarmerSurvey.status == "submitted") | (m.FarmerSurvey.status.is_(None)))
    local_vars = locals()
    for field in EXACT_FILTER_FIELDS:
        value = local_vars.get(field)
        if value:
            query = query.filter(getattr(m.FarmerSurvey, field) == value)
    for field in CONTAINS_FILTER_FIELDS:
        value = local_vars.get(field)
        if value:
            query = query.filter(getattr(m.FarmerSurvey, field).like(f"%{value}%"))
    if q:
        like = f"%{q}%"
        query = query.filter((m.FarmerSurvey.farmer_name.like(like)) | (m.FarmerSurvey.farmer_id.like(like)) | (m.FarmerSurvey.mobile_no.like(like)))
    sort_col = SORTABLE_FIELDS.get(sort_by, m.FarmerSurvey.entry_timestamp)
    return query.order_by(sort_col.asc() if sort_dir == "asc" else sort_col.desc())


def serialize_plot(p: m.FarmerPlot) -> dict:
    return {
        "id": p.id, "label": p.label, "reported_area_acres": p.reported_area_acres,
        "points": p.points, "area_acres": p.area_acres, "method": p.method,
        "captured_at": p.captured_at,
    }


def serialize_survey(s: m.FarmerSurvey) -> dict:
    """
    Manual dict serialization instead of FastAPI's response_model=SurveyOut.
    A draft row can have NULL in any of the many fields SurveyOut inherits
    as strictly-required from SurveyIn (farmer_name, village, sale_type,
    ...) — running it through that Pydantic model would 500 the entire
    list/get endpoint the moment one draft exists, the exact same class of
    bug this file already documents once for model_validators (see
    SurveyOut's "input-only" validator overrides) but this time at the
    field-requiredness level, which can't be overridden the same way.
    Bypassing response_model entirely for these two read endpoints sidesteps
    it for good, for both drafts and any future requirement change.
    """
    data = {c.name: getattr(s, c.name) for c in m.FarmerSurvey.__table__.columns}
    data["status"] = s.status or "submitted"
    data["plots"] = [serialize_plot(p) for p in s.plots]
    return data


@app.get("/api/surveys", response_model=None)
def list_surveys(
    q: Optional[str] = None,
    farmer_id: Optional[str] = None,
    district: Optional[str] = None,
    taluka: Optional[str] = None,
    village: Optional[str] = None,
    society_assoc: Optional[str] = None,
    sale_type: Optional[str] = None,
    marketing_channel: Optional[str] = None,
    sale_month: Optional[str] = None,
    storage_source: Optional[str] = None,
    logistics_provider: Optional[str] = None,
    credit_linkage: Optional[str] = None,
    credit_source: Optional[str] = None,
    scheme_availed: Optional[str] = None,
    scheme_name: Optional[str] = None,
    soil_test_done: Optional[str] = None,
    crop_insurance: Optional[str] = None,
    input_source: Optional[str] = None,
    input_challenges: Optional[str] = None,
    tech_adoption: Optional[str] = None,
    society_benefits: Optional[str] = None,
    cultivation_challenges: Optional[str] = None,
    irrigation_source: Optional[str] = None,
    mech_owned: Optional[str] = None,
    mech_rented: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    status: Optional[str] = Query(None, pattern="^(draft|submitted)$"),  # Save as Draft
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: m.User = Depends(require_permission("farmer_records")),
):
    query = build_survey_query(
        db, q, farmer_id, district, taluka, village, society_assoc, sale_type,
        marketing_channel, sale_month, storage_source, logistics_provider, credit_linkage,
        credit_source, scheme_availed, scheme_name, soil_test_done, crop_insurance,
        input_source, input_challenges, tech_adoption, society_benefits,
        cultivation_challenges, irrigation_source, mech_owned, mech_rented,
        sort_by, sort_dir, status,
    )
    # capped result size + offset — prevents a single request from pulling the
    # entire table (OWASP API4:2023 Unrestricted Resource Consumption)
    rows = query.offset(offset).limit(limit).all()
    return [serialize_survey(r) for r in rows]


@app.get("/api/surveys/export", tags=["Surveys"])
def export_surveys(
    request: Request,
    q: Optional[str] = None,
    farmer_id: Optional[str] = None,
    district: Optional[str] = None,
    taluka: Optional[str] = None,
    village: Optional[str] = None,
    society_assoc: Optional[str] = None,
    sale_type: Optional[str] = None,
    marketing_channel: Optional[str] = None,
    sale_month: Optional[str] = None,
    storage_source: Optional[str] = None,
    logistics_provider: Optional[str] = None,
    credit_linkage: Optional[str] = None,
    credit_source: Optional[str] = None,
    scheme_availed: Optional[str] = None,
    scheme_name: Optional[str] = None,
    soil_test_done: Optional[str] = None,
    crop_insurance: Optional[str] = None,
    input_source: Optional[str] = None,
    input_challenges: Optional[str] = None,
    tech_adoption: Optional[str] = None,
    society_benefits: Optional[str] = None,
    cultivation_challenges: Optional[str] = None,
    irrigation_source: Optional[str] = None,
    mech_owned: Optional[str] = None,
    mech_rented: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
    user: m.User = Depends(require_permission("farmer_records")),
):
    """CR-19: exports exactly what the Farmer Records list is currently
    filtered/sorted to, as a real .xlsx (not a CSV with an .xlsx extension)."""
    query = build_survey_query(
        db, q, farmer_id, district, taluka, village, society_assoc, sale_type,
        marketing_channel, sale_month, storage_source, logistics_provider, credit_linkage,
        credit_source, scheme_availed, scheme_name, soil_test_done, crop_insurance,
        input_source, input_challenges, tech_adoption, society_benefits,
        cultivation_challenges, irrigation_source, mech_owned, mech_rented,
        sort_by, sort_dir,
    )
    # A higher cap than the UI list's 500/1000 (exports are an explicit, one-off
    # action rather than a page someone repeatedly reloads) but still capped —
    # same OWASP API4:2023 reasoning as list_surveys above.
    rows = query.limit(5000).all()

    import io
    from openpyxl import Workbook
    from fastapi.responses import StreamingResponse

    columns = [c.name for c in m.FarmerSurvey.__table__.columns]
    wb = Workbook()
    ws = wb.active
    ws.title = "Farmer Surveys"
    ws.append(columns)
    for r in rows:
        ws.append([getattr(r, c) for c in columns])
    for i, col in enumerate(columns, start=1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = max(12, min(30, len(col) + 2))

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    audit(db, request, "surveys_export", user=user, detail=f"{len(rows)} rows")
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="farmer_surveys_{datetime.date.today().isoformat()}.xlsx"'},
    )


@app.get("/api/surveys/{survey_id}", response_model=None)
def get_survey(survey_id: int, db: Session = Depends(get_db), user: m.User = Depends(require_permission("farmer_records"))):
    s = db.query(m.FarmerSurvey).get(survey_id)
    if not s:
        raise HTTPException(status_code=404, detail="Survey not found")
    return serialize_survey(s)


def compute_income(payload: SurveyIn) -> float:
    includes_raw = payload.sale_type in ("Sold raw areca", "Sold both raw and processed areca")
    includes_processed = payload.sale_type in ("Sold processed areca", "Sold both raw and processed areca")
    is_grading = includes_processed and payload.grading_done == "Yes"
    gross = 0.0
    if is_grading:
        # CR-05/CR-07: graded produce is sold at a per-variety rate, not one blanket
        # rate. That per-row rate is INR/Quintal (not INR/Kg like the blanket rate
        # below), and quantity_qtl is already in quintals, so no kg->quintal *100
        # conversion is needed here.
        rows = json.loads(payload.grading_rows) if payload.grading_rows else []
        gross += sum((r.get("quantity_qtl") or 0) * (r.get("rate_inr_per_kg") or 0) for r in rows)
        if includes_raw:
            gross += (payload.yield_raw_qtl or 0) * (payload.rate_inr_per_kg or 0) * 100
    else:
        yield_qtl = (payload.yield_raw_qtl or 0 if includes_raw else 0) + (payload.yield_processed_qtl or 0 if includes_processed else 0)
        gross = yield_qtl * (payload.rate_inr_per_kg or 0) * 100
    total = gross - payload.cultivation_cost_inr
    if includes_processed and payload.processing_cost_inr:
        total -= payload.processing_cost_inr
    return round(total, 0)


FARMER_ID_RE = re.compile(r"NCCF/KA/(\d+)")


def generate_farmer_id(db: Session) -> str:
    """
    Auto-assigns the next sequential "NCCF/KA/####" id once a brand-new
    farmer's survey has fully validated — the enumerator never types this in.
    Scans both FarmerMaster (the simulated Registration Portal) and
    FarmerSurvey so a freshly generated id can never collide with a
    previously-looked-up real farmer's id either.
    """
    max_n = 0
    for (fid,) in db.query(m.FarmerMaster.farmer_id).all():
        match = FARMER_ID_RE.search(fid or "")
        if match:
            max_n = max(max_n, int(match.group(1)))
    for (fid,) in db.query(m.FarmerSurvey.farmer_id).all():
        match = FARMER_ID_RE.search(fid or "")
        if match:
            max_n = max(max_n, int(match.group(1)))
    return f"NCCF/KA/{max_n + 1:04d}"


def sync_plots(db: Session, survey: m.FarmerSurvey, plots_in):
    """CR-17: replace a survey's FarmerPlot rows wholesale from the submitted
    list, and mirror plots[0] into the legacy single-boundary columns so
    older consumers (Plots Map, dashboard filters) keep working unchanged.
    No-op when the request didn't send `plots` at all (old-style clients)."""
    if plots_in is None:
        return
    survey.plots.clear()  # cascade="all, delete-orphan" removes the old rows on commit
    now = datetime.datetime.utcnow()
    for i, p in enumerate(plots_in):
        points_json = json.dumps([pt.model_dump() for pt in p.points]) if p.points else None
        survey.plots.append(m.FarmerPlot(
            sort_order=i,
            label=p.label or "Plot 1",
            reported_area_acres=p.reported_area_acres,
            boundary=points_json,
            area_acres=p.area_acres,
            method=p.method,
            captured_at=now if points_json else None,
        ))
    first = plots_in[0] if plots_in else None
    if first and first.points:
        survey.plot_boundary = json.dumps([pt.model_dump() for pt in first.points])
        survey.plot_boundary_area_acres = first.area_acres
        survey.plot_boundary_method = first.method
        survey.plot_boundary_captured_at = now
    else:
        survey.plot_boundary = None
        survey.plot_boundary_area_acres = None
        survey.plot_boundary_method = None
        survey.plot_boundary_captured_at = None


@app.post("/api/surveys", response_model=SurveyOut, tags=["Surveys"])
def create_survey(
    request: Request,
    payload: SurveyIn,
    db: Session = Depends(get_db),
    user: m.User = Depends(require_permission("survey_entry")),
):
    # If this exact offline-queued submission was already synced (e.g. the app
    # retried after a flaky connection), return the existing row instead of a duplicate.
    if payload.client_uuid:
        existing = db.query(m.FarmerSurvey).filter(m.FarmerSurvey.client_uuid == payload.client_uuid).first()
        if existing:
            return existing

    data = payload.dict()
    plots_in = data.pop("plots", None)  # not a FarmerSurvey column — handled via sync_plots (CR-17)
    data["status"] = "submitted"  # a full SurveyIn payload is, by definition, a completed survey — see POST .../draft for in-progress saves
    data["total_income_inr"] = compute_income(payload)
    data["entry_timestamp"] = datetime.datetime.utcnow()
    data["created_by_user_id"] = user.id
    if not data.get("farmer_id"):
        data["farmer_id"] = generate_farmer_id(db)
    if not data.get("survey_year"):
        data["survey_year"] = datetime.datetime.utcnow().year  # CR-18 — default to the year it was actually entered
    if data.get("plot_boundary"):
        data["plot_boundary_captured_at"] = datetime.datetime.utcnow()
    survey = m.FarmerSurvey(**data)
    db.add(survey)
    db.flush()  # assigns survey.id so FarmerPlot rows can reference it
    sync_plots(db, survey, payload.plots)
    db.commit()
    db.refresh(survey)
    audit(db, request, "survey_create", user=user, resource=f"survey:{survey.id}")
    return survey


@app.put("/api/surveys/{survey_id}", response_model=SurveyOut, tags=["Surveys"])
def update_survey(
    survey_id: int,
    request: Request,
    payload: SurveyIn,
    db: Session = Depends(get_db),
    user: m.User = Depends(require_permission("farmer_records")),
):
    survey = db.query(m.FarmerSurvey).get(survey_id)
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    data = payload.dict()
    plots_in = data.pop("plots", None)  # not a FarmerSurvey column — handled via sync_plots (CR-17)
    data["status"] = "submitted"  # finalizes a draft (or no-ops if it was already submitted) — a full SurveyIn payload is always complete
    data["total_income_inr"] = compute_income(payload)
    if not data.get("farmer_id"):
        # Preserve whatever the record already has — except a draft never
        # had one assigned at all (farmer_id is only auto-generated on a
        # brand-new create_survey, never on a draft save), so finalizing one
        # via this endpoint needs the same one-time assignment create_survey
        # would have done, or the now-"submitted" record would be stuck with
        # no farmer_id forever.
        data["farmer_id"] = survey.farmer_id or generate_farmer_id(db)
    if data.get("plot_boundary") and data.get("plot_boundary") != survey.plot_boundary:
        data["plot_boundary_captured_at"] = datetime.datetime.utcnow()
    for k, v in data.items():
        setattr(survey, k, v)
    sync_plots(db, survey, payload.plots)
    db.commit()
    db.refresh(survey)
    audit(db, request, "survey_update", user=user, resource=f"survey:{survey.id}")
    return survey


@app.post("/api/surveys/draft", response_model=None)
def create_survey_draft(
    request: Request,
    payload: SurveyDraftIn,
    db: Session = Depends(get_db),
    user: m.User = Depends(require_permission("survey_entry")),
):
    """
    Save as Draft: a field enumerator very often can't finish the full
    survey in one sitting (poor connectivity mid-village, the respondent
    gets pulled away, etc.) — this persists whatever has been filled in so
    far with none of SurveyIn's strict requirements enforced, so it can be
    resumed later from exactly where it was left off. Finalizing a draft
    still goes through the existing, unchanged, fully-validated POST/PUT
    /api/surveys — this endpoint and its PUT counterpart below only ever
    produce status="draft" rows.
    """
    data = payload.dict()
    data.pop("plots", None)  # not a FarmerSurvey column — handled via sync_plots (CR-17), using payload.plots below (the real pydantic objects, not the dict-ified copy)
    data["status"] = "draft"
    data["entry_timestamp"] = datetime.datetime.utcnow()
    data["created_by_user_id"] = user.id
    survey = m.FarmerSurvey(**data)
    db.add(survey)
    db.flush()
    sync_plots(db, survey, payload.plots)
    db.commit()
    db.refresh(survey)
    audit(db, request, "survey_draft_save", user=user, resource=f"survey:{survey.id}")
    return serialize_survey(survey)


@app.put("/api/surveys/{survey_id}/draft", response_model=None)
def update_survey_draft(
    survey_id: int,
    request: Request,
    payload: SurveyDraftIn,
    db: Session = Depends(get_db),
    user: m.User = Depends(require_permission("survey_entry")),
):
    survey = db.query(m.FarmerSurvey).get(survey_id)
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    if survey.status not in (None, "draft"):
        # Never silently revert an already-submitted survey back to an
        # incomplete-looking draft — resuming a completed record should go
        # through the normal edit form (PUT /api/surveys/{id}), which keeps
        # SurveyIn's full validation.
        raise HTTPException(status_code=400, detail="This survey has already been submitted — edit it from the farmer record instead of Save as Draft.")
    data = payload.dict()
    data.pop("plots", None)  # not a FarmerSurvey column — handled via sync_plots (CR-17), using payload.plots below
    data["status"] = "draft"
    for k, v in data.items():
        setattr(survey, k, v)
    sync_plots(db, survey, payload.plots)
    db.commit()
    db.refresh(survey)
    audit(db, request, "survey_draft_save", user=user, resource=f"survey:{survey.id}")
    return serialize_survey(survey)


@app.delete("/api/surveys/{survey_id}")
def delete_survey(
    survey_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: m.User = Depends(require_role("admin")),
):
    survey = db.query(m.FarmerSurvey).get(survey_id)
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    db.delete(survey)
    db.commit()
    audit(db, request, "survey_delete", user=user, resource=f"survey:{survey_id}")
    return {"ok": True}


# ---------------- PLOT BOUNDARY CAPTURE (v2) ----------------
# Separate from the survey's own PUT so saving a boundary (draw / Excel / GPS)
# never requires re-submitting — or re-validating — the entire 60+ field survey.

@app.get("/api/surveys/{survey_id}/plot-boundary", response_model=Optional[PlotBoundaryOut], tags=["Plot Boundary"])
def get_plot_boundary(survey_id: int, db: Session = Depends(get_db), user: m.User = Depends(require_permission("plots_map"))):
    survey = db.query(m.FarmerSurvey).get(survey_id)
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    if not survey.plot_boundary:
        return None
    return PlotBoundaryOut(
        survey_id=survey.id,
        points=_json.loads(survey.plot_boundary),
        area_acres=survey.plot_boundary_area_acres or 0,
        method=survey.plot_boundary_method or "draw",
        captured_at=survey.plot_boundary_captured_at,
    )


@app.put("/api/surveys/{survey_id}/plot-boundary", response_model=PlotBoundaryOut, tags=["Plot Boundary"])
def save_plot_boundary(
    survey_id: int,
    payload: PlotBoundaryIn,
    request: Request,
    db: Session = Depends(get_db),
    user: m.User = Depends(require_permission("plots_map")),
):
    survey = db.query(m.FarmerSurvey).get(survey_id)
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    survey.plot_boundary = _json.dumps([p.model_dump() for p in payload.points])
    survey.plot_boundary_area_acres = payload.area_acres
    survey.plot_boundary_method = payload.method
    survey.plot_boundary_captured_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(survey)
    audit(db, request, "plot_boundary_save", user=user, resource=f"survey:{survey.id}", detail=f"method={payload.method}, points={len(payload.points)}")

    return PlotBoundaryOut(
        survey_id=survey.id,
        points=[p.model_dump() for p in payload.points],
        area_acres=survey.plot_boundary_area_acres,
        method=survey.plot_boundary_method,
        captured_at=survey.plot_boundary_captured_at,
    )


@app.delete("/api/surveys/{survey_id}/plot-boundary", tags=["Plot Boundary"])
def delete_plot_boundary(
    survey_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: m.User = Depends(require_permission("plots_map")),
):
    survey = db.query(m.FarmerSurvey).get(survey_id)
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")
    survey.plot_boundary = None
    survey.plot_boundary_area_acres = None
    survey.plot_boundary_method = None
    survey.plot_boundary_captured_at = None
    db.commit()
    audit(db, request, "plot_boundary_delete", user=user, resource=f"survey:{survey_id}")
    return {"ok": True}


@app.get("/api/plots", response_model=list[PlotSummaryOut], tags=["Plot Boundary"])
def list_plots(
    only_with_boundary: bool = Query(False),
    db: Session = Depends(get_db),
    user: m.User = Depends(require_permission("plots_map")),
):
    """Lightweight feed for the read-only plots registry map — only the fields
    the map needs, not the full 60+ field survey record."""
    query = db.query(m.FarmerSurvey)
    if only_with_boundary:
        query = query.filter(m.FarmerSurvey.plot_boundary.isnot(None))
    return query.order_by(m.FarmerSurvey.id).limit(1000).all()


# ---------------- DASHBOARD KPIs ----------------

def split_multi(values):
    counter = Counter()
    for v in values:
        if not v:
            continue
        for part in str(v).split(","):
            part = part.strip()
            if part:
                counter[part] += 1
    return counter


@app.get("/api/dashboard/kpis", tags=["Dashboard"])
def dashboard_kpis(db: Session = Depends(get_db), user: m.User = Depends(get_current_user)):
    rows = db.query(m.FarmerSurvey).all()
    total = len(rows) or 1

    def pct(pred):
        return round(100 * sum(1 for r in rows if pred(r)) / total, 1)

    def avg(field_fn):
        vals = [field_fn(r) for r in rows if field_fn(r) is not None]
        return round(sum(vals) / len(vals), 2) if vals else 0

    def ratio_of_sums(numer_fn, denom_fn, digits=2):
        # sum(numerator)/sum(denominator) across rows where BOTH are present —
        # a row missing either (a draft, or a processed-only sale with no
        # yield_raw_qtl) is excluded from both sums rather than crashing the
        # whole endpoint (sum() over a generator containing a single None
        # raises TypeError: unsupported operand type(s) for +: 'float' and
        # 'NoneType' — this bit in production once a draft/partial row existed).
        pairs = [(numer_fn(r), denom_fn(r)) for r in rows]
        pairs = [(n, d) for n, d in pairs if n is not None and d is not None]
        denom_total = sum(d for _, d in pairs)
        return round(sum(n for n, _ in pairs) / denom_total, digits) if denom_total else 0

    village_counts = Counter(r.village for r in rows)
    district_counts = Counter(r.district for r in rows)
    taluka_counts = Counter(r.taluka for r in rows)

    society_benefit_counts = split_multi([r.society_benefits for r in rows if r.society_assoc == "Yes"])
    challenge_counts = split_multi([r.cultivation_challenges for r in rows])
    irrigation_counts = split_multi([r.irrigation_source for r in rows])

    sale_type_counts = Counter(r.sale_type for r in rows)
    channel_counts = Counter(r.marketing_channel for r in rows)
    month_yield = {mo: 0.0 for mo in ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]}
    month_count = {mo: 0 for mo in month_yield}
    for r in rows:
        if r.sale_month in month_yield:
            month_yield[r.sale_month] += r.yield_raw_qtl or 0
            month_count[r.sale_month] += 1

    storage_source_counts = Counter(r.storage_source for r in rows if r.storage_source)
    logistics_provider_avg_cost = {}
    for r in rows:
        if r.logistics_provider and r.logistics_cost_inr_per_qtl:
            logistics_provider_avg_cost.setdefault(r.logistics_provider, []).append(r.logistics_cost_inr_per_qtl)
    logistics_provider_avg_cost = {k: round(sum(v)/len(v), 1) for k, v in logistics_provider_avg_cost.items()}

    credit_source_counts = Counter(r.credit_source for r in rows if r.credit_linkage == "Yes" and r.credit_source)
    scheme_counts = Counter(r.scheme_name for r in rows if r.scheme_availed == "Yes" and r.scheme_name)
    input_source_counts = Counter(r.input_source for r in rows)
    input_challenge_counts = Counter(r.input_challenges for r in rows if r.input_challenges)

    mech_owned_counts = split_multi([r.mech_owned for r in rows])
    mech_rented_counts = split_multi([r.mech_rented for r in rows])

    diversified = sum(1 for r in rows if r.crop2_name)

    missing_geo_or_photo = sum(1 for r in rows if not r.geo_lat or not r.field_photo)

    return {
        "total_farmers": total,
        "reach": {
            "total_surveyed": total,
            "village_counts": village_counts.most_common(),
            "taluka_counts": taluka_counts.most_common(),
            "district_counts": district_counts.most_common(),
        },
        "institutional_linkage": {
            "pct_society_linked": pct(lambda r: r.society_assoc == "Yes"),
            "benefit_penetration": society_benefit_counts.most_common(),
        },
        "land_productivity": {
            "avg_own_land": avg(lambda r: r.land_own_acres),
            "avg_leased_land": avg(lambda r: r.land_leased_acres),
            "avg_areca_area": avg(lambda r: r.areca_area_acres),
            "avg_yield_per_acre": ratio_of_sums(lambda r: r.yield_raw_qtl, lambda r: r.areca_area_acres),
        },
        "economics": {
            "avg_cost_per_acre": ratio_of_sums(lambda r: r.cultivation_cost_inr, lambda r: r.areca_area_acres, digits=0),
            "avg_rate_per_kg": avg(lambda r: r.rate_inr_per_kg),
            "avg_net_income": avg(lambda r: r.total_income_inr),
            "sale_type_share": sale_type_counts.most_common(),
        },
        "market_access": {
            "channel_share": channel_counts.most_common(),
            "monthly_yield": month_yield,
            "monthly_count": month_count,
        },
        "storage_logistics": {
            "avg_storage_duration": avg(lambda r: r.storage_duration_months),
            "storage_source_share": storage_source_counts.most_common(),
            "logistics_cost_by_provider": logistics_provider_avg_cost,
        },
        "diversification": {
            "pct_diversified": pct(lambda r: bool(r.crop2_name)),
            "count_diversified": diversified,
        },
        "mechanisation": {
            "owned_counts": mech_owned_counts.most_common(),
            "rented_counts": mech_rented_counts.most_common(),
        },
        "financial_inclusion": {
            "pct_credit_linked": pct(lambda r: r.credit_linkage == "Yes"),
            "credit_source_share": credit_source_counts.most_common(),
            "avg_interest_rate": avg(lambda r: r.credit_interest_rate_pct),
            "avg_loan_amount": avg(lambda r: r.credit_amount_inr),
        },
        "scheme_penetration": {
            "pct_scheme_availed": pct(lambda r: r.scheme_availed == "Yes"),
            "scheme_share": scheme_counts.most_common(),
        },
        "sustainability": {
            "irrigation_share": irrigation_counts.most_common(),
            "pct_soil_test_done": pct(lambda r: r.soil_test_done == "Yes"),
        },
        "risk_management": {
            "pct_crop_insurance": pct(lambda r: r.crop_insurance == "Yes"),
        },
        "input_supply_chain": {
            "source_share": input_source_counts.most_common(),
            "avg_distance_km": avg(lambda r: r.input_distance_km),
            "challenge_share": input_challenge_counts.most_common(),
        },
        "technology_adoption": {
            "pct_tech_adoption": pct(lambda r: r.tech_adoption == "Yes"),
        },
        "advisory_targeting": {
            "challenge_share": challenge_counts.most_common(),
        },
        "audit": {
            "missing_geo_or_photo": missing_geo_or_photo,
            "geo_points": [{"lat": r.geo_lat, "lng": r.geo_long, "farmer": r.farmer_name, "village": r.village} for r in rows if r.geo_lat],
        },
    }


# ---------------- YIELD ESTIMATION ----------------

def _safe_avg(values):
    values = [v for v in values if v is not None]
    return round(sum(values) / len(values), 2) if values else 0


@app.get("/api/dashboard/yield-benchmarks", tags=["Dashboard"])
def yield_benchmarks(db: Session = Depends(get_db), user: m.User = Depends(get_current_user)):
    """
    Historical productivity benchmarks (from actual survey data) used to power the
    Yield Estimation tool: plants/acre density, yield/acre, price realised, and cost/acre,
    rolled up overall and per district/taluka so an enumerator can estimate an upcoming
    season's yield & income for a farmer before the harvest is even in.
    """
    rows = db.query(m.FarmerSurvey).all()

    def bucket(rows_subset):
        # Every numerator here (yield_raw_qtl, areca_plant_count,
        # cultivation_cost_inr) can now be None — a draft, or a processed-only
        # sale with no raw yield — so each comprehension below must guard the
        # numerator too, not just the denominator it's filtered on.
        return {
            "sample_size": len(rows_subset),
            "avg_plants_per_acre": _safe_avg([r.areca_plant_count / r.areca_area_acres for r in rows_subset if r.areca_area_acres and r.areca_plant_count is not None]),
            "avg_yield_per_acre_qtl": _safe_avg([r.yield_raw_qtl / r.areca_area_acres for r in rows_subset if r.areca_area_acres and r.yield_raw_qtl is not None]),
            "avg_yield_per_plant_kg": _safe_avg([r.yield_raw_qtl * 100 / r.areca_plant_count for r in rows_subset if r.areca_plant_count and r.yield_raw_qtl is not None]),
            "avg_rate_inr_per_kg": _safe_avg([r.rate_inr_per_kg for r in rows_subset]),
            "avg_cost_per_acre_inr": _safe_avg([r.cultivation_cost_inr / r.areca_area_acres for r in rows_subset if r.areca_area_acres and r.cultivation_cost_inr is not None]),
        }

    overall = bucket(rows)

    # A draft can have no district/taluka at all — exclude None rather than
    # sort it alongside strings, which TypeErrors ('<' not supported between
    # 'str' and 'NoneType').
    by_district = {}
    for d in sorted({r.district for r in rows if r.district is not None}):
        by_district[d] = bucket([r for r in rows if r.district == d])

    by_taluka = {}
    for t in sorted({r.taluka for r in rows if r.taluka is not None}):
        by_taluka[t] = bucket([r for r in rows if r.taluka == t])

    return {"overall": overall, "by_district": by_district, "by_taluka": by_taluka}

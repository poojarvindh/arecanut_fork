import re
import json
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

STR_MAX = 200        # generic short-text ceiling — blocks oversized-payload abuse
TEXT_MAX = 2000       # for free-text detail/benefits fields


class LoginIn(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=1, max_length=200)


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str
    username: str
    full_name: str
    permissions: List[str] = []


class RefreshIn(BaseModel):
    refresh_token: str = Field(..., min_length=1, max_length=500)


class LogoutIn(BaseModel):
    refresh_token: str = Field(..., min_length=1, max_length=500)


class UserOut(BaseModel):
    username: str
    full_name: str
    role: str
    permissions: List[str] = []


# Single source of truth lives in auth.py (PERMISSION_MODULES) — imported here
# rather than duplicated, after a duplication bug shipped where this list fell
# out of sync with auth.py's and rejected a newly added permission module.
from .auth import PERMISSION_MODULES as PERMISSION_MODULE_VALUES


class UserAdminOut(BaseModel):
    """Full user record for the admin-only User Management screen."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    full_name: str
    email: Optional[str] = None
    role: str
    permissions: List[str] = []
    is_active: bool
    created_at: datetime
    locked_until: Optional[datetime] = None

    @field_validator("permissions", mode="before")
    @classmethod
    def split_permissions(cls, v):
        # The DB stores this as a comma-separated string (see User.permissions
        # in models.py); this lets `.model_validate(user_row, from_attributes=True)`
        # work directly against the ORM object without a manual conversion step.
        if isinstance(v, str):
            return [p for p in v.split(",") if p]
        return v or []


class UserCreateIn(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_.-]+$")
    full_name: str = Field(..., min_length=1, max_length=STR_MAX)
    email: Optional[str] = Field(None, max_length=200)
    password: str = Field(..., min_length=1, max_length=200)
    role: str = Field(..., max_length=10)
    permissions: List[str] = []

    @field_validator("role")
    @classmethod
    def role_valid(cls, v: str) -> str:
        if v not in ("admin", "field"):
            raise ValueError('role must be "admin" or "field"')
        return v

    @field_validator("permissions")
    @classmethod
    def permissions_valid(cls, v: List[str]) -> List[str]:
        bad = [p for p in v if p not in PERMISSION_MODULE_VALUES]
        if bad:
            raise ValueError(f"unknown permission module(s): {bad}")
        return v


class UserUpdateIn(BaseModel):
    """All fields optional — only what's provided gets changed."""
    full_name: Optional[str] = Field(None, min_length=1, max_length=STR_MAX)
    email: Optional[str] = Field(None, max_length=200)
    role: Optional[str] = Field(None, max_length=10)
    permissions: Optional[List[str]] = None
    is_active: Optional[bool] = None
    new_password: Optional[str] = Field(None, min_length=1, max_length=200)

    @field_validator("role")
    @classmethod
    def role_valid(cls, v):
        if v is not None and v not in ("admin", "field"):
            raise ValueError('role must be "admin" or "field"')
        return v

    @field_validator("permissions")
    @classmethod
    def permissions_valid(cls, v):
        if v is None:
            return v
        bad = [p for p in v if p not in PERMISSION_MODULE_VALUES]
        if bad:
            raise ValueError(f"unknown permission module(s): {bad}")
        return v


class ForgotPasswordIn(BaseModel):
    # Accepts either the username or the registered email — kept as one loosely
    # typed field so the response can stay identical either way (see main.py;
    # this avoids leaking which identifier format is/isn't registered).
    identifier: str = Field(..., min_length=1, max_length=200)


class ResetPasswordIn(BaseModel):
    token: str = Field(..., min_length=1, max_length=200)
    new_password: str = Field(..., min_length=1, max_length=200)


class FarmerLookup(BaseModel):
    farmer_id: str
    farmer_name: str
    mobile_no: str
    gender: str
    age: int
    guardian_name: Optional[str] = None
    village: Optional[str] = None
    taluka: Optional[str] = None
    district: Optional[str] = None


class LatLngPoint(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class FarmerPlotIn(BaseModel):
    """CR-17: one plot/land record. `points`/`area_acres`/`method` mirror the
    legacy single-boundary shape — a plot is reported-area-only until a
    boundary is actually walked/drawn/uploaded for it."""
    label: str = Field("Plot 1", max_length=STR_MAX)
    reported_area_acres: float = Field(..., ge=0, le=100000)
    points: Optional[List[LatLngPoint]] = None
    area_acres: Optional[float] = Field(None, ge=0, le=100000)
    method: Optional[str] = Field(None, pattern="^(draw|excel|gps)$")

    @field_validator("points")
    @classmethod
    def points_form_a_polygon(cls, v):
        if v is not None and len(v) < 3:
            raise ValueError("a captured plot boundary needs at least 3 points")
        return v


class FarmerPlotOut(FarmerPlotIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    captured_at: Optional[datetime] = None


class DraftPlotIn(BaseModel):
    """Same shape as FarmerPlotIn, but a draft plot may have 0-2 boundary
    points (still mid-walk) and no reported area yet — deliberately no
    validators at all, since "incomplete" is the whole point of a draft."""
    label: Optional[str] = Field(None, max_length=STR_MAX)
    reported_area_acres: Optional[float] = Field(None, ge=0, le=100000)
    points: Optional[List[LatLngPoint]] = None
    area_acres: Optional[float] = Field(None, ge=0, le=100000)
    method: Optional[str] = Field(None, max_length=20)


class SurveyDraftIn(BaseModel):
    """
    A deliberately permissive mirror of SurveyIn used only for Save-as-Draft:
    every field is optional and there are no format/business validators
    (mobile-number-must-be-10-digits, areca-area-must-be-positive, yield
    required for the selected sale type, plot boundary mandatory, etc.) —
    "incomplete and possibly inconsistent" is exactly the state a draft is
    allowed to be in. SurveyIn itself is left completely untouched so the
    final "Submit Survey" path keeps its existing strict guarantees; this is
    a separate, independent schema, not a relaxed subclass of SurveyIn.
    """
    farmer_id: Optional[str] = Field(None, max_length=STR_MAX)
    farmer_name: Optional[str] = Field(None, max_length=STR_MAX)
    mobile_no: Optional[str] = Field(None, max_length=20)
    gender: Optional[str] = Field(None, max_length=20)
    age: Optional[int] = Field(None, ge=0, le=150)
    guardian_name: Optional[str] = Field(None, max_length=STR_MAX)
    survey_year: Optional[int] = Field(None, ge=1950, le=2100)

    society_assoc: Optional[str] = Field(None, max_length=10)
    society_name: Optional[str] = Field(None, max_length=STR_MAX)
    society_since_year: Optional[int] = Field(None, ge=1900, le=2100)
    society_benefits: Optional[str] = Field(None, max_length=TEXT_MAX)
    society_benefits_other: Optional[str] = Field(None, max_length=STR_MAX)

    village: Optional[str] = Field(None, max_length=STR_MAX)
    taluka: Optional[str] = Field(None, max_length=STR_MAX)
    district: Optional[str] = Field(None, max_length=STR_MAX)

    land_own_acres: Optional[float] = Field(None, ge=0, le=100000)
    land_leased_acres: Optional[float] = Field(None, ge=0, le=100000)
    areca_area_acres: Optional[float] = Field(None, ge=0, le=100000)
    areca_plant_count: Optional[int] = Field(None, ge=0, le=10_000_000)
    organic_farming: Optional[str] = Field(None, max_length=10)
    organic_certified: Optional[str] = Field(None, max_length=10)
    organic_cert_applied: Optional[str] = Field(None, max_length=10)
    organic_cert_aware: Optional[str] = Field(None, max_length=10)
    intercropping: Optional[str] = Field(None, max_length=10)
    intercrop_crops: Optional[str] = Field(None, max_length=TEXT_MAX)
    intercrop_crops_other: Optional[str] = Field(None, max_length=STR_MAX)
    intercrop_area_acres: Optional[float] = Field(None, ge=0, le=100000)

    cultivation_cost_inr: Optional[float] = Field(None, ge=0, le=100_000_000)
    yield_raw_qtl: Optional[float] = Field(None, ge=0, le=1_000_000)
    yield_processed_qtl: Optional[float] = Field(None, ge=0, le=1_000_000)

    sale_type: Optional[str] = Field(None, max_length=50)
    processing_cost_inr: Optional[float] = Field(None, ge=0, le=100_000_000)
    grading_done: Optional[str] = Field(None, max_length=10)
    grading_rows: Optional[str] = Field(None, max_length=TEXT_MAX)
    marketing_channel: Optional[str] = Field(None, max_length=STR_MAX)
    marketing_channel_detail: Optional[str] = Field(None, max_length=STR_MAX)
    rate_inr_per_kg: Optional[float] = Field(None, ge=0, le=1_000_000)
    sale_month: Optional[str] = Field(None, max_length=20)

    storage_duration_months: Optional[float] = Field(None, ge=0, le=1200)
    storage_source: Optional[str] = Field(None, max_length=STR_MAX)
    storage_loan_availed: Optional[str] = Field(None, max_length=10)
    storage_loan_amount_inr: Optional[float] = Field(None, ge=0, le=100_000_000)
    storage_loan_interest_pct: Optional[float] = Field(None, ge=0, le=50)
    storage_loan_repayment_months: Optional[int] = Field(None, ge=0, le=1200)
    storage_warehouse_receipt: Optional[str] = Field(None, max_length=10)
    logistics_provider: Optional[str] = Field(None, max_length=STR_MAX)
    logistics_provider_other: Optional[str] = Field(None, max_length=STR_MAX)
    logistics_cost_inr_per_qtl: Optional[float] = Field(None, ge=0, le=1_000_000)

    cultivation_challenges: Optional[str] = Field(None, max_length=TEXT_MAX)
    cultivation_challenges_other: Optional[str] = Field(None, max_length=STR_MAX)
    machinery_waiting_days: Optional[int] = Field(None, ge=0, le=3650)

    crop2_name: Optional[str] = Field(None, max_length=STR_MAX)
    crop2_area_acres: Optional[float] = Field(None, ge=0, le=100000)
    crop2_yield: Optional[float] = Field(None, ge=0, le=1_000_000)
    crop2_rate: Optional[float] = Field(None, ge=0, le=1_000_000)
    crop3_name: Optional[str] = Field(None, max_length=STR_MAX)
    crop3_area_acres: Optional[float] = Field(None, ge=0, le=100000)
    crop3_yield: Optional[float] = Field(None, ge=0, le=1_000_000)
    crop3_rate: Optional[float] = Field(None, ge=0, le=1_000_000)

    mech_owned: Optional[str] = Field(None, max_length=TEXT_MAX)
    mech_owned_other: Optional[str] = Field(None, max_length=STR_MAX)
    mech_rented: Optional[str] = Field(None, max_length=TEXT_MAX)
    mech_rented_other: Optional[str] = Field(None, max_length=STR_MAX)
    mech_rental_rate_inr_hr: Optional[str] = Field(None, max_length=TEXT_MAX)
    mech_financed: Optional[str] = Field(None, max_length=10)
    mech_loan_amount_inr_lakh: Optional[float] = Field(None, ge=0, le=1000)
    mech_loan_interest_pct: Optional[float] = Field(None, ge=0, le=50)

    total_household_income_inr_lakh: Optional[float] = Field(None, ge=0, le=1_000_000)
    total_household_income_bracket: Optional[str] = Field(None, max_length=20)
    non_farm_income_source: Optional[str] = Field(None, max_length=TEXT_MAX)
    non_farm_income_source_other: Optional[str] = Field(None, max_length=STR_MAX)
    bank_account: Optional[str] = Field(None, max_length=10)
    overdraft_facility: Optional[str] = Field(None, max_length=10)
    overdraft_limit_inr_lakh: Optional[float] = Field(None, ge=0, le=1000)

    credit_linkage: Optional[str] = Field(None, max_length=10)
    credit_source: Optional[str] = Field(None, max_length=STR_MAX)
    credit_source_other: Optional[str] = Field(None, max_length=STR_MAX)
    credit_amount_inr: Optional[float] = Field(None, ge=0, le=100_000_000)
    credit_interest_rate_pct: Optional[float] = Field(None, ge=0, le=50)
    credit_repayment_months: Optional[int] = Field(None, ge=0, le=1200)
    credit_outstanding_inr_lakh: Optional[float] = Field(None, ge=0, le=1000)
    loan_application_outcome: Optional[str] = Field(None, max_length=STR_MAX)
    loan_rejection_reason: Optional[str] = Field(None, max_length=STR_MAX)
    loan_rejection_reason_other: Optional[str] = Field(None, max_length=STR_MAX)
    credit_gap_inr_lakh: Optional[float] = Field(None, ge=0, le=1000)

    scheme_availed: Optional[str] = Field(None, max_length=10)
    scheme_name: Optional[str] = Field(None, max_length=TEXT_MAX)
    scheme_benefits: Optional[str] = Field(None, max_length=TEXT_MAX)

    irrigation_source: Optional[str] = Field(None, max_length=TEXT_MAX)
    irrigation_challenges: Optional[str] = Field(None, max_length=TEXT_MAX)

    soil_test_done: Optional[str] = Field(None, max_length=10)
    crop_insurance: Optional[str] = Field(None, max_length=10)
    crop_insurance_detail: Optional[str] = Field(None, max_length=TEXT_MAX)
    natural_calamity_5yr: Optional[str] = Field(None, max_length=10)

    input_source: Optional[str] = Field(None, max_length=TEXT_MAX)
    input_source_other: Optional[str] = Field(None, max_length=STR_MAX)
    input_distance_km: Optional[float] = Field(None, ge=0, le=100000)
    input_challenges: Optional[str] = Field(None, max_length=TEXT_MAX)
    input_challenges_other: Optional[str] = Field(None, max_length=STR_MAX)
    input_purchase_delay_days: Optional[int] = Field(None, ge=0, le=3650)

    tech_adoption: Optional[str] = Field(None, max_length=10)
    tech_adoption_detail: Optional[str] = Field(None, max_length=TEXT_MAX)

    kcc_account: Optional[str] = Field(None, max_length=10)
    kcc_limit_inr_lakh: Optional[float] = Field(None, ge=0, le=1000)

    mobile_verified: Optional[bool] = False

    geo_lat: Optional[float] = Field(None, ge=-90, le=90)
    geo_long: Optional[float] = Field(None, ge=-180, le=180)
    field_photo: Optional[str] = Field(None, max_length=6_000_000)
    client_uuid: Optional[str] = Field(None, max_length=100)

    plot_boundary: Optional[str] = Field(None, max_length=TEXT_MAX)
    plot_boundary_area_acres: Optional[float] = Field(None, ge=0, le=1_000_000)
    plot_boundary_method: Optional[str] = Field(None, max_length=20)

    plots: Optional[List[DraftPlotIn]] = None


class SurveyIn(BaseModel):
    # Optional at the API layer: a brand-new farmer's id is auto-generated
    # server-side once the whole survey validates (see create_survey in
    # main.py) rather than typed by the enumerator. An existing farmer looked
    # up via Fetch (Aadhaar/mobile/ID) still carries their real farmer_id here.
    farmer_id: Optional[str] = Field(None, max_length=STR_MAX)
    farmer_name: str = Field(..., min_length=1, max_length=STR_MAX)
    mobile_no: str
    gender: str = Field(..., max_length=20)
    age: int = Field(..., ge=18, le=80)
    guardian_name: Optional[str] = Field(None, max_length=STR_MAX)
    survey_year: Optional[int] = Field(None, ge=1950, le=2100)  # CR-18

    society_assoc: str = Field(..., max_length=10)
    society_name: Optional[str] = Field(None, max_length=STR_MAX)
    society_since_year: Optional[int] = Field(None, ge=1900, le=2100)
    society_benefits: Optional[str] = Field(None, max_length=TEXT_MAX)
    society_benefits_other: Optional[str] = Field(None, max_length=STR_MAX)

    village: str = Field(..., min_length=1, max_length=STR_MAX)
    taluka: str = Field(..., min_length=1, max_length=STR_MAX)
    district: str = Field(..., min_length=1, max_length=STR_MAX)

    land_own_acres: float = Field(..., ge=0, le=100000)
    land_leased_acres: Optional[float] = Field(0, ge=0, le=100000)
    areca_area_acres: float = Field(..., ge=0, le=100000)
    areca_plant_count: int = Field(..., ge=0, le=10_000_000)
    organic_farming: Optional[str] = Field(None, max_length=10)
    organic_certified: Optional[str] = Field(None, max_length=10)
    organic_cert_applied: Optional[str] = Field(None, max_length=10)
    organic_cert_aware: Optional[str] = Field(None, max_length=10)
    intercropping: Optional[str] = Field(None, max_length=10)
    intercrop_crops: Optional[str] = Field(None, max_length=TEXT_MAX)
    intercrop_crops_other: Optional[str] = Field(None, max_length=STR_MAX)
    intercrop_area_acres: Optional[float] = Field(None, ge=0, le=100000)

    cultivation_cost_inr: float = Field(..., ge=0, le=100_000_000)  # capped at INR 10 crore
    yield_raw_qtl: Optional[float] = Field(None, ge=0, le=1_000_000)  # required only when sale_type is "Sold raw areca"
    yield_processed_qtl: Optional[float] = Field(None, ge=0, le=1_000_000)

    sale_type: str = Field(..., max_length=50)
    processing_cost_inr: Optional[float] = Field(None, ge=0, le=100_000_000)  # capped at INR 10 crore
    grading_done: Optional[str] = Field(None, max_length=10)  # "Yes"/"No" — only asked for processed sales (CR-05)
    grading_rows: Optional[str] = Field(None, max_length=TEXT_MAX)  # JSON array of grade/variety rows (CR-05)
    marketing_channel: str = Field(..., max_length=STR_MAX)
    marketing_channel_detail: Optional[str] = Field(None, max_length=STR_MAX)
    rate_inr_per_kg: Optional[float] = Field(None, ge=0, le=1_000_000)  # not required when grading (CR-07)
    sale_month: str = Field(..., max_length=20)

    storage_duration_months: Optional[float] = Field(None, ge=0, le=1200)
    storage_source: Optional[str] = Field(None, max_length=STR_MAX)
    storage_loan_availed: Optional[str] = Field(None, max_length=10)
    storage_loan_amount_inr: Optional[float] = Field(None, ge=0, le=100_000_000)  # capped at INR 10 crore
    storage_loan_interest_pct: Optional[float] = Field(None, ge=0, le=50)  # capped at 50% per annum
    storage_loan_repayment_months: Optional[int] = Field(None, ge=0, le=1200)
    storage_warehouse_receipt: Optional[str] = Field(None, max_length=10)
    logistics_provider: Optional[str] = Field(None, max_length=STR_MAX)
    logistics_provider_other: Optional[str] = Field(None, max_length=STR_MAX)
    logistics_cost_inr_per_qtl: Optional[float] = Field(None, ge=0, le=1_000_000)

    cultivation_challenges: Optional[str] = Field(None, max_length=TEXT_MAX)
    cultivation_challenges_other: Optional[str] = Field(None, max_length=STR_MAX)
    machinery_waiting_days: Optional[int] = Field(None, ge=0, le=3650)

    crop2_name: Optional[str] = Field(None, max_length=STR_MAX)
    crop2_area_acres: Optional[float] = Field(None, ge=0, le=100000)
    crop2_yield: Optional[float] = Field(None, ge=0, le=1_000_000)
    crop2_rate: Optional[float] = Field(None, ge=0, le=1_000_000)
    crop3_name: Optional[str] = Field(None, max_length=STR_MAX)
    crop3_area_acres: Optional[float] = Field(None, ge=0, le=100000)
    crop3_yield: Optional[float] = Field(None, ge=0, le=1_000_000)
    crop3_rate: Optional[float] = Field(None, ge=0, le=1_000_000)

    mech_owned: Optional[str] = Field(None, max_length=TEXT_MAX)
    mech_owned_other: Optional[str] = Field(None, max_length=STR_MAX)
    mech_rented: Optional[str] = Field(None, max_length=TEXT_MAX)
    mech_rented_other: Optional[str] = Field(None, max_length=STR_MAX)
    mech_rental_rate_inr_hr: Optional[str] = Field(None, max_length=TEXT_MAX)
    mech_financed: Optional[str] = Field(None, max_length=10)
    mech_loan_amount_inr_lakh: Optional[float] = Field(None, ge=0, le=1000)  # capped at INR 10 crore (1000 lakh)
    mech_loan_interest_pct: Optional[float] = Field(None, ge=0, le=50)  # capped at 50% per annum

    total_household_income_inr_lakh: Optional[float] = Field(None, ge=0, le=1_000_000)  # legacy, superseded by bracket
    total_household_income_bracket: Optional[str] = Field(None, max_length=20)
    non_farm_income_source: Optional[str] = Field(None, max_length=TEXT_MAX)
    non_farm_income_source_other: Optional[str] = Field(None, max_length=STR_MAX)
    bank_account: Optional[str] = Field(None, max_length=10)
    overdraft_facility: Optional[str] = Field(None, max_length=10)
    overdraft_limit_inr_lakh: Optional[float] = Field(None, ge=0, le=1000)  # capped at INR 10 crore (1000 lakh)

    credit_linkage: str = Field(..., max_length=10)
    credit_source: Optional[str] = Field(None, max_length=STR_MAX)
    credit_source_other: Optional[str] = Field(None, max_length=STR_MAX)
    credit_amount_inr: Optional[float] = Field(None, ge=0, le=100_000_000)  # capped at INR 10 crore
    credit_interest_rate_pct: Optional[float] = Field(None, ge=0, le=50)  # capped at 50% per annum
    credit_repayment_months: Optional[int] = Field(None, ge=0, le=1200)
    credit_outstanding_inr_lakh: Optional[float] = Field(None, ge=0, le=1000)  # capped at INR 10 crore (1000 lakh)
    loan_application_outcome: Optional[str] = Field(None, max_length=STR_MAX)
    loan_rejection_reason: Optional[str] = Field(None, max_length=STR_MAX)
    loan_rejection_reason_other: Optional[str] = Field(None, max_length=STR_MAX)
    credit_gap_inr_lakh: Optional[float] = Field(None, ge=0, le=1000)  # capped at INR 10 crore (1000 lakh)

    scheme_availed: str = Field(..., max_length=10)
    scheme_name: Optional[str] = Field(None, max_length=TEXT_MAX)  # CR-15: multi-select, comma-joined
    scheme_benefits: Optional[str] = Field(None, max_length=TEXT_MAX)

    irrigation_source: Optional[str] = Field(None, max_length=TEXT_MAX)
    irrigation_challenges: Optional[str] = Field(None, max_length=TEXT_MAX)

    soil_test_done: str = Field(..., max_length=10)
    crop_insurance: str = Field(..., max_length=10)
    crop_insurance_detail: Optional[str] = Field(None, max_length=TEXT_MAX)
    natural_calamity_5yr: Optional[str] = Field(None, max_length=10)

    input_source: str = Field(..., max_length=TEXT_MAX)  # CR-14: multi-select, comma-joined
    input_source_other: Optional[str] = Field(None, max_length=STR_MAX)
    input_distance_km: Optional[float] = Field(None, ge=0, le=100000)
    input_challenges: Optional[str] = Field(None, max_length=TEXT_MAX)  # CR-14: multi-select, comma-joined
    input_challenges_other: Optional[str] = Field(None, max_length=STR_MAX)
    input_purchase_delay_days: Optional[int] = Field(None, ge=0, le=3650)

    tech_adoption: str = Field(..., max_length=10)
    tech_adoption_detail: Optional[str] = Field(None, max_length=TEXT_MAX)

    kcc_account: Optional[str] = Field(None, max_length=10)
    kcc_limit_inr_lakh: Optional[float] = Field(None, ge=0, le=1000)  # capped at INR 10 crore (1000 lakh)

    mobile_verified: Optional[bool] = False

    geo_lat: Optional[float] = Field(None, ge=-90, le=90)
    geo_long: Optional[float] = Field(None, ge=-180, le=180)
    field_photo: Optional[str] = Field(None, max_length=6_000_000)  # base64 data URL, client-compressed
    client_uuid: Optional[str] = Field(None, max_length=100)  # set by the app when queued offline, for de-duplication on sync

    plot_boundary: Optional[str] = Field(None, max_length=TEXT_MAX)
    plot_boundary_area_acres: Optional[float] = Field(None, ge=0, le=1_000_000)
    plot_boundary_method: Optional[str] = Field(None, max_length=20)

    # CR-17: multiple plot/land records per farmer. When present (new/edited
    # surveys from the updated wizard), this supersedes the single legacy
    # plot_boundary field above for validation purposes — main.py still keeps
    # plot_boundary/* in sync with plots[0] so older consumers (Plots Map,
    # dashboard filters) keep working unchanged.
    plots: Optional[List[FarmerPlotIn]] = None

    @field_validator("mobile_no")
    @classmethod
    def validate_mobile(cls, v: str) -> str:
        if not re.fullmatch(r"\d{10}", v.strip()):
            raise ValueError("mobile_no must be exactly 10 digits")
        return v.strip()

    @field_validator(
        "society_assoc", "credit_linkage", "scheme_availed", "soil_test_done",
        "crop_insurance", "tech_adoption",
        "organic_farming", "organic_certified", "organic_cert_applied", "organic_cert_aware",
        "intercropping", "storage_loan_availed", "storage_warehouse_receipt", "mech_financed",
        "bank_account", "overdraft_facility", "natural_calamity_5yr", "kcc_account",
    )
    @classmethod
    def validate_yes_no(cls, v):
        if v is not None and v not in ("Yes", "No"):
            raise ValueError('must be "Yes" or "No"')
        return v

    @field_validator("areca_area_acres")
    @classmethod
    def areca_area_not_negative(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("areca_area_acres must be greater than 0")
        return v

    @field_validator("land_own_acres", "land_leased_acres", "intercrop_area_acres")
    @classmethod
    def max_two_decimals(cls, v):
        if v is not None and round(v, 2) != v:
            raise ValueError("must have at most 2 decimal places")
        return v

    @field_validator("cultivation_cost_inr")
    @classmethod
    def whole_number_cost(cls, v: float) -> float:
        if v != int(v):
            raise ValueError("must be a whole number (no decimals)")
        return v

    @field_validator("tech_adoption_detail")
    @classmethod
    def tech_adoption_detail_is_text(cls, v):
        if v is not None and v.strip() and not re.search(r"[a-zA-Z]{2,}", v):
            raise ValueError("must be a real description, not just numbers or symbols")
        return v

    @field_validator("yield_raw_qtl", "yield_processed_qtl")
    @classmethod
    def yield_positive_two_decimals(cls, v):
        if v is None:
            return v
        if v <= 0:
            raise ValueError("must be a positive value")
        if round(v, 2) != v:
            raise ValueError("must have at most 2 decimal places")
        return v

    @model_validator(mode="after")
    def yield_matches_sale_type(self):
        if self.sale_type in ("Sold raw areca", "Sold both raw and processed areca") and self.yield_raw_qtl is None:
            raise ValueError("yield_raw_qtl is required for a raw areca sale")
        if self.sale_type in ("Sold processed areca", "Sold both raw and processed areca") and self.yield_processed_qtl is None:
            raise ValueError("yield_processed_qtl is required for a processed areca sale")
        return self

    @model_validator(mode="after")
    def grading_rows_required_when_grading(self):
        # CR-05/CR-07: grading is only offered for processed sales; when the farmer
        # grades/sorts, per-row rates replace the single top-level Rate Realised field.
        is_processed = self.sale_type in ("Sold processed areca", "Sold both raw and processed areca")
        is_grading = is_processed and self.grading_done == "Yes"
        if is_grading:
            try:
                rows = json.loads(self.grading_rows) if self.grading_rows else []
            except (ValueError, TypeError):
                raise ValueError("grading_rows must be a valid JSON array")
            if not isinstance(rows, list) or len(rows) == 0:
                raise ValueError("at least one grading row is required when grading_done = Yes")
            for row in rows:
                if not isinstance(row, dict) or not row.get("variety") or row.get("quantity_qtl") is None or row.get("rate_inr_per_kg") is None:
                    raise ValueError("each grading row needs variety, quantity_qtl and rate_inr_per_kg")
        elif self.rate_inr_per_kg is None:
            raise ValueError("rate_inr_per_kg is required unless the farmer grades/sorts processed produce")
        return self

    @model_validator(mode="after")
    def areca_area_within_land(self):
        total_land = (self.land_own_acres or 0) + (self.land_leased_acres or 0)
        if self.areca_area_acres > total_land:
            raise ValueError("areca_area_acres cannot exceed total own + leased land")
        return self

    @model_validator(mode="after")
    def plot_boundary_required(self):
        # CR-17: a survey using the new multi-plot flow (plots is not None)
        # is validated by at-least-one-plot-has-a-boundary instead of the
        # single legacy field — every plot still needs a reported area
        # (enforced by FarmerPlotIn itself), but the boundary walk/draw/upload
        # is only mandatory somewhere across the set, not on every plot.
        if self.plots is not None:
            if len(self.plots) == 0:
                raise ValueError("at least one plot is required")
            if not any(p.points and len(p.points) >= 3 for p in self.plots):
                raise ValueError("at least one plot needs a captured boundary — capture at least 3 points via Draw on Map, Excel upload, or GPS walk")
            return self
        try:
            points = json.loads(self.plot_boundary) if self.plot_boundary else []
        except (ValueError, TypeError):
            points = []
        if not isinstance(points, list) or len(points) < 3:
            raise ValueError("plot_boundary is mandatory — capture at least 3 points via Draw on Map, Excel upload, or GPS walk")
        return self


class SurveyOut(SurveyIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    total_income_inr: float
    entry_timestamp: datetime
    created_by_user_id: Optional[int] = None
    plot_boundary: Optional[str] = None
    plot_boundary_area_acres: Optional[float] = None
    plot_boundary_method: Optional[str] = None
    plot_boundary_captured_at: Optional[datetime] = None
    plots: List[FarmerPlotOut] = Field(default_factory=list)  # CR-17
    status: Optional[str] = "submitted"  # "draft" | "submitted" — Save as Draft

    # These two rules are intentionally input-only (create/update): they enforce
    # requirements for new/edited data, but records saved before a requirement
    # existed must still be readable — otherwise GET /api/surveys throws on any
    # pre-existing row and the whole list disappears. Redefining the same
    # validator name here overrides (neutralizes) the parent SurveyIn validator
    # for this output-only subclass.
    @model_validator(mode="after")
    def plot_boundary_required(self):
        return self

    @model_validator(mode="after")
    def yield_matches_sale_type(self):
        return self

    @model_validator(mode="after")
    def grading_rows_required_when_grading(self):
        return self

    # Same input-only reasoning as above: a content-shape rule (must contain
    # real text, not just symbols/numbers) should never make an old row
    # unreadable if a validator tightened after it was saved.
    @field_validator("tech_adoption_detail")
    @classmethod
    def tech_adoption_detail_is_text(cls, v):
        return v


# ---------------- Plot Boundary Capture (v2) ----------------

class LatLngPoint(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class PlotBoundaryIn(BaseModel):
    points: list[LatLngPoint] = Field(..., min_length=3, max_length=2000)
    area_acres: float = Field(..., ge=0, le=100000)
    method: str = Field(..., pattern="^(draw|excel|gps)$")


class PlotBoundaryOut(BaseModel):
    survey_id: int
    points: list[LatLngPoint]
    area_acres: float
    method: str
    captured_at: Optional[datetime] = None


class PlotSummaryOut(BaseModel):
    survey_id: int = Field(..., alias="id")
    farmer_name: str
    village: str
    taluka: str
    district: str
    areca_area_acres: float
    plot_boundary: Optional[str] = None
    plot_boundary_area_acres: Optional[float] = None

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)



# ---------------- FPO CONSULTATION MODULE ----------------
# Every field optional by design — this schema backs a draft-safe, step-wise-saved
# wizard (see FPOConsultation model docstring in models.py), so a PUT can carry
# just the handful of fields the current step collected, not the whole form.

class FPOConsultationIn(BaseModel):
    interview_date: Optional[str] = None
    respondent_name: Optional[str] = None
    respondent_designation: Optional[str] = None
    respondent_mobile: Optional[str] = None
    others_present: Optional[str] = None
    interview_location: Optional[str] = None
    geo_lat: Optional[float] = None
    geo_long: Optional[float] = None
    fpo_name: Optional[str] = None
    cin: Optional[str] = None
    incorporation_date: Optional[str] = None
    fpo_age_years: Optional[float] = None
    legal_form: Optional[str] = None
    district: Optional[str] = None
    taluk: Optional[str] = None
    villages_covered: Optional[int] = None
    implementing_agency: Optional[str] = None
    cbbo_name: Optional[str] = None
    promoting_agency: Optional[str] = None
    promoting_agency_other: Optional[str] = None
    primary_crop: Optional[str] = None
    secondary_crop: Optional[str] = None
    women_members: Optional[int] = None
    women_on_board: Optional[int] = None
    turnover_fy24: Optional[float] = None
    turnover_fy25: Optional[float] = None
    turnover_fy26: Optional[float] = None
    profit_fy24: Optional[float] = None
    profit_fy25: Optional[float] = None
    profit_fy26: Optional[float] = None
    q1_board_size: Optional[str] = None
    q1_board_women_count: Optional[int] = None
    q2_board_experience: Optional[str] = None
    q2_board_members_running_business: Optional[int] = None
    q2_business_nature: Optional[str] = None
    q2_business_nature_other: Optional[str] = None
    q3_minutes_records: Optional[str] = None
    q3_meetings_per_year: Optional[int] = None
    q3_meeting_frequency: Optional[str] = None
    last_agm_date: Optional[str] = None
    shareholder_attendance_pct: Optional[float] = None
    q4_has_ceo: Optional[str] = None
    q4a_ceo_experience: Optional[str] = None
    q4b_ceo_years: Optional[float] = None
    q4b_ceo_engagement: Optional[str] = None
    q4c_ceo_trade_or_admin: Optional[str] = None
    q5_has_accountant: Optional[str] = None
    q5a_accountant_experience: Optional[str] = None
    q5b_accountant_years: Optional[float] = None
    q5b_accountant_engagement: Optional[str] = None
    q5c_software_used: Optional[str] = None
    q5c_software_other: Optional[str] = None
    q6_second_line_mgmt: Optional[str] = None
    q6_total_staff: Optional[int] = None
    q6_field_staff: Optional[int] = None
    q7_registered_members: Optional[str] = None
    q7_actively_transacting: Optional[str] = None
    q8_promoting_agency_role: Optional[str] = None
    bds_providers: Optional[str] = None
    q10_govt_scheme_converged: Optional[str] = None
    govt_schemes: Optional[str] = None
    licences: Optional[str] = None
    q11_deals_in: Optional[str] = None
    q12_price_risk: Optional[str] = None
    q13_external_lending: Optional[str] = None
    q14_trading_platforms: Optional[str] = None
    q15_accounts_mis: Optional[str] = None
    q16_stock_insured: Optional[str] = None
    q17_credit_repayment_history: Optional[str] = None
    q18_books_update_freq: Optional[str] = None
    q19_stock_reconciliation_freq: Optional[str] = None
    q20_cash_revenue_share: Optional[str] = None
    q21_traceability_records: Optional[str] = None
    q22_total_annual_revenue: Optional[str] = None
    q23_gross_profit_margin: Optional[str] = None
    q24_profitability_trend: Optional[str] = None
    q25_paid_up_capital: Optional[float] = None
    q26_revenue_share_arecanut_pct: Optional[float] = None
    q27_audited_statements: Optional[str] = None
    q27_documents_available: Optional[str] = None
    q27_documents_other: Optional[str] = None
    q28_avg_procurement_value_per_cycle: Optional[float] = None
    q29_procurement_cycles_per_season: Optional[int] = None
    q30_peak_procurement_value: Optional[float] = None
    q31_max_value_awaiting_settlement: Optional[float] = None
    q32_settlement_days: Optional[float] = None
    q33_active_farmers_band: Optional[str] = None
    q33_actual_farmers: Optional[int] = None
    q33_women_farmers: Optional[int] = None
    q34_aggregate_last_fy_band: Optional[str] = None
    q34_actual_mt: Optional[float] = None
    q34_value_inr_lakh: Optional[float] = None
    volume_split_form: Optional[str] = None
    volume_split_grade: Optional[str] = None
    produce_channels: Optional[str] = None
    q36a_why_channels: Optional[str] = None
    q37_additional_supply_band: Optional[str] = None
    q37_actual_mt_per_year: Optional[float] = None
    q37a_volume_source: Optional[str] = None
    q38_supply_stability: Optional[str] = None
    q38_peak_months: Optional[str] = None
    q38_lean_months: Optional[str] = None
    q39_biggest_constraint: Optional[str] = None
    q39_notes: Optional[str] = None
    q40_quality_check_method: Optional[str] = None
    q40_moisture_meter_available: Optional[str] = None
    q40_moisture_meter_units: Optional[int] = None
    q40_moisture_meter_last_calibrated: Optional[str] = None
    q41_rejection_rate_band: Optional[str] = None
    q41_actual_pct: Optional[float] = None
    q41a_reason1: Optional[str] = None
    q41a_reason2: Optional[str] = None
    quality_practices: Optional[str] = None
    q42a_uncoloured_lots: Optional[str] = None
    q43_meet_spec: Optional[str] = None
    q43_what_required: Optional[str] = None
    q44_infrastructure: Optional[str] = None
    q44_collection_centres_count: Optional[int] = None
    q44_additional_infra_needed: Optional[str] = None
    common_facilities: Optional[str] = None
    q46_chc_machines_rates: Optional[str] = None
    storage_logistics: Optional[str] = None
    q48_delivery_reliability: Optional[str] = None
    q48_evidence_sighted: Optional[str] = None
    q49_price_determination: Optional[str] = None
    q49_price_revision_frequency: Optional[str] = None
    q49_reference_mandi: Optional[str] = None
    unit_economics: Optional[str] = None
    q51_payment_speed: Optional[str] = None
    q51_payment_mode: Optional[str] = None
    q51_share_paid_digitally_pct: Optional[float] = None
    q51_paid_upfront_pct: Optional[float] = None
    q52_upfront_funds_source: Optional[str] = None
    q53_biggest_financial_constraint: Optional[str] = None
    q54_estimated_loss_value: Optional[float] = None
    q54_estimated_loss_mt: Optional[float] = None
    credit_facilities: Optional[str] = None
    credit_history: Optional[str] = None
    q55b_warehouse_receipt_used: Optional[str] = None
    q55c_loan_rejected: Optional[str] = None
    q55c_rejection_count: Optional[int] = None
    q55c_rejection_lender: Optional[str] = None
    q55c_rejection_year: Optional[str] = None
    q55c_rejection_reason: Optional[str] = None
    q55c_rejection_reason_other: Optional[str] = None
    credit_gap: Optional[str] = None
    q56_lender_limit_indicated: Optional[str] = None
    q56_reason: Optional[str] = None
    q56_reason_other: Optional[str] = None
    q57_working_capital_needed: Optional[float] = None
    q57_proposed_source: Optional[str] = None
    q58_buy_or_commission: Optional[str] = None
    q58_handling_fee: Optional[float] = None
    q59_collateral_type: Optional[str] = None
    q59_collateral_other: Optional[str] = None
    q60_pledged_produce_share_pct: Optional[float] = None
    q61_collateral_effort: Optional[str] = None
    q62_max_interest_rate: Optional[float] = None
    q63_loan_tenure: Optional[str] = None
    q64_trader_preference_reasons: Optional[str] = None
    q64_reasons_other: Optional[str] = None
    q65_what_would_shift_farmers: Optional[str] = None
    services_to_members: Optional[str] = None
    q67_intercrops: Optional[str] = None
    q67_intercrops_other: Optional[str] = None
    q67_fpo_support: Optional[str] = None
    q67_intercropping_share_pct: Optional[float] = None
    q68_farmer_challenges: Optional[str] = None
    q68_challenges_other: Optional[str] = None
    buyers: Optional[str] = None
    q69_committed_volume_mt: Optional[float] = None
    q69_uncommitted_volume_mt: Optional[float] = None
    q70_buyer_requirements: Optional[str] = None
    q70_top_three: Optional[str] = None
    q71_trial_consignment: Optional[str] = None
    q71_trial_volume_mt: Optional[float] = None
    q71_earliest_month: Optional[str] = None
    q72_board_resolution: Optional[str] = None
    signature: Optional[str] = None
    signature_date: Optional[str] = None


class FPOConsultationOut(FPOConsultationIn):
    id: int
    status: str
    created_at: datetime
    updated_at: datetime
    submitted_at: Optional[datetime] = None
    created_by_user_id: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class FPOConsultationListItem(BaseModel):
    """Lightweight row for the drafts/submissions list screen — avoids shipping
    all 180 fields just to render a resumable list."""
    id: int
    status: str
    fpo_name: Optional[str] = None
    district: Optional[str] = None
    respondent_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

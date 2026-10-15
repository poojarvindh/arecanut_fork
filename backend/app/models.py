from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
import datetime
from .db import Base


# ---------------- AUTH ----------------

class User(Base):
    __tablename__ = "auth_user"
    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, nullable=False, index=True)
    email = Column(String, unique=True, nullable=True, index=True)
    full_name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default="field")  # "admin" | "field" — exactly one "admin" row may ever exist, enforced in main.py
    # Comma-separated module keys (see PERMISSION_MODULES in main.py), meaningful
    # only for role="field" — an admin implicitly has every module regardless of
    # what's stored here. Set by an admin from the User Management screen.
    permissions = Column(String, nullable=True, default="survey_entry,farmer_records,plots_map")
    is_active = Column(Boolean, default=True)
    failed_login_count = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    created_by_user_id = Column(Integer, ForeignKey("auth_user.id"), nullable=True)


class PasswordResetToken(Base):
    """
    Like refresh tokens, only the SHA-256 hash of the raw token is stored — the
    raw token exists only in the emailed link and briefly in memory. Single-use
    (marked via used_at) and short-lived (see config.PASSWORD_RESET_EXPIRE_MINUTES).
    """
    __tablename__ = "auth_password_reset_token"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("auth_user.id"), nullable=False, index=True)
    token_hash = Column(String, unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)


class RefreshToken(Base):
    """
    Refresh tokens are stored only as a SHA-256 hash (never the raw token), so a
    database leak alone can't be used to impersonate a session. Rotation is
    enforced: each /auth/refresh call revokes the token it consumed and issues a
    new one, so a stolen-but-unused-yet refresh token can be detected (reuse of
    a revoked token is treated as a compromise signal).
    """
    __tablename__ = "auth_refresh_token"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("auth_user.id"), nullable=False, index=True)
    token_hash = Column(String, unique=True, nullable=False, index=True)
    issued_at = Column(DateTime, default=datetime.datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)


class AuditLog(Base):
    """Append-only trail of security-relevant events for post-incident review."""
    __tablename__ = "audit_log"
    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    user_id = Column(Integer, ForeignKey("auth_user.id"), nullable=True)
    username = Column(String, nullable=True)
    action = Column(String, nullable=False)  # e.g. "login_success", "login_failed", "survey_delete"
    resource = Column(String, nullable=True)  # e.g. "survey:101"
    ip_address = Column(String, nullable=True)
    detail = Column(String, nullable=True)


# ---------------- MASTER DATA TABLES ----------------

class District(Base):
    __tablename__ = "m_district"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    talukas = relationship("Taluka", back_populates="district")


class Taluka(Base):
    __tablename__ = "m_taluka"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    district_id = Column(Integer, ForeignKey("m_district.id"))
    district = relationship("District", back_populates="talukas")
    villages = relationship("Village", back_populates="taluka")


class Village(Base):
    __tablename__ = "m_village"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    taluka_id = Column(Integer, ForeignKey("m_taluka.id"))
    taluka = relationship("Taluka", back_populates="villages")


class Society(Base):
    __tablename__ = "m_society"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    district_id = Column(Integer, ForeignKey("m_district.id"), nullable=True)
    taluka_id = Column(Integer, ForeignKey("m_taluka.id"), nullable=True)  # null => state-level society
    is_state_level = Column(Boolean, nullable=False, default=False)


class CropMaster(Base):
    __tablename__ = "m_crop"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)


class SchemeMaster(Base):
    __tablename__ = "m_scheme"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)


class MachineMaster(Base):
    __tablename__ = "m_machine"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)


class OptionMaster(Base):
    """Generic master for simple dropdown/multi-select option lists keyed by list_code."""
    __tablename__ = "m_option"
    id = Column(Integer, primary_key=True)
    list_code = Column(String, nullable=False, index=True)
    label = Column(String, nullable=False)
    sort_order = Column(Integer, default=0)


# ---------------- FARMER MASTER (Registration Portal - simulated) ----------------

class FarmerMaster(Base):
    __tablename__ = "farmer_master"
    id = Column(Integer, primary_key=True)
    farmer_id = Column(String, unique=True, nullable=False)   # e.g. NCCF/KA/0001
    farmer_name = Column(String, nullable=False)
    mobile_no = Column(String, nullable=False)
    aadhaar_no = Column(String, nullable=False)
    gender = Column(String, nullable=False)
    age = Column(Integer, nullable=False)
    guardian_name = Column(String, nullable=True)
    village_id = Column(Integer, ForeignKey("m_village.id"))
    bank_account_no = Column(String, nullable=True)
    bank_ifsc = Column(String, nullable=True)


# ---------------- SURVEY / DATA ENTRY (62 fields across 17 modules) ----------------

class FarmerSurvey(Base):
    __tablename__ = "farmer_survey"
    id = Column(Integer, primary_key=True)

    # "draft" | "submitted" — Save as Draft. NULL is treated as "submitted"
    # for backward compatibility: every row saved before this column existed
    # necessarily went through the old all-or-nothing validation, so it's
    # unambiguously a completed survey, not a draft. See db.py's
    # sync_nullable_columns() for why the many NOT NULL columns below had to
    # be relaxed for this to work on a column-by-column basis without a real
    # migration tool.
    status = Column(String, nullable=True, index=True)

    # Module 0: Farmer Master Link
    # All of these were previously nullable=False — a draft may not have
    # them yet (e.g. the enumerator fetched a farmer but hasn't typed the
    # rest), so every field a draft could plausibly leave blank is now
    # nullable at the DB level too. The *strict* contract — every one of
    # these actually required before a survey counts as submitted — still
    # lives entirely in schemas.py::SurveyIn, completely unchanged; nothing
    # here weakens what "Submit Survey" accepts.
    farmer_id = Column(String, nullable=True, index=True)
    farmer_name = Column(String, nullable=True)
    mobile_no = Column(String, nullable=True)
    gender = Column(String, nullable=True)
    age = Column(Integer, nullable=True)
    guardian_name = Column(String, nullable=True)

    # CR-18: the agricultural year/season this survey reports on — distinct
    # from entry_timestamp (when it was typed into the system). A farmer
    # already gets a new row per survey (no uniqueness constraint on
    # farmer_id — see the Session Log), so this is what the Farmer History
    # view groups/sorts by, letting someone backfill or correct a past
    # season's entry without it being mistaken for "this year".
    survey_year = Column(Integer, nullable=True, index=True)

    # Module 1: Society / FPC Linkage
    society_assoc = Column(String, nullable=True)          # Yes/No
    society_name = Column(String, nullable=True)
    society_since_year = Column(Integer, nullable=True)
    society_benefits = Column(String, nullable=True)        # comma-separated
    society_benefits_other = Column(String, nullable=True)

    # Module 2: Location Details
    village = Column(String, nullable=True)
    taluka = Column(String, nullable=True)
    district = Column(String, nullable=True)

    # Module 3: Land Holding
    land_own_acres = Column(Float, nullable=True)
    land_leased_acres = Column(Float, nullable=True, default=0)
    areca_area_acres = Column(Float, nullable=True)
    areca_plant_count = Column(Integer, nullable=True)
    organic_farming = Column(String, nullable=True)          # Yes/No
    organic_certified = Column(String, nullable=True)        # Yes/No — if organic_farming == Yes
    organic_cert_applied = Column(String, nullable=True)     # Yes/No — if organic_certified == No
    organic_cert_aware = Column(String, nullable=True)       # Yes/No — if organic_cert_applied == No
    intercropping = Column(String, nullable=True)            # Yes/No
    intercrop_crops = Column(String, nullable=True)          # comma-separated
    intercrop_crops_other = Column(String, nullable=True)
    intercrop_area_acres = Column(Float, nullable=True)

    # Module 4: Cultivation Cost & Yield
    cultivation_cost_inr = Column(Float, nullable=True)
    yield_raw_qtl = Column(Float, nullable=True)  # required only when sale_type is "Sold raw areca"
    yield_processed_qtl = Column(Float, nullable=True)

    # Module 5: Sales, Marketing & Income
    sale_type = Column(String, nullable=True)
    processing_cost_inr = Column(Float, nullable=True)
    grading_done = Column(String, nullable=True)  # "Yes"/"No" — only asked when sale_type includes processed (CR-05)
    grading_rows = Column(Text, nullable=True)  # JSON array of {variety, variety_other, quantity_qtl, rate_inr_per_kg} (CR-05)
    marketing_channel = Column(String, nullable=True)
    marketing_channel_detail = Column(String, nullable=True)  # name, if Cooperative Society / APMC
    rate_inr_per_kg = Column(Float, nullable=True)  # not required when grading (CR-07) — required check moved to app validation
    total_income_inr = Column(Float, nullable=True)        # auto-calculated; null for an unsubmitted draft
    sale_month = Column(String, nullable=True)

    # Module 6: Storage & Logistics
    storage_duration_months = Column(Float, nullable=True)
    storage_source = Column(String, nullable=True)
    storage_loan_availed = Column(String, nullable=True)          # Yes/No
    storage_loan_amount_inr = Column(Float, nullable=True)
    storage_loan_interest_pct = Column(Float, nullable=True)
    storage_loan_repayment_months = Column(Integer, nullable=True)
    storage_warehouse_receipt = Column(String, nullable=True)     # Yes/No
    logistics_provider = Column(String, nullable=True)
    logistics_provider_other = Column(String, nullable=True)
    logistics_cost_inr_per_qtl = Column(Float, nullable=True)

    # Module 7: Cultivation Challenges
    cultivation_challenges = Column(String, nullable=True)  # comma-separated
    cultivation_challenges_other = Column(String, nullable=True)
    machinery_waiting_days = Column(Integer, nullable=True)  # if "Availability of Farm Machinery" selected

    # Module 8: Other Crops (Diversification)
    crop2_name = Column(String, nullable=True)
    crop2_area_acres = Column(Float, nullable=True)
    crop2_yield = Column(Float, nullable=True)
    crop2_rate = Column(Float, nullable=True)
    crop3_name = Column(String, nullable=True)
    crop3_area_acres = Column(Float, nullable=True)
    crop3_yield = Column(Float, nullable=True)
    crop3_rate = Column(Float, nullable=True)

    # Module 9: Farm Mechanisation
    mech_owned = Column(String, nullable=True)               # comma-separated
    mech_owned_other = Column(String, nullable=True)
    mech_rented = Column(String, nullable=True)               # comma-separated
    mech_rented_other = Column(String, nullable=True)
    mech_rental_rate_inr_hr = Column(String, nullable=True)   # JSON string {machine: rate}
    mech_financed = Column(String, nullable=True)             # Yes/No — if any machine owned
    mech_loan_amount_inr_lakh = Column(Float, nullable=True)
    mech_loan_interest_pct = Column(Float, nullable=True)

    # Household income & credit profile
    total_household_income_inr_lakh = Column(Float, nullable=True)  # legacy free-numeric entry, superseded by the bracket field below
    total_household_income_bracket = Column(String, nullable=True)  # "<10000" | "10000-1L" | "1L-10L" | ">10L"
    non_farm_income_source = Column(String, nullable=True)   # comma-separated
    non_farm_income_source_other = Column(String, nullable=True)
    bank_account = Column(String, nullable=True)              # Yes/No
    overdraft_facility = Column(String, nullable=True)        # Yes/No
    overdraft_limit_inr_lakh = Column(Float, nullable=True)

    # Module 10: Credit & Finance
    credit_linkage = Column(String, nullable=True)
    credit_source = Column(String, nullable=True)
    credit_source_other = Column(String, nullable=True)
    credit_amount_inr = Column(Float, nullable=True)
    credit_interest_rate_pct = Column(Float, nullable=True)
    credit_repayment_months = Column(Integer, nullable=True)
    credit_outstanding_inr_lakh = Column(Float, nullable=True)
    loan_application_outcome = Column(String, nullable=True)   # if credit_linkage == No
    loan_rejection_reason = Column(String, nullable=True)      # if loan_application_outcome == Rejected
    loan_rejection_reason_other = Column(String, nullable=True)
    credit_gap_inr_lakh = Column(Float, nullable=True)

    # Module 11: Government Schemes
    scheme_availed = Column(String, nullable=True)
    scheme_name = Column(String, nullable=True)
    scheme_benefits = Column(Text, nullable=True)

    # Module 12: Irrigation
    irrigation_source = Column(String, nullable=True)        # comma-separated
    irrigation_challenges = Column(String, nullable=True)

    # Module 13: Soil Health & Crop Insurance
    soil_test_done = Column(String, nullable=True)
    crop_insurance = Column(String, nullable=True)
    crop_insurance_detail = Column(String, nullable=True)
    natural_calamity_5yr = Column(String, nullable=True)     # Yes/No — flood/drought in region, last 5 years

    # Module 14: Input Supply Chain
    input_source = Column(String, nullable=True)
    input_source_other = Column(String, nullable=True)
    input_distance_km = Column(Float, nullable=True)
    input_challenges = Column(String, nullable=True)
    input_challenges_other = Column(String, nullable=True)
    input_purchase_delay_days = Column(Integer, nullable=True)  # if "Availability" challenge selected

    # Module 15: Technology Adoption
    tech_adoption = Column(String, nullable=True)
    tech_adoption_detail = Column(String, nullable=True)

    # KCC
    kcc_account = Column(String, nullable=True)               # Yes/No
    kcc_limit_inr_lakh = Column(Float, nullable=True)

    # Contact verification
    mobile_verified = Column(Boolean, nullable=True, default=False)

    # Module 16: Metadata & Geo-tagging
    entry_timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    geo_lat = Column(Float, nullable=True)
    geo_long = Column(Float, nullable=True)
    field_photo = Column(Text, nullable=True)  # base64 data URL of the compressed field photo
    enumerator_name = Column(String, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("auth_user.id"), nullable=True)
    client_uuid = Column(String, unique=True, nullable=True, index=True)  # dedupes offline-queued submissions

    # Plot Boundary Capture (v2): ordered polygon vertices as JSON text
    # [{"lat":..,"lng":..}, ...] — captured via draw-on-map, Excel upload, or
    # GPS walk. Kept as one JSON blob rather than a child table since it's
    # always read/written whole, never queried by vertex.
    # Legacy "primary plot" fields — kept for backward compatibility with
    # records created before CR-17 (multi-plot). Always mirrors plots[0] for
    # any survey saved through the multi-plot flow, so every existing consumer
    # of these four columns (Plots Map, dashboard filters, PlotSummaryOut)
    # keeps working unchanged.
    plot_boundary = Column(Text, nullable=True)
    plot_boundary_area_acres = Column(Float, nullable=True)
    plot_boundary_method = Column(String, nullable=True)  # "draw" | "excel" | "gps"
    plot_boundary_captured_at = Column(DateTime, nullable=True)

    plots = relationship("FarmerPlot", back_populates="survey", cascade="all, delete-orphan", order_by="FarmerPlot.sort_order")


class FarmerPlot(Base):
    """
    CR-17: a farmer may hold multiple plots/land parcels, possibly in
    different locations, each with its own farmer-reported area and its own
    optional GPS-measured boundary (captured via the same draw/Excel/GPS tabs
    as the legacy single-plot flow). reported_area_acres vs area_acres is the
    "reported vs GPS-measured" reconciliation CR-17 asks for; the aggregate
    total across a survey's plots is computed by the caller (frontend review
    screen avoids a wasted query — DataEntryWizard already loads the full
    list when editing, so it sums client-side instead of a dedicated endpoint).
    """
    __tablename__ = "farmer_plot"
    id = Column(Integer, primary_key=True)
    survey_id = Column(Integer, ForeignKey("farmer_survey.id"), nullable=False, index=True)
    sort_order = Column(Integer, nullable=False, default=0)
    label = Column(String, nullable=False, default="Plot 1")
    reported_area_acres = Column(Float, nullable=True)  # nullable for a draft plot still mid-entry
    boundary = Column(Text, nullable=True)       # JSON array of {lat, lng}, same shape as legacy plot_boundary
    area_acres = Column(Float, nullable=True)    # GPS-measured area for this plot, if a boundary was captured
    method = Column(String, nullable=True)        # "draw" | "excel" | "gps"
    captured_at = Column(DateTime, nullable=True)

    survey = relationship("FarmerSurvey", back_populates="plots")

    @property
    def points(self):
        """Exposes `boundary` (stored as a JSON string) as a parsed list, under
        the name FarmerPlotOut expects — pydantic's from_attributes reads
        whatever attribute matches the schema field name, and the DB column
        is named `boundary` (matching the legacy plot_boundary naming), not
        `points`, so without this property every API read would silently
        drop the captured boundary back to null."""
        import json
        return json.loads(self.boundary) if self.boundary else None


# ---------------- FPO CONSULTATION MODULE (72-question screening questionnaire) ----------------
# Draft-first: every field is nullable, so a field enumerator can save partial
# progress after any wizard step without hitting a NOT NULL constraint. `status`
# distinguishes an in-progress draft from a completed submission; "submitted" is
# advisory (set by the UI when the user finishes the last step), not enforced by
# any DB constraint, since the FRS explicitly asked for draft-safe step-wise saving
# rather than farmer-survey-style all-or-nothing validation.
class FPOConsultation(Base):
    __tablename__ = "fpo_consultation"
    id = Column(Integer, primary_key=True)
    status = Column(String, nullable=False, default="draft")  # "draft" | "submitted"
    created_by_user_id = Column(Integer, ForeignKey("auth_user.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    submitted_at = Column(DateTime, nullable=True)

    interview_date = Column(String, nullable=True)
    respondent_name = Column(String, nullable=True)
    respondent_designation = Column(String, nullable=True)
    respondent_mobile = Column(String, nullable=True)
    others_present = Column(String, nullable=True)
    interview_location = Column(String, nullable=True)
    geo_lat = Column(Float, nullable=True)
    geo_long = Column(Float, nullable=True)
    fpo_name = Column(String, nullable=True)
    cin = Column(String, nullable=True)
    incorporation_date = Column(String, nullable=True)
    fpo_age_years = Column(Float, nullable=True)
    legal_form = Column(String, nullable=True)
    district = Column(String, nullable=True)
    taluk = Column(String, nullable=True)
    villages_covered = Column(Integer, nullable=True)
    implementing_agency = Column(String, nullable=True)
    cbbo_name = Column(String, nullable=True)
    promoting_agency = Column(String, nullable=True)
    promoting_agency_other = Column(String, nullable=True)
    primary_crop = Column(String, nullable=True)
    secondary_crop = Column(String, nullable=True)
    women_members = Column(Integer, nullable=True)
    women_on_board = Column(Integer, nullable=True)
    turnover_fy24 = Column(Float, nullable=True)
    turnover_fy25 = Column(Float, nullable=True)
    turnover_fy26 = Column(Float, nullable=True)
    profit_fy24 = Column(Float, nullable=True)
    profit_fy25 = Column(Float, nullable=True)
    profit_fy26 = Column(Float, nullable=True)
    q1_board_size = Column(String, nullable=True)
    q1_board_women_count = Column(Integer, nullable=True)
    q2_board_experience = Column(String, nullable=True)
    q2_board_members_running_business = Column(Integer, nullable=True)
    q2_business_nature = Column(String, nullable=True)
    q2_business_nature_other = Column(String, nullable=True)
    q3_minutes_records = Column(String, nullable=True)
    q3_meetings_per_year = Column(Integer, nullable=True)
    q3_meeting_frequency = Column(String, nullable=True)
    last_agm_date = Column(String, nullable=True)
    shareholder_attendance_pct = Column(Float, nullable=True)
    q4_has_ceo = Column(String, nullable=True)
    q4a_ceo_experience = Column(String, nullable=True)
    q4b_ceo_years = Column(Float, nullable=True)
    q4b_ceo_engagement = Column(String, nullable=True)
    q4c_ceo_trade_or_admin = Column(String, nullable=True)
    q5_has_accountant = Column(String, nullable=True)
    q5a_accountant_experience = Column(String, nullable=True)
    q5b_accountant_years = Column(Float, nullable=True)
    q5b_accountant_engagement = Column(String, nullable=True)
    q5c_software_used = Column(String, nullable=True)
    q5c_software_other = Column(String, nullable=True)
    q6_second_line_mgmt = Column(String, nullable=True)
    q6_total_staff = Column(Integer, nullable=True)
    q6_field_staff = Column(Integer, nullable=True)
    q7_registered_members = Column(String, nullable=True)
    q7_actively_transacting = Column(String, nullable=True)
    q8_promoting_agency_role = Column(String, nullable=True)
    bds_providers = Column(Text, nullable=True)
    q10_govt_scheme_converged = Column(String, nullable=True)
    govt_schemes = Column(Text, nullable=True)
    licences = Column(Text, nullable=True)
    q11_deals_in = Column(String, nullable=True)
    q12_price_risk = Column(String, nullable=True)
    q13_external_lending = Column(String, nullable=True)
    q14_trading_platforms = Column(String, nullable=True)
    q15_accounts_mis = Column(String, nullable=True)
    q16_stock_insured = Column(String, nullable=True)
    q17_credit_repayment_history = Column(String, nullable=True)
    q18_books_update_freq = Column(String, nullable=True)
    q19_stock_reconciliation_freq = Column(String, nullable=True)
    q20_cash_revenue_share = Column(String, nullable=True)
    q21_traceability_records = Column(String, nullable=True)
    q22_total_annual_revenue = Column(String, nullable=True)
    q23_gross_profit_margin = Column(String, nullable=True)
    q24_profitability_trend = Column(String, nullable=True)
    q25_paid_up_capital = Column(Float, nullable=True)
    q26_revenue_share_arecanut_pct = Column(Float, nullable=True)
    q27_audited_statements = Column(String, nullable=True)
    q27_documents_available = Column(String, nullable=True)
    q27_documents_other = Column(String, nullable=True)
    q28_avg_procurement_value_per_cycle = Column(Float, nullable=True)
    q29_procurement_cycles_per_season = Column(Integer, nullable=True)
    q30_peak_procurement_value = Column(Float, nullable=True)
    q31_max_value_awaiting_settlement = Column(Float, nullable=True)
    q32_settlement_days = Column(Float, nullable=True)
    q33_active_farmers_band = Column(String, nullable=True)
    q33_actual_farmers = Column(Integer, nullable=True)
    q33_women_farmers = Column(Integer, nullable=True)
    q34_aggregate_last_fy_band = Column(String, nullable=True)
    q34_actual_mt = Column(Float, nullable=True)
    q34_value_inr_lakh = Column(Float, nullable=True)
    volume_split_form = Column(Text, nullable=True)
    volume_split_grade = Column(Text, nullable=True)
    produce_channels = Column(Text, nullable=True)
    q36a_why_channels = Column(String, nullable=True)
    q37_additional_supply_band = Column(String, nullable=True)
    q37_actual_mt_per_year = Column(Float, nullable=True)
    q37a_volume_source = Column(String, nullable=True)
    q38_supply_stability = Column(String, nullable=True)
    q38_peak_months = Column(String, nullable=True)
    q38_lean_months = Column(String, nullable=True)
    q39_biggest_constraint = Column(String, nullable=True)
    q39_notes = Column(String, nullable=True)
    q40_quality_check_method = Column(String, nullable=True)
    q40_moisture_meter_available = Column(String, nullable=True)
    q40_moisture_meter_units = Column(Integer, nullable=True)
    q40_moisture_meter_last_calibrated = Column(String, nullable=True)
    q41_rejection_rate_band = Column(String, nullable=True)
    q41_actual_pct = Column(Float, nullable=True)
    q41a_reason1 = Column(String, nullable=True)
    q41a_reason2 = Column(String, nullable=True)
    quality_practices = Column(Text, nullable=True)
    q42a_uncoloured_lots = Column(String, nullable=True)
    q43_meet_spec = Column(String, nullable=True)
    q43_what_required = Column(String, nullable=True)
    q44_infrastructure = Column(String, nullable=True)
    q44_collection_centres_count = Column(Integer, nullable=True)
    q44_additional_infra_needed = Column(String, nullable=True)
    common_facilities = Column(Text, nullable=True)
    q46_chc_machines_rates = Column(String, nullable=True)
    storage_logistics = Column(Text, nullable=True)
    q48_delivery_reliability = Column(String, nullable=True)
    q48_evidence_sighted = Column(String, nullable=True)
    q49_price_determination = Column(String, nullable=True)
    q49_price_revision_frequency = Column(String, nullable=True)
    q49_reference_mandi = Column(String, nullable=True)
    unit_economics = Column(Text, nullable=True)
    q51_payment_speed = Column(String, nullable=True)
    q51_payment_mode = Column(String, nullable=True)
    q51_share_paid_digitally_pct = Column(Float, nullable=True)
    q51_paid_upfront_pct = Column(Float, nullable=True)
    q52_upfront_funds_source = Column(String, nullable=True)
    q53_biggest_financial_constraint = Column(String, nullable=True)
    q54_estimated_loss_value = Column(Float, nullable=True)
    q54_estimated_loss_mt = Column(Float, nullable=True)
    credit_facilities = Column(Text, nullable=True)
    credit_history = Column(Text, nullable=True)
    q55b_warehouse_receipt_used = Column(String, nullable=True)
    q55c_loan_rejected = Column(String, nullable=True)
    q55c_rejection_count = Column(Integer, nullable=True)
    q55c_rejection_lender = Column(String, nullable=True)
    q55c_rejection_year = Column(String, nullable=True)
    q55c_rejection_reason = Column(String, nullable=True)
    q55c_rejection_reason_other = Column(String, nullable=True)
    credit_gap = Column(Text, nullable=True)
    q56_lender_limit_indicated = Column(String, nullable=True)
    q56_reason = Column(String, nullable=True)
    q56_reason_other = Column(String, nullable=True)
    q57_working_capital_needed = Column(Float, nullable=True)
    q57_proposed_source = Column(String, nullable=True)
    q58_buy_or_commission = Column(String, nullable=True)
    q58_handling_fee = Column(Float, nullable=True)
    q59_collateral_type = Column(String, nullable=True)
    q59_collateral_other = Column(String, nullable=True)
    q60_pledged_produce_share_pct = Column(Float, nullable=True)
    q61_collateral_effort = Column(String, nullable=True)
    q62_max_interest_rate = Column(Float, nullable=True)
    q63_loan_tenure = Column(String, nullable=True)
    q64_trader_preference_reasons = Column(String, nullable=True)
    q64_reasons_other = Column(String, nullable=True)
    q65_what_would_shift_farmers = Column(String, nullable=True)
    services_to_members = Column(Text, nullable=True)
    q67_intercrops = Column(String, nullable=True)
    q67_intercrops_other = Column(String, nullable=True)
    q67_fpo_support = Column(String, nullable=True)
    q67_intercropping_share_pct = Column(Float, nullable=True)
    q68_farmer_challenges = Column(String, nullable=True)
    q68_challenges_other = Column(String, nullable=True)
    buyers = Column(Text, nullable=True)
    q69_committed_volume_mt = Column(Float, nullable=True)
    q69_uncommitted_volume_mt = Column(Float, nullable=True)
    q70_buyer_requirements = Column(String, nullable=True)
    q70_top_three = Column(String, nullable=True)
    q71_trial_consignment = Column(String, nullable=True)
    q71_trial_volume_mt = Column(Float, nullable=True)
    q71_earliest_month = Column(String, nullable=True)
    q72_board_resolution = Column(String, nullable=True)
    signature = Column(String, nullable=True)
    signature_date = Column(String, nullable=True)

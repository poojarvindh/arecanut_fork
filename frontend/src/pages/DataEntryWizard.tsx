import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Search, CheckCircle2, MapPin, Camera, Check,
  UserSearch, Handshake, LandPlot, Wheat, Coins, Warehouse,
  TriangleAlert, Sprout, Wrench, CreditCard, Landmark, Droplets, FlaskConical,
  Truck, Smartphone, ScanLine, AlertCircle, UploadCloud, Navigation, Save,
} from "lucide-react";
import { Geolocation } from "@capacitor/geolocation";
import { Camera as CapacitorCamera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";
import { api } from "../api";
import { trDistrict, trTaluka, trVillage, tr, t } from "../i18n";
import { useLang } from "../LangContext";
import { queueSurvey } from "../offlineQueue";
import DrawMapTab from "../components/plot/DrawMapTab";
import ExcelUploadTab from "../components/plot/ExcelUploadTab";
import GpsCaptureTab from "../components/plot/GpsCaptureTab";
import { areaInAcres, formatArea, validateBoundary, type CaptureMethod, type PlotBoundary } from "../lib/plotBoundary";

const PLOT_METHODS: { key: CaptureMethod; label: string; icon: any }[] = [
  { key: "draw", label: "Draw on Map", icon: MapPin },
  { key: "excel", label: "Upload Excel", icon: UploadCloud },
  { key: "gps", label: "GPS Walk", icon: Navigation },
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const GRADE_VARIETIES = ["Rashi", "Api", "Bette", "Saraku", "Other"]; // CR-05
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 1950 + 1 }, (_, i) => CURRENT_YEAR - i);

// 17 data-collection modules regrouped into 8 broader tabs so the wizard has
// fewer top-level steps to page through. Every field/module below keeps its
// original name and count — only the tab grouping changed.
const STEPS = [
  { label: "Farmer & Location", hint: "Farmer identity, society link & location", icon: UserSearch },
  { label: "Land & Production", hint: "Land holding, cultivation cost & yield", icon: LandPlot },
  { label: "Sales & Logistics", hint: "Sale, income, storage & transport", icon: Coins },
  { label: "Diversification & Challenges", hint: "Other crops & cultivation challenges", icon: Sprout },
  { label: "Mechanisation & Inputs", hint: "Equipment, input sourcing & technology", icon: Wrench },
  { label: "Finance & Schemes", hint: "Credit access & government schemes", icon: CreditCard },
  { label: "Irrigation & Sustainability", hint: "Water source, soil health & insurance", icon: Droplets },
  { label: "Geo-tag & Review", hint: "GPS, photo & final check", icon: ScanLine },
];

const empty: any = {
  farmer_id: "", farmer_name: "", mobile_no: "", mobile_verified: false, gender: "Male", age: "", guardian_name: "",
  survey_year: String(CURRENT_YEAR), // CR-18
  society_assoc: "No", society_name: "", society_since_year: "", society_benefits: [],
  village: "", taluka: "", district: "",
  land_own_acres: "", land_leased_acres: "", areca_area_acres: "", areca_plant_count: "",
  organic_farming: "No", organic_certified: "No", organic_cert_applied: "No", organic_cert_aware: "No",
  intercropping: "No", intercrop_crops: [], intercrop_crops_other: "", intercrop_area_acres: "",
  cultivation_cost_inr: "", yield_raw_qtl: "", yield_processed_qtl: "",
  sale_type: "Sold raw areca", processing_cost_inr: "", marketing_channel: "FPC/FPO", marketing_channel_detail: "",
  grading_done: "No", grading_rows: [], // CR-05/CR-07
  rate_inr_per_kg: "", sale_month: "Jan",
  storage_duration_months: "", storage_source: "",
  storage_loan_availed: "No", storage_loan_amount_inr: "", storage_loan_interest_pct: "", storage_loan_repayment_months: "", storage_warehouse_receipt: "No",
  logistics_provider: "", logistics_provider_other: "", logistics_cost_inr_per_qtl: "",
  cultivation_challenges: [], cultivation_challenges_other: "", machinery_waiting_days: "",
  crop2_name: "", crop2_area_acres: "", crop2_yield: "", crop2_rate: "",
  crop3_name: "", crop3_area_acres: "", crop3_yield: "", crop3_rate: "",
  mech_owned: [], mech_owned_other: "", mech_rented: [], mech_rented_other: "", mech_rental_rate: {},
  mech_financed: "No", mech_loan_amount_inr_lakh: "", mech_loan_interest_pct: "",
  total_household_income_bracket: "", non_farm_income_source: [], non_farm_income_source_other: "",
  bank_account: "No", overdraft_facility: "No", overdraft_limit_inr_lakh: "",
  credit_linkage: "No", credit_source: "", credit_source_other: "", credit_amount_inr: "", credit_interest_rate_pct: "", credit_repayment_months: "",
  credit_outstanding_inr_lakh: "", loan_application_outcome: "", loan_rejection_reason: "", loan_rejection_reason_other: "", credit_gap_inr_lakh: "",
  scheme_availed: "No", scheme_name: [], scheme_benefits: "",
  irrigation_source: [], irrigation_challenges: "",
  soil_test_done: "No", crop_insurance: "No", crop_insurance_detail: "", natural_calamity_5yr: "No",
  input_source: ["Cooperative Society"], input_source_other: "", input_distance_km: "", input_challenges: [], input_challenges_other: "", input_purchase_delay_days: "",
  tech_adoption: "No", tech_adoption_detail: "",
  kcc_account: "No", kcc_limit_inr_lakh: "",
  geo_lat: "", geo_long: "", field_photo: "",
};

// Maps every validated field to the tab it lives on, so a submit-time error can
// jump the user straight to the right tab instead of just complaining.
const FIELD_STEP: Record<string, number> = {
  farmer_name: 0, mobile_no: 0, gender: 0, age: 0, farmer_id: 0,
  society_name: 0, society_since_year: 0, society_benefits_other: 0, village: 0, taluka: 0, district: 0,
  land_own_acres: 1, land_leased_acres: 1, areca_area_acres: 1, areca_plant_count: 1, cultivation_cost_inr: 1, yield_raw_qtl: 1,
  yield_processed_qtl: 1, intercrop_crops: 1, intercrop_crops_other: 1, intercrop_area_acres: 1,
  organic_certified: 1, organic_cert_applied: 1, organic_cert_aware: 1,
  processing_cost_inr: 2, rate_inr_per_kg: 2, marketing_channel_detail: 2,
  storage_loan_amount_inr: 2, storage_loan_interest_pct: 2, storage_loan_repayment_months: 2, logistics_provider_other: 2,
  crop2_area_acres: 3, crop2_yield: 3, crop2_rate: 3, crop3_area_acres: 3, crop3_yield: 3, crop3_rate: 3,
  machinery_waiting_days: 3, cultivation_challenges_other: 3,
  mech_rental_rate: 4, tech_adoption_detail: 4, mech_loan_amount_inr_lakh: 4, mech_loan_interest_pct: 4,
  mech_owned_other: 4, mech_rented_other: 4, input_source_other: 4,
  input_purchase_delay_days: 4,
  credit_source: 5, credit_source_other: 5, credit_amount_inr: 5, credit_interest_rate_pct: 5, credit_repayment_months: 5,
  scheme_name: 5, scheme_benefits: 5, loan_application_outcome: 5, loan_rejection_reason: 5, loan_rejection_reason_other: 5,
  overdraft_limit_inr_lakh: 5, kcc_limit_inr_lakh: 5, total_household_income_bracket: 5, non_farm_income_source_other: 5,
  irrigation_source: 6, crop_insurance_detail: 6,
};

function isBlank(v: any) {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
}

function hasMoreThanTwoDecimals(v: any) {
  const n = Number(v);
  return !isNaN(n) && Math.round(n * 100) !== n * 100;
}

// Generalized version of the above — CR-10 needed a 1-decimal-place limit
// (Distance of Input Source) alongside the existing 2-decimal-place fields,
// so this replaces hardcoding 100 everywhere a new precision is needed.
function hasMoreThanNDecimals(v: any, n: number) {
  const num = Number(v);
  const factor = Math.pow(10, n);
  return !isNaN(num) && Math.round(num * factor) !== num * factor;
}

function isWholeNumber(v: any) {
  const n = Number(v);
  return !isNaN(n) && Number.isInteger(n);
}

/** Full-form validation used both per-tab (on Next) and in full (on Submit).
 * Returns a flat map of field -> user-facing error message. */
function getErrors(form: any): Record<string, string> {
  const e: Record<string, string> = {};

  // --- Farmer & Location ---
  if (isBlank(form.farmer_name)) e.farmer_name = "Farmer name is required.";
  if (isBlank(form.mobile_no)) e.mobile_no = "Mobile number is required.";
  else if (!/^\d{10}$/.test(String(form.mobile_no).trim())) e.mobile_no = "Enter a valid 10-digit mobile number.";
  if (isBlank(form.age)) e.age = "Age is required.";
  else if (Number(form.age) < 18 || Number(form.age) > 80) e.age = "Age must be between 18 and 80.";
  // farmer_id is no longer required at entry time — it's auto-generated by the
  // server once the whole survey validates and is submitted (see submit()).
  if (form.society_assoc === "Yes") {
    if (isBlank(form.society_name)) e.society_name = "Society / FPC name is required.";
    if (isBlank(form.society_since_year)) e.society_since_year = "Membership year is required.";
    else if (Number(form.society_since_year) > new Date().getFullYear()) e.society_since_year = "Year cannot be in the future.";
  }
  if (isBlank(form.village)) e.village = "Village is required.";
  if (isBlank(form.taluka)) e.taluka = "Taluka could not be determined — reselect the village.";
  if (isBlank(form.district)) e.district = "District could not be determined — reselect the village.";

  // --- Land & Production ---
  if (isBlank(form.land_own_acres)) e.land_own_acres = "Own land holding is required.";
  else if (Number(form.land_own_acres) <= 0) e.land_own_acres = "Must be greater than 0.";
  else if (hasMoreThanTwoDecimals(form.land_own_acres)) e.land_own_acres = "Maximum 2 decimal places.";
  if (!isBlank(form.land_leased_acres) && hasMoreThanTwoDecimals(form.land_leased_acres)) e.land_leased_acres = "Maximum 2 decimal places.";
  if (isBlank(form.areca_area_acres)) e.areca_area_acres = "Areca cultivation area is required.";
  else if (Number(form.areca_area_acres) <= 0) e.areca_area_acres = "Must be greater than 0.";
  else if (Number(form.areca_area_acres) > (Number(form.land_own_acres) || 0) + (Number(form.land_leased_acres) || 0)) {
    e.areca_area_acres = "Cannot exceed total own + leased land.";
  }
  if (isBlank(form.areca_plant_count)) e.areca_plant_count = "Total plant count is required.";
  else if (Number(form.areca_plant_count) <= 0 || !isWholeNumber(form.areca_plant_count)) e.areca_plant_count = "Must be a whole number greater than 0.";
  if (isBlank(form.cultivation_cost_inr)) e.cultivation_cost_inr = "Cultivation cost is required.";
  else if (Number(form.cultivation_cost_inr) <= 0 || !isWholeNumber(form.cultivation_cost_inr)) e.cultivation_cost_inr = "Must be a whole number greater than 0 (no decimals).";
  if (form.organic_farming === "Yes" && isBlank(form.organic_certified)) e.organic_certified = "Please answer whether the farmer holds a certificate.";
  if (form.organic_farming === "Yes" && form.organic_certified === "No" && isBlank(form.organic_cert_applied)) e.organic_cert_applied = "Please answer whether certification has been applied for.";
  if (form.organic_farming === "Yes" && form.organic_certified === "No" && form.organic_cert_applied === "No" && isBlank(form.organic_cert_aware)) e.organic_cert_aware = "Please answer whether the farmer is aware of the certification process.";
  if (form.intercropping === "Yes") {
    if (isBlank(form.intercrop_crops)) e.intercrop_crops = "Select at least one intercrop.";
    if (form.intercrop_crops?.includes("Any Other") && isBlank(form.intercrop_crops_other)) e.intercrop_crops_other = "Please specify the intercrop.";
    if (isBlank(form.intercrop_area_acres)) e.intercrop_area_acres = "Area under intercropping is required.";
  }

  // --- Sales & Logistics ---
  if (form.sale_type === "Sold raw areca" || form.sale_type === "Sold both raw and processed areca") {
    if (isBlank(form.yield_raw_qtl)) e.yield_raw_qtl = "Yield is required.";
    else if (Number(form.yield_raw_qtl) <= 0) e.yield_raw_qtl = "Must be a positive value.";
    else if (hasMoreThanTwoDecimals(form.yield_raw_qtl)) e.yield_raw_qtl = "Maximum 2 decimal places.";
  }
  const includesProcessedSale = form.sale_type === "Sold processed areca" || form.sale_type === "Sold both raw and processed areca";
  const isGrading = includesProcessedSale && form.grading_done === "Yes"; // CR-05/CR-07
  if (includesProcessedSale) {
    if (isBlank(form.processing_cost_inr)) e.processing_cost_inr = "Processing cost is required for a processed sale.";
    else if (hasMoreThanTwoDecimals(form.processing_cost_inr)) e.processing_cost_inr = "Maximum 2 decimal places."; // CR-06
    if (isBlank(form.yield_processed_qtl)) e.yield_processed_qtl = "Yield of processed nuts is required for a processed sale.";
    else if (Number(form.yield_processed_qtl) <= 0) e.yield_processed_qtl = "Must be a positive value.";
    else if (hasMoreThanTwoDecimals(form.yield_processed_qtl)) e.yield_processed_qtl = "Maximum 2 decimal places.";
  }
  if (isGrading) {
    if (!form.grading_rows || form.grading_rows.length === 0) {
      e.grading_rows = "Add at least one grade/variety row.";
    } else {
      for (const row of form.grading_rows) {
        if (row.variety === "Other" && isBlank(row.variety_other)) { e.grading_rows = "Specify the variety for every 'Other' row."; break; }
        if (isBlank(row.quantity_qtl) || Number(row.quantity_qtl) <= 0) { e.grading_rows = "Every row needs a quantity greater than 0."; break; }
        if (isBlank(row.rate_inr_per_kg) || Number(row.rate_inr_per_kg) <= 0) { e.grading_rows = "Every row needs a rate greater than 0."; break; }
      }
    }
  }
  // CR-08: storage duration is whole months, no fractional months.
  if (!isBlank(form.storage_duration_months) && !isWholeNumber(form.storage_duration_months)) {
    e.storage_duration_months = "Whole numbers only — no decimals.";
  }
  // CR-09: per-provider logistics cost to 2 decimal places.
  if (!isBlank(form.logistics_cost_inr_per_qtl) && hasMoreThanTwoDecimals(form.logistics_cost_inr_per_qtl)) {
    e.logistics_cost_inr_per_qtl = "Maximum 2 decimal places.";
  }
  if (form.input_challenges?.includes("Other") && isBlank(form.input_challenges_other)) {
    e.input_challenges_other = "Please specify the challenge.";
  }
  if (form.input_source?.includes("Other") && isBlank(form.input_source_other)) {
    e.input_source_other = "Please specify the input source.";
  }
  if (isBlank(form.input_source)) e.input_source = "Select at least one input source."; // CR-14
  if (!isGrading) { // CR-07: a graded sale uses per-row rates instead of one blanket rate
    if (isBlank(form.rate_inr_per_kg)) e.rate_inr_per_kg = "Rate realised is required.";
    else if (Number(form.rate_inr_per_kg) <= 0) e.rate_inr_per_kg = "Must be greater than 0.";
  }
  // Name of FPC/FPO is optional (not every enumerator will know the exact FPC at
  // time of entry) — Cooperative Society / APMC / Any Other are still required.
  if (["Cooperative Society", "APMC", "Any Other"].includes(form.marketing_channel) && isBlank(form.marketing_channel_detail)) {
    e.marketing_channel_detail = form.marketing_channel === "Any Other" ? "Please specify the marketing channel." : `Name of the ${form.marketing_channel} is required.`;
  }
  if (form.storage_source && form.storage_loan_availed === "Yes") {
    if (isBlank(form.storage_loan_amount_inr)) e.storage_loan_amount_inr = "Loan/pledge amount is required.";
    if (isBlank(form.storage_loan_interest_pct)) e.storage_loan_interest_pct = "Interest rate is required.";
    if (isBlank(form.storage_loan_repayment_months)) e.storage_loan_repayment_months = "Repayment period is required.";
  }
  if (form.logistics_provider === "Any Other" && isBlank(form.logistics_provider_other)) {
    e.logistics_provider_other = "Please specify the logistics provider.";
  }

  // --- Diversification & Challenges ---
  [2, 3].forEach((n) => {
    if (!isBlank(form[`crop${n}_name`])) {
      if (isBlank(form[`crop${n}_area_acres`])) e[`crop${n}_area_acres`] = "Area is required once a crop name is entered.";
      if (isBlank(form[`crop${n}_yield`])) e[`crop${n}_yield`] = "Total yield is required once a crop name is entered.";
      if (isBlank(form[`crop${n}_rate`])) e[`crop${n}_rate`] = "Rate is required once a crop name is entered.";
    }
  });
  if (form.cultivation_challenges?.includes("Availability of Farm Machinery") && isBlank(form.machinery_waiting_days)) {
    e.machinery_waiting_days = "Average waiting period is required.";
  }
  if (form.cultivation_challenges?.includes("Other") && isBlank(form.cultivation_challenges_other)) {
    e.cultivation_challenges_other = "Please specify the challenge.";
  }

  // --- Mechanisation & Inputs ---
  if (form.mech_rented?.length) {
    const missingRate = form.mech_rented.some((mc: string) => isBlank(form.mech_rental_rate?.[mc]));
    if (missingRate) e.mech_rental_rate = "Enter an hourly rate for every rented machine.";
  }
  if (form.mech_owned?.includes("Any Other") && isBlank(form.mech_owned_other)) e.mech_owned_other = "Please specify the machine.";
  if (form.mech_rented?.includes("Any Other") && isBlank(form.mech_rented_other)) e.mech_rented_other = "Please specify the machine.";
  if (form.mech_owned?.length > 0 && form.mech_financed === "Yes") {
    if (isBlank(form.mech_loan_amount_inr_lakh)) e.mech_loan_amount_inr_lakh = "Loan amount is required.";
    if (isBlank(form.mech_loan_interest_pct)) e.mech_loan_interest_pct = "Interest rate is required.";
  }
  if (form.input_challenges?.includes("Availability") && isBlank(form.input_purchase_delay_days)) {
    e.input_purchase_delay_days = "Average delay in receiving inputs is required.";
  } else if (!isBlank(form.input_purchase_delay_days) && !isWholeNumber(form.input_purchase_delay_days)) {
    e.input_purchase_delay_days = "Whole numbers only — no decimals."; // CR-12
  }
  // CR-10: distance of input source to 1 decimal place.
  if (!isBlank(form.input_distance_km) && hasMoreThanNDecimals(form.input_distance_km, 1)) {
    e.input_distance_km = "Maximum 1 decimal place.";
  }
  if (form.tech_adoption === "Yes") {
    if (isBlank(form.tech_adoption_detail)) e.tech_adoption_detail = "Please describe the technology used.";
    else if (!/[a-zA-Z]{2,}/.test(form.tech_adoption_detail)) e.tech_adoption_detail = "Please enter a real description, not just numbers or symbols.";
  }

  // --- Finance & Schemes ---
  if (form.credit_linkage === "Yes") {
    if (isBlank(form.credit_source)) e.credit_source = "Credit source is required.";
    if (form.credit_source === "Other" && isBlank(form.credit_source_other)) e.credit_source_other = "Please specify the credit source.";
    if (isBlank(form.credit_amount_inr)) e.credit_amount_inr = "Loan amount is required.";
    else if (hasMoreThanTwoDecimals(form.credit_amount_inr)) e.credit_amount_inr = "Maximum 2 decimal places."; // CR-01
    if (isBlank(form.credit_interest_rate_pct)) e.credit_interest_rate_pct = "Interest rate is required.";
    else if (Number(form.credit_interest_rate_pct) < 0 || Number(form.credit_interest_rate_pct) > 50) e.credit_interest_rate_pct = "Enter a value between 0 and 50.";
    else if (hasMoreThanTwoDecimals(form.credit_interest_rate_pct)) e.credit_interest_rate_pct = "Maximum 2 decimal places."; // CR-01
    if (isBlank(form.credit_repayment_months)) e.credit_repayment_months = "Repayment period is required.";
    else if (!isWholeNumber(form.credit_repayment_months)) e.credit_repayment_months = "Whole numbers only — no decimals."; // CR-11
  } else if (form.credit_linkage === "No") {
    if (isBlank(form.loan_application_outcome)) e.loan_application_outcome = "Please select the outcome of any previous loan application.";
    if (form.loan_application_outcome === "Rejected" && isBlank(form.loan_rejection_reason)) e.loan_rejection_reason = "Please select a reason for rejection.";
    if (form.loan_application_outcome === "Rejected" && form.loan_rejection_reason === "Other" && isBlank(form.loan_rejection_reason_other)) {
      e.loan_rejection_reason_other = "Please specify the reason.";
    }
  }
  if (form.bank_account === "Yes" && form.overdraft_facility === "Yes" && isBlank(form.overdraft_limit_inr_lakh)) e.overdraft_limit_inr_lakh = "Overdraft limit is required.";
  else if (!isBlank(form.overdraft_limit_inr_lakh) && hasMoreThanTwoDecimals(form.overdraft_limit_inr_lakh)) e.overdraft_limit_inr_lakh = "Maximum 2 decimal places."; // CR-16
  if (isBlank(form.total_household_income_bracket)) e.total_household_income_bracket = "Please select a household income bracket.";
  if (form.non_farm_income_source?.includes("Other") && isBlank(form.non_farm_income_source_other)) {
    e.non_farm_income_source_other = "Please specify the income source.";
  }
  if (form.kcc_account === "Yes" && isBlank(form.kcc_limit_inr_lakh)) e.kcc_limit_inr_lakh = "KCC limit is required.";
  else if (!isBlank(form.kcc_limit_inr_lakh) && hasMoreThanTwoDecimals(form.kcc_limit_inr_lakh)) e.kcc_limit_inr_lakh = "Maximum 2 decimal places."; // CR-01
  // CR-01: Current Outstanding Loan Amount and Credit Gap are always-optional
  // fields (no "required" state to chain onto), so these checks stand alone.
  if (!isBlank(form.credit_outstanding_inr_lakh) && hasMoreThanTwoDecimals(form.credit_outstanding_inr_lakh)) {
    e.credit_outstanding_inr_lakh = "Maximum 2 decimal places.";
  }
  if (!isBlank(form.credit_gap_inr_lakh) && hasMoreThanTwoDecimals(form.credit_gap_inr_lakh)) {
    e.credit_gap_inr_lakh = "Maximum 2 decimal places.";
  }
  if (form.scheme_availed === "Yes") {
    if (isBlank(form.scheme_name)) e.scheme_name = "Scheme name is required.";
    if (isBlank(form.scheme_benefits)) e.scheme_benefits = "Describe the benefits received.";
  }

  // --- Irrigation & Sustainability ---
  if (isBlank(form.irrigation_source)) e.irrigation_source = "Select at least one irrigation source.";
  if (form.crop_insurance === "Yes" && isBlank(form.crop_insurance_detail)) {
    e.crop_insurance_detail = "Insurance detail is required.";
  }

  // Catch-all: no numeric field anywhere in the survey may be negative. Specific
  // checks above already give more precise messages for the fields they cover
  // (e.g. "must be greater than 0"); this only fills the gap for every optional
  // numeric field that had no dedicated check, so nothing negative slips through.
  NONNEGATIVE_NUMERIC_FIELDS.forEach((f) => {
    if (!e[f] && !isBlank(form[f]) && Number(form[f]) < 0) e[f] = "Cannot be negative.";
  });

  // Interest rates: capped at 50% per annum per client-specified upper bound.
  ["storage_loan_interest_pct", "mech_loan_interest_pct", "credit_interest_rate_pct"].forEach((f) => {
    if (!e[f] && !isBlank(form[f]) && Number(form[f]) > 50) e[f] = "Cannot exceed 50% per annum.";
  });
  // Absolute INR amounts: capped at ₹10 crore per client-specified upper bound.
  ["cultivation_cost_inr", "processing_cost_inr", "storage_loan_amount_inr", "credit_amount_inr"].forEach((f) => {
    if (!e[f] && !isBlank(form[f]) && Number(form[f]) > 100000000) e[f] = "Cannot exceed ₹10 crore.";
  });
  // INR-Lakh amounts: same ₹10 crore cap, expressed in lakh (1000 lakh = ₹10 crore).
  ["mech_loan_amount_inr_lakh", "credit_outstanding_inr_lakh", "credit_gap_inr_lakh", "kcc_limit_inr_lakh", "overdraft_limit_inr_lakh"].forEach((f) => {
    if (!e[f] && !isBlank(form[f]) && Number(form[f]) > 1000) e[f] = "Cannot exceed ₹10 crore (1000 lakh).";
  });

  return e;
}

const NONNEGATIVE_NUMERIC_FIELDS = [
  "age", "society_since_year", "land_own_acres", "land_leased_acres", "areca_area_acres",
  "areca_plant_count", "intercrop_area_acres", "cultivation_cost_inr", "yield_raw_qtl",
  "yield_processed_qtl", "processing_cost_inr", "rate_inr_per_kg", "storage_duration_months",
  "storage_loan_amount_inr", "storage_loan_interest_pct", "storage_loan_repayment_months",
  "logistics_cost_inr_per_qtl", "machinery_waiting_days", "crop2_area_acres", "crop2_yield",
  "crop2_rate", "crop3_area_acres", "crop3_yield", "crop3_rate", "mech_loan_amount_inr_lakh",
  "mech_loan_interest_pct", "overdraft_limit_inr_lakh",
  "credit_amount_inr", "credit_interest_rate_pct", "credit_repayment_months",
  "credit_outstanding_inr_lakh", "credit_gap_inr_lakh", "kcc_limit_inr_lakh", "input_distance_km",
  "input_purchase_delay_days",
];

// `hint` explains WHY a field is (or isn't) required when that depends on
// another field's value — e.g. "Required only if Bank Account = Yes" — so the
// requirement doesn't look arbitrary or feel broken when it appears/disappears
// as the user changes an earlier answer.
// Translation happens inside these four shared components rather than at each of
// the ~230 call sites: every label, hint, validation message, section title and
// option value in the wizard flows through one of them, so wrapping them here
// translates the whole form. Option VALUES stay English everywhere (only the
// displayed text is translated) because English is the canonical form stored in
// the DB and sent to the API.
function Field({ label, required, hint, error, children }: any) {
  const { lang } = useLang();
  return (
    <div className="mb-4">
      <label className="gt-label">{typeof label === "string" ? t(label, lang) : label} {required && <span className="text-[var(--gt-danger)]">*</span>}</label>
      {hint && !error && <div className="text-[11px] text-[var(--gt-text-muted)] mb-1">{t(hint, lang)}</div>}
      <div className={error ? "field-error" : ""}>{children}</div>
      {error && (
        <div className="flex items-center gap-1 text-xs text-[var(--gt-danger)] mt-1">
          <AlertCircle size={12} /> {t(error, lang)}
        </div>
      )}
    </div>
  );
}

function YesNo({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { lang } = useLang();
  return (
    <div className="gt-toggle-yn">
      <button type="button" className={value === "Yes" ? "active-yes" : ""} onClick={() => onChange("Yes")}>{t("Yes", lang)}</button>
      <button type="button" className={value === "No" ? "active-no" : ""} onClick={() => onChange("No")}>{t("No", lang)}</button>
    </div>
  );
}

function MultiChip({ options, value, onToggle }: { options: string[]; value: string[]; onToggle: (v: string) => void }) {
  const { lang } = useLang();
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <div key={opt} className={`gt-chip ${value.includes(opt) ? "active" : ""}`} onClick={() => onToggle(opt)}>
          {value.includes(opt) && <CheckCircle2 size={14} />} {t(opt, lang)}
        </div>
      ))}
    </div>
  );
}

// Groups a merged sub-module (its own original field-set) inside a broader tab,
// so several of the original 17 modules can share one tab without losing their identity.
function SubSection({ icon: Icon, title, first, children }: { icon: any; title: string; first?: boolean; children: React.ReactNode }) {
  const { lang } = useLang();
  return (
    <div className={`${first ? "" : "border-t border-[var(--gt-border)] pt-4 mt-4"}`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={16} className="text-[var(--gt-purple)]" />
        <span className="text-sm font-semibold text-[var(--gt-purple-dark)]">{t(title, lang)}</span>
      </div>
      {children}
    </div>
  );
}

export default function DataEntryWizard() {
  const [params] = useSearchParams();
  const editId = params.get("id");
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<any>(empty);
  const [lookupQ, setLookupQ] = useState("");
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);

  const [villagesFlat, setVillagesFlat] = useState<{ village: string; taluka: string; district: string }[]>([]);
  const [villageQuery, setVillageQuery] = useState("");
  const [showVillageSuggestions, setShowVillageSuggestions] = useState(false);
  const [societies, setSocieties] = useState<string[]>([]);
  const [crops, setCrops] = useState<string[]>([]);
  const [schemes, setSchemes] = useState<string[]>([]);
  const [machines, setMachines] = useState<string[]>([]);
  const [opts, setOpts] = useState<Record<string, string[]>>({});
  const { lang } = useLang();
  const [otpStatus, setOtpStatus] = useState<"idle" | "sent" | "verifying">("idle");
  const [schemeNameInput, setSchemeNameInput] = useState(""); // CR-15: free-text entry for a scheme not in the master list
  const [otpCode, setOtpCode] = useState("");
  // Once a village is picked it locks — accidental edits/deletes are the exact
  // failure mode the client called out. "Change Village" is still possible but
  // requires an explicit confirm, so it's a deliberate action, not a slip.
  const [villageUnlocked, setVillageUnlocked] = useState(false);
  const villageLocked = !!form.village && !villageUnlocked;

  // CR-02: some testers want the original District -> Taluka -> Village cascade
  // back; others found it slower than searching the village directly (that's
  // exactly why it was replaced with search in an earlier round). Rather than
  // re-relitigate this, both are offered — search stays the default, with a
  // toggle to the cascade. The preference is remembered per-device so an
  // enumerator doesn't have to re-pick it on every new entry.
  const [locationMode, setLocationMode] = useState<"search" | "cascade">(
    () => (localStorage.getItem("gt_location_mode") as "search" | "cascade") || "search"
  );
  useEffect(() => localStorage.setItem("gt_location_mode", locationMode), [locationMode]);

  useEffect(() => {
    api.villagesFlat().then(setVillagesFlat);
    api.societies().then(setSocieties);
    api.crops().then(setCrops);
    api.schemes().then(setSchemes);
    api.machines().then(setMachines);
    Promise.all(
      ["society_benefits", "cultivation_challenges", "storage_source", "logistics_provider",
        "credit_source", "irrigation_source", "input_source", "input_challenges", "marketing_channel",
        "non_farm_income_source", "intercrop_crops", "loan_rejection_reason"]
        .map((code) => api.options(code).then((v: string[]) => [code, v]))
    ).then((entries) => setOpts(Object.fromEntries(entries)));
  }, []);

  // Village-first entry: typing a few letters of the village filters this list,
  // and picking a match auto-fills its Taluka + District — much faster for an
  // enumerator than three cascading dropdowns when they already know the village.
  const villageMatches = useMemo(() => {
    const q = villageQuery.trim().toLowerCase();
    if (!q) return [];
    return villagesFlat
      .filter((v) => v.village.toLowerCase().includes(q) || trVillage(v.village, lang).toLowerCase().includes(q))
      .slice(0, 8);
  }, [villageQuery, villagesFlat, lang]);

  // CR-02 cascade mode: derived entirely from the already-loaded villagesFlat
  // list (no extra API calls needed) rather than the separate
  // districts()/talukas()/villages() endpoints — those still exist server-side
  // but every value they'd return is already present in villagesFlat.
  const cascadeDistricts = useMemo(
    () => Array.from(new Set(villagesFlat.map((v) => v.district))).sort(),
    [villagesFlat]
  );
  const cascadeTalukas = useMemo(
    () => Array.from(new Set(villagesFlat.filter((v) => v.district === form.district).map((v) => v.taluka))).sort(),
    [villagesFlat, form.district]
  );
  const cascadeVillages = useMemo(
    () => villagesFlat.filter((v) => v.district === form.district && v.taluka === form.taluka).map((v) => v.village).sort(),
    [villagesFlat, form.district, form.taluka]
  );

  const selectVillage = (v: { village: string; taluka: string; district: string }) => {
    setForm((f: any) => ({ ...f, village: v.village, taluka: v.taluka, district: v.district }));
    clearError("village"); clearError("taluka"); clearError("district");
    setVillageQuery("");
    setShowVillageSuggestions(false);
    setVillageUnlocked(false);
  };

  // FPC dropdown is scoped to the selected Taluka (plus every state-level
  // society) rather than showing every FPC in Karnataka — re-fetched whenever
  // the taluka changes (i.e. whenever the village selection changes).
  useEffect(() => {
    if (form.taluka) api.societies(form.taluka).then(setSocieties);
  }, [form.taluka]);

  useEffect(() => {
    if (editId) {
      api.getSurvey(Number(editId)).then((s: any) => {
        setForm({
          ...s,
          society_benefits: s.society_benefits ? s.society_benefits.split(",") : [],
          cultivation_challenges: s.cultivation_challenges ? s.cultivation_challenges.split(",") : [],
          mech_owned: s.mech_owned ? s.mech_owned.split(",") : [],
          mech_rented: s.mech_rented ? s.mech_rented.split(",") : [],
          mech_rental_rate: s.mech_rental_rate_inr_hr ? JSON.parse(s.mech_rental_rate_inr_hr) : {},
          irrigation_source: s.irrigation_source ? s.irrigation_source.split(",") : [],
          intercrop_crops: s.intercrop_crops ? s.intercrop_crops.split(",") : [],
          non_farm_income_source: s.non_farm_income_source ? s.non_farm_income_source.split(",") : [],
          input_source: s.input_source ? s.input_source.split(",") : [], // CR-14
          input_challenges: s.input_challenges ? s.input_challenges.split(",") : [], // CR-14
          scheme_name: s.scheme_name ? s.scheme_name.split(",") : [], // CR-15
          grading_rows: s.grading_rows ? JSON.parse(s.grading_rows) : [], // CR-05
        });
        // CR-17: prefer the multi-plot list when the backend returns one (every
        // record saved via the new flow has it); fall back to the legacy single
        // boundary for older records that predate multi-plot support.
        if (Array.isArray(s.plots) && s.plots.length > 0) {
          try {
            setPlots(s.plots.map((p: any, i: number) => ({
              key: `p${i}`,
              label: p.label || `Plot ${i + 1}`,
              reportedArea: p.reported_area_acres != null ? String(p.reported_area_acres) : "",
              method: (p.method as CaptureMethod) || "gps",
              points: p.points || [],
            })));
          } catch {}
        } else if (s.plot_boundary) {
          try {
            const points = JSON.parse(s.plot_boundary);
            setPlots([{ key: "p0", label: "Plot 1", reportedArea: s.plot_boundary_area_acres != null ? String(s.plot_boundary_area_acres) : "", method: (s.plot_boundary_method as CaptureMethod) || "gps", points }]);
          } catch {}
        }
      });
    }
  }, [editId]);

  const clearError = (k: string) =>
    setErrors((prev) => {
      if (!(k in prev)) return prev;
      const { [k]: _, ...rest } = prev;
      return rest;
    });

  const set = (k: string, v: any) => {
    setForm((f: any) => ({ ...f, [k]: v, ...(k === "mobile_no" ? { mobile_verified: false } : {}) }));
    clearError(k);
    if (k === "mobile_no") setOtpStatus("idle");
  };
  // For fields that must never be negative: strips a leading "-" the moment it's
  // typed, rather than only flagging it as an error after the fact. A retest
  // round called out several fields where validation caught the negative value
  // on Next/Submit but the field itself still visually "accepted" typing it.
  const setNonNeg = (k: string, raw: string) => set(k, raw.replace(/^-+/, ""));
  const toggleMulti = (k: string, v: string) => {
    setForm((f: any) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x: string) => x !== v) : [...f[k], v] }));
    clearError(k);
  };

  // CR-05: dynamic grading/variety table for processed areca sales.
  const addGradingRow = () => {
    setForm((f: any) => ({ ...f, grading_rows: [...f.grading_rows, { variety: "Rashi", variety_other: "", quantity_qtl: "", rate_inr_per_kg: "" }] }));
    clearError("grading_rows");
  };
  const removeGradingRow = (idx: number) => {
    setForm((f: any) => ({ ...f, grading_rows: f.grading_rows.filter((_: any, i: number) => i !== idx) }));
  };
  const updateGradingRow = (idx: number, key: string, value: string) => {
    setForm((f: any) => ({ ...f, grading_rows: f.grading_rows.map((r: any, i: number) => (i === idx ? { ...r, [key]: value } : r)) }));
    clearError("grading_rows");
  };

  // No SMS gateway is wired up yet (needs a provider — Twilio/MSG91/etc. — and
  // credentials from the client), so this simulates the OTP round trip client-side
  // rather than actually texting the farmer. Swap sendOtp/verifyOtp for real API
  // calls once a provider is chosen.
  const sendOtp = () => {
    if (!/^\d{10}$/.test(String(form.mobile_no).trim())) return;
    setOtpStatus("sent");
    setOtpCode("");
  };
  const verifyOtp = () => {
    setOtpStatus("verifying");
    setTimeout(() => {
      set("mobile_verified", true);
      setOtpStatus("idle");
    }, 400);
  };

  const computedIncome = useMemo(() => {
    const includesRaw = form.sale_type === "Sold raw areca" || form.sale_type === "Sold both raw and processed areca";
    const includesProcessed = form.sale_type === "Sold processed areca" || form.sale_type === "Sold both raw and processed areca";
    const isGrading = includesProcessed && form.grading_done === "Yes"; // CR-05/CR-07
    const c = parseFloat(form.cultivation_cost_inr) || 0;
    const p = includesProcessed ? (parseFloat(form.processing_cost_inr) || 0) : 0;
    let gross = 0;
    if (isGrading) {
      // Grading-row rate is INR/Quintal (not INR/Kg like the blanket rate below), and
      // quantity_qtl is already in quintals — no *100 kg-to-quintal conversion needed here.
      gross += (form.grading_rows || []).reduce((sum: number, row: any) => sum + (parseFloat(row.quantity_qtl) || 0) * (parseFloat(row.rate_inr_per_kg) || 0), 0);
      if (includesRaw) gross += (parseFloat(form.yield_raw_qtl) || 0) * (parseFloat(form.rate_inr_per_kg) || 0) * 100;
    } else {
      const y = (includesRaw ? parseFloat(form.yield_raw_qtl) || 0 : 0) + (includesProcessed ? parseFloat(form.yield_processed_qtl) || 0 : 0);
      gross = y * (parseFloat(form.rate_inr_per_kg) || 0) * 100;
    }
    return Math.round(gross - c - p);
  }, [form.yield_raw_qtl, form.yield_processed_qtl, form.rate_inr_per_kg, form.cultivation_cost_inr, form.processing_cost_inr, form.sale_type, form.grading_done, form.grading_rows]);

  // Cultivation cost is captured a whole step before yield/rate, so the income
  // preview would otherwise flash a large negative number (just -cost) the
  // moment an enumerator reaches this step and before they've typed a rate —
  // easy to mistake for a data-entry error in the field. Hide the number until
  // there's an actual yield*rate to net it against.
  const hasIncomeInputs = useMemo(() => {
    const includesRaw = form.sale_type === "Sold raw areca" || form.sale_type === "Sold both raw and processed areca";
    const includesProcessed = form.sale_type === "Sold processed areca" || form.sale_type === "Sold both raw and processed areca";
    const isGrading = includesProcessed && form.grading_done === "Yes"; // CR-05/CR-07
    if (isGrading) {
      return (form.grading_rows || []).some((row: any) => (parseFloat(row.quantity_qtl) || 0) > 0 && (parseFloat(row.rate_inr_per_kg) || 0) > 0);
    }
    const y = (includesRaw ? parseFloat(form.yield_raw_qtl) || 0 : 0) + (includesProcessed ? parseFloat(form.yield_processed_qtl) || 0 : 0);
    const r = parseFloat(form.rate_inr_per_kg) || 0;
    return y > 0 && r > 0;
  }, [form.yield_raw_qtl, form.yield_processed_qtl, form.rate_inr_per_kg, form.sale_type, form.grading_done, form.grading_rows]);

  const doLookup = async () => {
    setLookupMsg(null);
    try {
      const res = await api.lookupFarmer(lookupQ);
      setForm((f: any) => ({
        ...f,
        farmer_id: res.farmer_id, farmer_name: res.farmer_name, mobile_no: res.mobile_no,
        gender: res.gender, age: res.age, guardian_name: res.guardian_name || "",
        district: res.district || f.district, taluka: res.taluka || f.taluka, village: res.village || f.village,
      }));
      setLookupMsg(t("Farmer found and details auto-filled from Registration Portal.", lang));
    } catch (e: any) {
      setLookupMsg(e.message || t("Farmer not found.", lang));
    }
  };

  const [geoStatus, setGeoStatus] = useState<"idle" | "locating" | "done" | "error">("idle");
  const [geoError, setGeoError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // CR-17: multiple plot/land records per farmer, each with its own
  // farmer-reported area and an optional GPS-measured boundary (draw/Excel/
  // GPS, same capture methods as the old single-plot flow). `key` is a
  // client-only identity for list rendering/updates — never sent to the API.
  const [plots, setPlots] = useState<
    { key: string; label: string; reportedArea: string; method: CaptureMethod; points: PlotBoundary }[]
  >([{ key: "p0", label: "Plot 1", reportedArea: "", method: "gps", points: [] }]);

  const addPlot = () => {
    setPlots((prev) => [...prev, { key: `p${Date.now()}`, label: `Plot ${prev.length + 1}`, reportedArea: "", method: "gps", points: [] }]);
  };
  const removePlot = (key: string) => {
    setPlots((prev) => (prev.length > 1 ? prev.filter((p) => p.key !== key) : prev));
  };
  const updatePlot = (key: string, patch: Partial<{ label: string; reportedArea: string; points: PlotBoundary }>) => {
    setPlots((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  };
  const switchPlotMethod = (key: string, next: CaptureMethod) => {
    setPlots((prev) => {
      const plot = prev.find((p) => p.key === key);
      if (!plot || next === plot.method) return prev;
      if (plot.points.length > 0) {
        const ok = window.confirm("Switching methods will discard the in-progress plot boundary. Continue?");
        if (!ok) return prev;
      }
      return prev.map((p) => (p.key === key ? { ...p, method: next, points: [] } : p));
    });
  };

  // Geo-tagging (plot boundary capture) made non-mandatory for now, per
  // explicit request — a survey can submit with no plot boundary captured
  // at all. Still validates the *shape* of whatever boundary is attempted
  // (a plot with 1-2 points is an in-progress/invalid walk, not a valid
  // "skip it" state) and still requires reported area on every plot, since
  // that's basic data entry, not geo-tagging. Revert to requiring
  // `plots.some((p) => validateBoundary(p.points).valid)` if this needs to
  // become mandatory again.
  const plotsValidation = useMemo(() => {
    const badBoundary = plots.find((p) => p.points.length > 0 && !validateBoundary(p.points).valid);
    if (badBoundary) return { valid: false, error: validateBoundary(badBoundary.points).error };
    const missingArea = plots.find((p) => isBlank(p.reportedArea) || Number(p.reportedArea) <= 0);
    if (missingArea) return { valid: false, error: `${missingArea.label}: reported area is required and must be greater than 0.` };
    return { valid: true };
  }, [plots]);

  const totalReportedArea = useMemo(() => plots.reduce((sum, p) => sum + (parseFloat(p.reportedArea) || 0), 0), [plots]);
  const totalGpsArea = useMemo(() => plots.reduce((sum, p) => sum + (validateBoundary(p.points).valid ? areaInAcres(p.points) : 0), 0), [plots]);

  // Uses @capacitor/geolocation so the same call works via the browser
  // Geolocation API on web and via native GPS on the packaged Android app.
  const captureGeo = async () => {
    setGeoStatus("locating");
    setGeoError(null);
    try {
      if (Capacitor.getPlatform() === "web" && !window.isSecureContext) {
        throw new Error("Location requires a secure connection (HTTPS) — this page is being served over plain HTTP.");
      }
      const perm = await Geolocation.requestPermissions().catch(() => null);
      if (perm && perm.location === "denied") {
        throw new Error("Location permission denied — enable it in your device/browser settings.");
      }
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      set("geo_lat", pos.coords.latitude.toFixed(6));
      set("geo_long", pos.coords.longitude.toFixed(6));
      setGeoStatus("done");
    } catch (e: any) {
      const code = e?.code;
      if (code === 1) setGeoError("Location permission denied — enable it in your device/browser settings.");
      else if (code === 3) setGeoError("Location request timed out — try again where GPS signal is stronger.");
      else setGeoError(e?.message || "Could not access device GPS. Enable location and retry.");
      setGeoStatus("error");
    }
  };

  // Auto-capture device GPS the first time the enumerator actually reaches the
  // Geo-tag & Review step — NOT on wizard mount. Requesting location the instant
  // the form opens (while the enumerator is still on "Farmer & Location") fires
  // the permission prompt somewhere the enumerator isn't looking; if it's missed
  // or dismissed, most browsers cache that as a permanent denial for the site,
  // and no in-app "Retry" can undo a browser-cached decision. Firing it only when
  // this step becomes visible means the prompt appears exactly when expected.
  useEffect(() => {
    if (step === STEPS.length - 1 && geoStatus === "idle") {
      captureGeo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const attachPhoto = async () => {
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const photo = await CapacitorCamera.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Prompt,
        promptLabelHeader: "Field Photo",
        width: 1280,
      });
      set("field_photo", photo.dataUrl || "");
      // Geo-tag the photo with whatever GPS fix we already have; if none yet, fetch it now.
      if (!form.geo_lat) captureGeo();
    } catch (e: any) {
      // A cancelled camera/picker isn't an error worth surfacing.
      const msg = String(e?.message || "");
      if (!/cancel/i.test(msg)) {
        setPhotoError(msg || t("Could not access the camera. Check camera/photo permissions and try again.", lang));
      }
    } finally {
      setPhotoBusy(false);
    }
  };

  const jumpToFirstError = (errs: Record<string, string>) => {
    const steps = Object.keys(errs).map((f) => FIELD_STEP[f] ?? step);
    if (steps.length) setStep(Math.min(...steps));
  };

  const submit = async () => {
    setSubmitError(null);
    const validationErrors = getErrors(form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      jumpToFirstError(validationErrors);
      setSubmitError(t("Please fix {n} error(s) before submitting.", lang).replace("{n}", String(Object.keys(validationErrors).length)));
      return;
    }
    if (!plotsValidation.valid) {
      setStep(STEPS.length - 1);
      setSubmitError(plotsValidation.error || t("Please fix the plot details before submitting.", lang));
      return;
    }

    setSubmitting(true);
    const includesProcessedNow = form.sale_type === "Sold processed areca" || form.sale_type === "Sold both raw and processed areca";
    const isGradingNow = includesProcessedNow && form.grading_done === "Yes"; // CR-05/CR-07
    const payload = {
      ...form,
      age: parseInt(form.age) || 0,
      survey_year: form.survey_year ? parseInt(form.survey_year) : null, // CR-18
      society_since_year: form.society_since_year ? parseInt(form.society_since_year) : null,
      society_benefits: form.society_benefits.join(","),
      land_own_acres: parseFloat(form.land_own_acres) || 0,
      land_leased_acres: parseFloat(form.land_leased_acres) || 0,
      areca_area_acres: parseFloat(form.areca_area_acres) || 0,
      areca_plant_count: parseInt(form.areca_plant_count) || 0,
      intercrop_crops: (form.intercrop_crops || []).join(","),
      intercrop_area_acres: form.intercrop_area_acres ? parseFloat(form.intercrop_area_acres) : null,
      cultivation_cost_inr: parseFloat(form.cultivation_cost_inr) || 0,
      yield_raw_qtl: (form.sale_type === "Sold raw areca" || form.sale_type === "Sold both raw and processed areca") ? (parseFloat(form.yield_raw_qtl) || 0) : null,
      yield_processed_qtl: (form.sale_type === "Sold processed areca" || form.sale_type === "Sold both raw and processed areca") ? (parseFloat(form.yield_processed_qtl) || 0) : null,
      processing_cost_inr: form.processing_cost_inr ? parseFloat(form.processing_cost_inr) : null,
      grading_done: includesProcessedNow ? form.grading_done : null, // CR-05
      grading_rows: isGradingNow // CR-05
        ? JSON.stringify(form.grading_rows.map((r: any) => ({
            variety: r.variety, variety_other: r.variety === "Other" ? r.variety_other : "",
            quantity_qtl: parseFloat(r.quantity_qtl) || 0, rate_inr_per_kg: parseFloat(r.rate_inr_per_kg) || 0,
          })))
        : null,
      rate_inr_per_kg: isGradingNow
        ? (form.sale_type === "Sold both raw and processed areca" ? (parseFloat(form.rate_inr_per_kg) || 0) : null) // only the raw portion (if any) still needs a blanket rate
        : (parseFloat(form.rate_inr_per_kg) || 0), // CR-07
      storage_duration_months: form.storage_duration_months ? parseFloat(form.storage_duration_months) : null,
      storage_loan_amount_inr: form.storage_loan_amount_inr ? parseFloat(form.storage_loan_amount_inr) : null,
      storage_loan_interest_pct: form.storage_loan_interest_pct ? parseFloat(form.storage_loan_interest_pct) : null,
      storage_loan_repayment_months: form.storage_loan_repayment_months ? parseInt(form.storage_loan_repayment_months) : null,
      logistics_cost_inr_per_qtl: form.logistics_cost_inr_per_qtl ? parseFloat(form.logistics_cost_inr_per_qtl) : null,
      cultivation_challenges: form.cultivation_challenges.join(","),
      machinery_waiting_days: form.machinery_waiting_days ? parseInt(form.machinery_waiting_days) : null,
      crop2_area_acres: form.crop2_area_acres ? parseFloat(form.crop2_area_acres) : null,
      crop2_yield: form.crop2_yield ? parseFloat(form.crop2_yield) : null,
      crop2_rate: form.crop2_rate ? parseFloat(form.crop2_rate) : null,
      crop3_area_acres: form.crop3_area_acres ? parseFloat(form.crop3_area_acres) : null,
      crop3_yield: form.crop3_yield ? parseFloat(form.crop3_yield) : null,
      crop3_rate: form.crop3_rate ? parseFloat(form.crop3_rate) : null,
      mech_owned: form.mech_owned.join(","),
      mech_rented: form.mech_rented.join(","),
      mech_rental_rate_inr_hr: JSON.stringify(form.mech_rental_rate || {}),
      mech_loan_amount_inr_lakh: form.mech_loan_amount_inr_lakh ? parseFloat(form.mech_loan_amount_inr_lakh) : null,
      mech_loan_interest_pct: form.mech_loan_interest_pct ? parseFloat(form.mech_loan_interest_pct) : null,
      total_household_income_inr_lakh: null,
      non_farm_income_source: (form.non_farm_income_source || []).join(","),
      overdraft_limit_inr_lakh: form.overdraft_limit_inr_lakh ? parseFloat(form.overdraft_limit_inr_lakh) : null,
      credit_amount_inr: form.credit_amount_inr ? parseFloat(form.credit_amount_inr) : null,
      credit_interest_rate_pct: form.credit_interest_rate_pct ? parseFloat(form.credit_interest_rate_pct) : null,
      credit_repayment_months: form.credit_repayment_months ? parseInt(form.credit_repayment_months) : null,
      credit_outstanding_inr_lakh: form.credit_outstanding_inr_lakh ? parseFloat(form.credit_outstanding_inr_lakh) : null,
      credit_gap_inr_lakh: form.credit_gap_inr_lakh ? parseFloat(form.credit_gap_inr_lakh) : null,
      kcc_limit_inr_lakh: form.kcc_limit_inr_lakh ? parseFloat(form.kcc_limit_inr_lakh) : null,
      irrigation_source: form.irrigation_source.join(","),
      input_source: (form.input_source || []).join(","), // CR-14
      input_challenges: (form.input_challenges || []).join(","), // CR-14
      input_distance_km: form.input_distance_km ? parseFloat(form.input_distance_km) : null,
      input_purchase_delay_days: form.input_purchase_delay_days ? parseInt(form.input_purchase_delay_days) : null,
      scheme_name: (form.scheme_name || []).join(","), // CR-15
      geo_lat: form.geo_lat ? parseFloat(form.geo_lat) : null,
      geo_long: form.geo_long ? parseFloat(form.geo_long) : null,
      // CR-17: multiple plots. Legacy plot_boundary/* fields are still sent
      // (mirroring plot[0]) purely so an older build of this payload shape
      // would degrade gracefully — the backend recomputes them from `plots`
      // itself and ignores these three whenever `plots` is present.
      plot_boundary: validateBoundary(plots[0].points).valid ? JSON.stringify(plots[0].points) : null,
      plot_boundary_area_acres: validateBoundary(plots[0].points).valid ? areaInAcres(plots[0].points) : null,
      plot_boundary_method: validateBoundary(plots[0].points).valid ? plots[0].method : null,
      plots: plots.map((p) => ({
        label: p.label,
        reported_area_acres: parseFloat(p.reportedArea) || 0,
        points: validateBoundary(p.points).valid ? p.points : null,
        area_acres: validateBoundary(p.points).valid ? areaInAcres(p.points) : null,
        method: validateBoundary(p.points).valid ? p.method : null,
      })),
    };
    delete payload.id;
    delete payload.entry_timestamp;
    delete payload.total_income_inr;

    // Offline-first: if there's no connectivity (or the request itself fails to
    // reach the server), queue the survey locally instead of losing the data —
    // it syncs automatically the next time the device comes back online.
    if (!navigator.onLine) {
      await queueSurvey(payload, !!editId, editId ? Number(editId) : undefined);
      setSubmitting(false);
      navigate("/farmers?queued=1");
      return;
    }
    try {
      const saved = editId ? await api.updateSurvey(Number(editId), payload) : await api.createSurvey(payload);
      navigate(`/farmers/${saved.id}?justSaved=1`);
    } catch (e) {
      await queueSurvey(payload, !!editId, editId ? Number(editId) : undefined);
      setSubmitting(false);
      navigate("/farmers?queued=1");
    }
  };

  // Save as Draft: deliberately bypasses getErrors/plotsValidation entirely —
  // "incomplete" is exactly the point. Unlike submit()'s payload, blank
  // fields are sent as null rather than coerced to 0/"" , so a half-filled
  // number field doesn't silently turn into a fake "0" the next time this
  // draft is reopened.
  const saveDraft = async () => {
    setSubmitError(null);
    setSavingDraft(true);
    const num = (v: any) => (v === "" || v === null || v === undefined ? null : parseFloat(v));
    const int = (v: any) => (v === "" || v === null || v === undefined ? null : parseInt(v));
    const includesProcessedNow = form.sale_type === "Sold processed areca" || form.sale_type === "Sold both raw and processed areca";
    const isGradingNow = includesProcessedNow && form.grading_done === "Yes";
    const payload: any = {
      ...form,
      age: int(form.age),
      survey_year: int(form.survey_year),
      society_since_year: int(form.society_since_year),
      society_benefits: (form.society_benefits || []).join(","),
      land_own_acres: num(form.land_own_acres),
      land_leased_acres: num(form.land_leased_acres),
      areca_area_acres: num(form.areca_area_acres),
      areca_plant_count: int(form.areca_plant_count),
      intercrop_crops: (form.intercrop_crops || []).join(","),
      intercrop_area_acres: num(form.intercrop_area_acres),
      cultivation_cost_inr: num(form.cultivation_cost_inr),
      yield_raw_qtl: num(form.yield_raw_qtl),
      yield_processed_qtl: num(form.yield_processed_qtl),
      processing_cost_inr: num(form.processing_cost_inr),
      grading_done: form.grading_done || null,
      grading_rows: (isGradingNow && form.grading_rows?.length)
        ? JSON.stringify(form.grading_rows.map((r: any) => ({
            variety: r.variety, variety_other: r.variety === "Other" ? r.variety_other : "",
            quantity_qtl: num(r.quantity_qtl), rate_inr_per_kg: num(r.rate_inr_per_kg),
          })))
        : null,
      rate_inr_per_kg: num(form.rate_inr_per_kg),
      storage_duration_months: num(form.storage_duration_months),
      storage_loan_amount_inr: num(form.storage_loan_amount_inr),
      storage_loan_interest_pct: num(form.storage_loan_interest_pct),
      storage_loan_repayment_months: int(form.storage_loan_repayment_months),
      logistics_cost_inr_per_qtl: num(form.logistics_cost_inr_per_qtl),
      cultivation_challenges: (form.cultivation_challenges || []).join(","),
      machinery_waiting_days: int(form.machinery_waiting_days),
      crop2_area_acres: num(form.crop2_area_acres),
      crop2_yield: num(form.crop2_yield),
      crop2_rate: num(form.crop2_rate),
      crop3_area_acres: num(form.crop3_area_acres),
      crop3_yield: num(form.crop3_yield),
      crop3_rate: num(form.crop3_rate),
      mech_owned: (form.mech_owned || []).join(","),
      mech_rented: (form.mech_rented || []).join(","),
      mech_rental_rate_inr_hr: JSON.stringify(form.mech_rental_rate || {}),
      mech_loan_amount_inr_lakh: num(form.mech_loan_amount_inr_lakh),
      mech_loan_interest_pct: num(form.mech_loan_interest_pct),
      total_household_income_inr_lakh: null,
      non_farm_income_source: (form.non_farm_income_source || []).join(","),
      overdraft_limit_inr_lakh: num(form.overdraft_limit_inr_lakh),
      credit_amount_inr: num(form.credit_amount_inr),
      credit_interest_rate_pct: num(form.credit_interest_rate_pct),
      credit_repayment_months: int(form.credit_repayment_months),
      credit_outstanding_inr_lakh: num(form.credit_outstanding_inr_lakh),
      credit_gap_inr_lakh: num(form.credit_gap_inr_lakh),
      kcc_limit_inr_lakh: num(form.kcc_limit_inr_lakh),
      irrigation_source: (form.irrigation_source || []).join(","),
      input_source: (form.input_source || []).join(","),
      input_challenges: (form.input_challenges || []).join(","),
      input_distance_km: num(form.input_distance_km),
      input_purchase_delay_days: int(form.input_purchase_delay_days),
      scheme_name: (form.scheme_name || []).join(","),
      geo_lat: num(form.geo_lat),
      geo_long: num(form.geo_long),
      plots: plots.map((p) => ({
        label: p.label,
        reported_area_acres: num(p.reportedArea),
        points: p.points && p.points.length > 0 ? p.points : null,
        area_acres: validateBoundary(p.points).valid ? areaInAcres(p.points) : null,
        method: p.points && p.points.length > 0 ? p.method : null,
      })),
    };
    delete payload.id;
    delete payload.entry_timestamp;
    delete payload.total_income_inr;
    delete payload.plot_boundary;
    delete payload.plot_boundary_area_acres;
    delete payload.plot_boundary_method;
    delete payload.status;

    try {
      const saved = editId ? await api.updateSurveyDraft(Number(editId), payload) : await api.createSurveyDraft(payload);
      if (!editId) {
        navigate(`/entry/farmer?id=${saved.id}`, { replace: true });
      }
      setDraftSavedAt(new Date());
    } catch (e: any) {
      setSubmitError(e.message || t("Could not save draft. Check your connection and try again.", lang));
    } finally {
      setSavingDraft(false);
    }
  };

  const next = () => {
    const stepErrors = getErrors(form);
    // Only block on errors that belong to the tab the user is currently on —
    // later tabs get validated too, but only once the user actually reaches them
    // or hits Submit, so a first pass through the wizard doesn't feel like a wall.
    const blockingErrors = Object.fromEntries(Object.entries(stepErrors).filter(([f]) => (FIELD_STEP[f] ?? 0) === step));
    setErrors((prev) => ({ ...prev, ...stepErrors }));
    if (Object.keys(blockingErrors).length > 0) {
      setSubmitError(t("Please fix {n} error(s) on this tab before continuing.", lang).replace("{n}", String(Object.keys(blockingErrors).length)));
      return;
    }
    setSubmitError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  // On the first tab there's nowhere earlier in the wizard to go — leaving the
  // button disabled and inert there read as broken, so it exits to the list instead.
  const back = () => {
    if (step === 0) {
      navigate("/farmers");
      return;
    }
    setStep((s) => Math.max(s - 1, 0));
  };

  const CurrentIcon = STEPS[step].icon;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--gt-purple-dark)] flex items-center gap-2">
          {t(form.status === "draft" ? "Continue Draft Survey" : editId ? "Edit Farmer Survey" : "New Farmer Survey", lang)}
          {form.status === "draft" && (
            <span className="text-[11px] font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">{t("DRAFT", lang)}</span>
          )}
        </h1>
        <span className="text-xs font-medium text-[var(--gt-text-muted)] bg-[#F1EBF7] px-2.5 py-1 rounded-full whitespace-nowrap">
          {step + 1} {t("of", lang)} {STEPS.length}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl gt-gradient text-white flex items-center justify-center shrink-0">
          <CurrentIcon size={22} />
        </div>
        <div>
          <div className="text-base font-semibold text-[var(--gt-purple-dark)] leading-tight">{t(STEPS[step].label, lang)}</div>
          <p className="text-sm text-[var(--gt-text-muted)] leading-tight">{t(STEPS[step].hint, lang)}</p>
        </div>
      </div>

      <div className="w-full h-1.5 bg-[var(--gt-border)] rounded-full overflow-hidden">
        <div className="h-full gt-gradient transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isDone = i < step;
          const isActive = i === step;
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => setStep(i)}
              title={t(s.label, lang)}
              className={`shrink-0 flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-full border whitespace-nowrap transition-colors ${
                isActive
                  ? "gt-gradient text-white border-transparent shadow-sm"
                  : isDone
                  ? "bg-[#F1EBF7] text-[var(--gt-purple-dark)] border-[var(--gt-purple-light)]"
                  : "bg-white text-[var(--gt-text-muted)] border-[var(--gt-border)]"
              }`}
            >
              {isDone ? <Check size={14} /> : <Icon size={14} />}
              {t(s.label, lang)}
            </button>
          );
        })}
      </div>

      {submitError && (
        <div className="flex items-center gap-2 bg-red-50 border border-[var(--gt-danger)]/30 text-[var(--gt-danger)] text-sm rounded-lg px-3 py-2">
          <AlertCircle size={16} /> {submitError}
        </div>
      )}

      {draftSavedAt && !submitError && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-3 py-2">
          <CheckCircle2 size={16} /> {t("Saved as draft at", lang)} {draftSavedAt.toLocaleTimeString()} — {t("you can safely close this and come back to it later.", lang)}
        </div>
      )}

      <div className="gt-card p-4 md:p-6">
        {step === 0 && (
          <>
            <SubSection icon={UserSearch} title="Farmer Link" first>
              <Field label="Search Farmer (Aadhaar / Mobile / Farmer ID)">
                <div className="flex gap-2">
                  <input className="gt-input" placeholder={t("e.g. 9876543210 or NCCF/KA/0007", lang)} value={lookupQ} onChange={(e) => setLookupQ(e.target.value)} />
                  <button className="gt-btn-primary flex items-center gap-1.5 px-4" onClick={doLookup}><Search size={16} /> {t("Fetch", lang)}</button>
                </div>
                {lookupMsg && <div className="text-xs mt-2 text-[var(--gt-purple-dark)]">{lookupMsg}</div>}
              </Field>
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Farmer Name" required error={errors.farmer_name}><input className="gt-input" value={form.farmer_name} onChange={(e) => set("farmer_name", e.target.value)} /></Field>
                <Field label="Mobile Number" required error={errors.mobile_no}>
                  <div className="flex gap-2">
                    <input className="gt-input" maxLength={10} value={form.mobile_no} onChange={(e) => set("mobile_no", e.target.value.replace(/\D/g, ""))} />
                    {form.mobile_verified ? (
                      <span className="shrink-0 flex items-center gap-1 text-xs text-[var(--gt-success)] font-medium px-2"><CheckCircle2 size={14} /> {t("Verified", lang)}</span>
                    ) : otpStatus === "sent" ? (
                      <>
                        <input className="gt-input w-20 shrink-0" placeholder={t("OTP", lang)} value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))} />
                        <button type="button" className="gt-btn-secondary shrink-0 px-3" disabled={otpCode.length < 4} onClick={verifyOtp}>{t("Verify", lang)}</button>
                      </>
                    ) : (
                      <button type="button" className="gt-btn-secondary shrink-0 px-3" disabled={!/^\d{10}$/.test(form.mobile_no)} onClick={sendOtp}>{t("Send OTP", lang)}</button>
                    )}
                  </div>
                  {otpStatus === "sent" && !form.mobile_verified && (
                    <div className="text-[11px] text-[var(--gt-text-muted)] mt-1">{t("Enter any 4+ digit code to simulate verification — SMS delivery isn't wired up yet.", lang)}</div>
                  )}
                </Field>
                <Field label="Gender" required>
                  <select className="gt-input" value={form.gender} onChange={(e) => set("gender", e.target.value)}>
                    <option value="Male">{t("Male", lang)}</option><option value="Female">{t("Female", lang)}</option>
                  </select>
                </Field>
                <Field label="Age" required error={errors.age}><input type="number" className="gt-input" value={form.age} onChange={(e) => setNonNeg("age", e.target.value)} /></Field>
                <Field label="Father / Husband Name"><input className="gt-input" value={form.guardian_name} onChange={(e) => set("guardian_name", e.target.value)} /></Field>
                <Field label="Farmer Unique ID" hint={form.farmer_id ? undefined : t("Auto-generated by the system once this survey is submitted.", lang)}>
                  <input className="gt-input bg-[#F6F4F9]" readOnly value={form.farmer_id || t("Will be assigned on submit", lang)} />
                </Field>
                <Field label="Survey Year / Season" hint="CR-18: which year/season this survey reports on — used to compare a farmer's data across years.">
                  <select className="gt-input" value={form.survey_year} onChange={(e) => set("survey_year", e.target.value)}>
                    {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </Field>
              </div>
            </SubSection>

            <SubSection icon={MapPin} title="Location Details">
              <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
                <div className="text-sm text-[var(--gt-text-muted)]">
                  {locationMode === "search"
                    ? (villageLocked
                        ? t("Village is locked once selected — use \"Change Village\" if it was picked in error.", lang)
                        : t("Start typing the village name — Taluka and District fill in automatically.", lang))
                    : "Pick District, then Taluka, then Village."}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {villageLocked && (
                    <button
                      type="button"
                      className="text-xs text-[var(--gt-purple)] underline"
                      onClick={() => {
                        if (window.confirm("Changing the village is not normally allowed once entered. Continue only if this was selected in error. Proceed?")) {
                          setVillageUnlocked(true);
                          setVillageQuery("");
                        }
                      }}
                    >
                      {t("Change Village", lang)}
                    </button>
                  )}
                  {/* CR-02: lets a user who prefers the old cascade switch to it,
                      without taking the village-first search away from everyone
                      else — both read/write the same form.village/taluka/district. */}
                  <button
                    type="button"
                    className="text-xs text-[var(--gt-purple)] underline"
                    onClick={() => setLocationMode(locationMode === "search" ? "cascade" : "search")}
                  >
                    {locationMode === "search" ? "Switch to District → Taluka → Village" : "Switch to Village Search"}
                  </button>
                </div>
              </div>

              {locationMode === "search" ? (
                <div className="grid md:grid-cols-3 gap-x-4">
                  <Field label={tr("village", lang)} required error={errors.village}>
                    {villageLocked ? (
                      <input className="gt-input bg-[#F6F4F9] disabled:text-[var(--gt-text-muted)]" readOnly value={trVillage(form.village, lang)} />
                    ) : (
                      <div className="relative">
                        <input
                          className="gt-input"
                          placeholder={lang === "kn" ? "ಗ್ರಾಮದ ಹೆಸರು ಟೈಪ್ ಮಾಡಿ…" : "Type a village name…"}
                          value={villageQuery}
                          onChange={(e) => { setVillageQuery(e.target.value); setShowVillageSuggestions(true); }}
                          onFocus={() => setShowVillageSuggestions(true)}
                          onBlur={() => setTimeout(() => setShowVillageSuggestions(false), 150)}
                        />
                        {showVillageSuggestions && villageQuery.trim() && (
                          <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[var(--gt-border)] rounded-lg shadow-lg max-h-56 overflow-y-auto">
                            {villageMatches.length > 0 ? (
                              villageMatches.map((v) => (
                                <button
                                  type="button"
                                  key={`${v.village}-${v.taluka}`}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#F1EBF7] border-b border-[var(--gt-border)] last:border-none"
                                  onMouseDown={() => selectVillage(v)}
                                >
                                  <div className="font-medium">{trVillage(v.village, lang)}</div>
                                  <div className="text-[11px] text-[var(--gt-text-muted)]">{trTaluka(v.taluka, lang)}, {trDistrict(v.district, lang)}</div>
                                </button>
                              ))
                            ) : (
                              <div className="px-3 py-2 text-sm text-[var(--gt-text-muted)]">{t("No matching village found.", lang)}</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </Field>
                  <Field label={`${tr("taluka", lang)} ${t("(auto-filled)", lang)}`} error={errors.taluka}>
                    <input className="gt-input bg-[#F6F4F9]" readOnly value={form.taluka ? trTaluka(form.taluka, lang) : "—"} />
                  </Field>
                  <Field label={`${tr("district", lang)} ${t("(auto-filled)", lang)}`} error={errors.district}>
                    <input className="gt-input bg-[#F6F4F9]" readOnly value={form.district ? trDistrict(form.district, lang) : "—"} />
                  </Field>
                  <Field label={tr("state", lang)}>
                    <input className="gt-input bg-[#F6F4F9]" readOnly value={tr("karnataka", lang)} />
                  </Field>
                </div>
              ) : (
                <div className="grid md:grid-cols-3 gap-x-4">
                  <Field label={tr("district", lang)} required error={errors.district}>
                    <select
                      className="gt-input"
                      value={form.district}
                      onChange={(e) => { setForm((f: any) => ({ ...f, district: e.target.value, taluka: "", village: "" })); clearError("district"); clearError("taluka"); clearError("village"); }}
                    >
                      <option value="">{t("Select", lang)}</option>
                      {cascadeDistricts.map((d) => <option key={d} value={d}>{trDistrict(d, lang)}</option>)}
                    </select>
                  </Field>
                  <Field label={tr("taluka", lang)} required error={errors.taluka}>
                    <select
                      className="gt-input"
                      value={form.taluka}
                      disabled={!form.district}
                      onChange={(e) => { setForm((f: any) => ({ ...f, taluka: e.target.value, village: "" })); clearError("taluka"); clearError("village"); }}
                    >
                      <option value="">{t("Select", lang)}</option>
                      {cascadeTalukas.map((tk) => <option key={tk} value={tk}>{trTaluka(tk, lang)}</option>)}
                    </select>
                  </Field>
                  <Field label={tr("village", lang)} required error={errors.village}>
                    <select
                      className="gt-input"
                      value={form.village}
                      disabled={!form.taluka}
                      onChange={(e) => { setForm((f: any) => ({ ...f, village: e.target.value })); clearError("village"); }}
                    >
                      <option value="">{t("Select", lang)}</option>
                      {cascadeVillages.map((v) => <option key={v} value={v}>{trVillage(v, lang)}</option>)}
                    </select>
                  </Field>
                  <Field label={tr("state", lang)}>
                    <input className="gt-input bg-[#F6F4F9]" readOnly value={tr("karnataka", lang)} />
                  </Field>
                </div>
              )}
            </SubSection>

            <SubSection icon={Handshake} title="Society / FPC Linkage">
              <Field label="Associated with any Society or FPC" required><YesNo value={form.society_assoc} onChange={(v) => set("society_assoc", v)} /></Field>
              {form.society_assoc === "Yes" && !form.taluka && (
                <div className="text-xs text-[var(--gt-text-muted)] mt-1">{t("Select the Taluka above first to see FPCs mapped to that area.", lang)}</div>
              )}
              {form.society_assoc === "Yes" && (
                <div className="grid md:grid-cols-2 gap-x-4">
                  <Field label="Society / FPC Name" required error={errors.society_name} hint="Required because 'Associated with any Society or FPC' = Yes">
                    <select className="gt-input" value={form.society_name} onChange={(e) => set("society_name", e.target.value)} disabled={!form.taluka}>
                      <option value="">{form.taluka ? t("Select", lang) : t("Select a village first", lang)}</option>
                      {societies.map((s) => <option key={s} value={s}>{t(s, lang)}</option>)}
                    </select>
                    <div className="text-[11px] text-[var(--gt-text-muted)] mt-1">Showing FPCs mapped to {form.taluka || "the selected taluka"}, plus State-level societies.</div>
                  </Field>
                  <Field label="Associated Since (Year)" required error={errors.society_since_year} hint="Required because 'Associated with any Society or FPC' = Yes">
                    <select className="gt-input" value={form.society_since_year} onChange={(e) => set("society_since_year", e.target.value)}>
                      <option value="">{t("Select", lang)}</option>
                      {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </Field>
                  <Field label="Benefits Received till Date">
                    <MultiChip options={opts.society_benefits || []} value={form.society_benefits} onToggle={(v) => toggleMulti("society_benefits", v)} />
                  </Field>
                  {form.society_benefits?.includes("Any Other") && (
                    <Field label="Specify Benefit" required error={errors.society_benefits_other} hint="Required because 'Any Other' benefit is selected">
                      <input className="gt-input" value={form.society_benefits_other} onChange={(e) => set("society_benefits_other", e.target.value)} />
                    </Field>
                  )}
                </div>
              )}
            </SubSection>
          </>
        )}

        {step === 1 && (
          <>
            <SubSection icon={LandPlot} title="Land Holding" first>
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Total Own Land Holding (Acres)" required error={errors.land_own_acres}><input type="number" step="0.01" className="gt-input" value={form.land_own_acres} onChange={(e) => setNonNeg("land_own_acres", e.target.value)} /></Field>
                <Field label="Total Leased Land (Acres)" error={errors.land_leased_acres}><input type="number" step="0.01" className="gt-input" value={form.land_leased_acres} onChange={(e) => setNonNeg("land_leased_acres", e.target.value)} /></Field>
                <Field label="Total Area under Areca Cultivation (Acres)" required error={errors.areca_area_acres}>
                  <input type="number" step="0.01" className="gt-input" value={form.areca_area_acres} onChange={(e) => setNonNeg("areca_area_acres", e.target.value)} />
                </Field>
                <Field label="Total No. of Areca Plants" required error={errors.areca_plant_count}><input type="number" step="1" className="gt-input" value={form.areca_plant_count} onChange={(e) => setNonNeg("areca_plant_count", e.target.value)} /></Field>
              </div>
            </SubSection>

            <SubSection icon={Sprout} title="Organic Farming">
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Do You Follow Organic Farming Practices?" required><YesNo value={form.organic_farming} onChange={(v) => set("organic_farming", v)} /></Field>
                {form.organic_farming === "Yes" && (
                  <Field label="Do You Hold a Certificate?" required error={errors.organic_certified} hint="Shown because Organic Farming = Yes"><YesNo value={form.organic_certified} onChange={(v) => set("organic_certified", v)} /></Field>
                )}
                {form.organic_farming === "Yes" && form.organic_certified === "No" && (
                  <Field label="Have You Applied for Certification?" required error={errors.organic_cert_applied} hint="Shown because no certificate is held"><YesNo value={form.organic_cert_applied} onChange={(v) => set("organic_cert_applied", v)} /></Field>
                )}
                {form.organic_farming === "Yes" && form.organic_certified === "No" && form.organic_cert_applied === "No" && (
                  <Field label="Aware of the Certification Process?" required error={errors.organic_cert_aware} hint="Shown because certification hasn't been applied for"><YesNo value={form.organic_cert_aware} onChange={(v) => set("organic_cert_aware", v)} /></Field>
                )}
              </div>
            </SubSection>

            <SubSection icon={Sprout} title="Intercropping">
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Are You Currently Intercropping Within Your Arecanut Plantation?" required><YesNo value={form.intercropping} onChange={(v) => set("intercropping", v)} /></Field>
                {form.intercropping === "Yes" && (
                  <>
                    <Field label="Intercrops (select all that apply)" required error={errors.intercrop_crops} hint="Required because Intercropping = Yes">
                      <MultiChip options={opts.intercrop_crops || []} value={form.intercrop_crops} onToggle={(v) => toggleMulti("intercrop_crops", v)} />
                    </Field>
                    {form.intercrop_crops?.includes("Any Other") && (
                      <Field label="Specify Intercrop" required error={errors.intercrop_crops_other} hint="Required because 'Any Other' intercrop is selected">
                        <input className="gt-input" value={form.intercrop_crops_other} onChange={(e) => set("intercrop_crops_other", e.target.value)} />
                      </Field>
                    )}
                    <Field label="Area Under Intercropping (Acres)" required error={errors.intercrop_area_acres} hint="Required because Intercropping = Yes"><input type="number" step="0.01" className="gt-input" value={form.intercrop_area_acres} onChange={(e) => setNonNeg("intercrop_area_acres", e.target.value)} /></Field>
                  </>
                )}
              </div>
            </SubSection>

            <SubSection icon={Wheat} title="Cultivation Cost & Yield">
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Total Annual Cost of Cultivation (INR)" required error={errors.cultivation_cost_inr}><input max="100000000" type="number" step="1" className="gt-input" value={form.cultivation_cost_inr} onChange={(e) => setNonNeg("cultivation_cost_inr", e.target.value)} /></Field>
                <Field label="Sale Type" required>
                  {/* "Sold both raw and processed areca" removed from the picker per
                      client request (ENT-14) — existing records that already used it
                      still read/edit correctly, since every downstream check below
                      still recognizes the value; only new entries can no longer pick it. */}
                  <select className="gt-input" value={form.sale_type} onChange={(e) => set("sale_type", e.target.value)}>
                    <option value="Sold raw areca">{t("Sold raw areca", lang)}</option>
                    <option value="Sold processed areca">{t("Sold processed areca", lang)}</option>
                  </select>
                </Field>
                {(form.sale_type === "Sold raw areca" || form.sale_type === "Sold both raw and processed areca") && (
                  <Field label="Yield (Raw Areca) (Quintal)" required error={errors.yield_raw_qtl} hint="Required for Sale Type = Raw or Both"><input type="number" min="0" step="0.01" className="gt-input" value={form.yield_raw_qtl} onChange={(e) => setNonNeg("yield_raw_qtl", e.target.value)} /></Field>
                )}
                {(form.sale_type === "Sold processed areca" || form.sale_type === "Sold both raw and processed areca") && (
                  <Field label="Yield (Processed Areca Nuts) (Quintal)" required error={errors.yield_processed_qtl} hint="Required for Sale Type = Processed or Both"><input type="number" min="0" step="0.01" className="gt-input" value={form.yield_processed_qtl} onChange={(e) => setNonNeg("yield_processed_qtl", e.target.value)} /></Field>
                )}
              </div>
            </SubSection>
          </>
        )}

        {step === 2 && (
          <>
            <SubSection icon={Coins} title="Sales, Marketing & Income" first>
              <div className="grid md:grid-cols-2 gap-x-4">
                {(form.sale_type === "Sold processed areca" || form.sale_type === "Sold both raw and processed areca") && (
                  <Field label="Total Processing Cost (INR)" required error={errors.processing_cost_inr} hint="Required for Sale Type = Processed or Both"><input max="100000000" step="0.01" type="number" className="gt-input" value={form.processing_cost_inr} onChange={(e) => setNonNeg("processing_cost_inr", e.target.value)} /></Field>
                )}
                <Field label="Marketing Channel" required>
                  <select className="gt-input" value={form.marketing_channel} onChange={(e) => set("marketing_channel", e.target.value)}>
                    {(opts.marketing_channel || []).map((o) => <option key={o} value={o}>{t(o, lang)}</option>)}
                  </select>
                </Field>
                {form.marketing_channel === "FPC/FPO" && (
                  <Field label="Name of FPC/FPO" error={errors.marketing_channel_detail} hint="Optional — fill in if known.">
                    <select className="gt-input" value={form.marketing_channel_detail} onChange={(e) => set("marketing_channel_detail", e.target.value)} disabled={!form.taluka}>
                      <option value="">{form.taluka ? t("Select", lang) : t("Select a village first", lang)}</option>
                      {societies.map((s) => <option key={s} value={s}>{t(s, lang)}</option>)}
                    </select>
                    <div className="text-[11px] text-[var(--gt-text-muted)] mt-1">{t("Same taluka-scoped FPC list as Society/FPC Linkage.", lang)}</div>
                  </Field>
                )}
                {(form.marketing_channel === "Cooperative Society" || form.marketing_channel === "APMC") && (
                  <Field label={`Name of ${form.marketing_channel}`} required error={errors.marketing_channel_detail} hint={`Required because Marketing Channel = ${form.marketing_channel}`}>
                    <input className="gt-input" value={form.marketing_channel_detail} onChange={(e) => set("marketing_channel_detail", e.target.value)} />
                  </Field>
                )}
                {form.marketing_channel === "Any Other" && (
                  <Field label="Specify Marketing Channel" required error={errors.marketing_channel_detail} hint="Required because 'Any Other' Marketing Channel is selected">
                    <input className="gt-input" value={form.marketing_channel_detail} onChange={(e) => set("marketing_channel_detail", e.target.value)} />
                  </Field>
                )}
                {(form.sale_type === "Sold processed areca" || form.sale_type === "Sold both raw and processed areca") && (
                  <Field label="Does the farmer grade/sort the processed produce?" required hint="CR-05: graded produce is priced per variety, not at one blanket rate.">
                    <select className="gt-input" value={form.grading_done} onChange={(e) => set("grading_done", e.target.value)}>
                      <option value="No">{t("No", lang)}</option>
                      <option value="Yes">{t("Yes", lang)}</option>
                    </select>
                  </Field>
                )}
                {!(form.sale_type === "Sold processed areca" && form.grading_done === "Yes") && (
                  // CR-07: hidden when the farmer grades/sorts — each row below carries its own rate instead.
                  <Field label="Rate Realised (INR/kg)" required error={errors.rate_inr_per_kg}><input type="number" className="gt-input" value={form.rate_inr_per_kg} onChange={(e) => setNonNeg("rate_inr_per_kg", e.target.value)} /></Field>
                )}
                {form.sale_type === "Sold processed areca" && form.grading_done === "Yes" && (
                  <div className="md:col-span-2">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-[var(--gt-text)]">{t("Grade / Variety-wise Sales", lang)} *</label>
                      <button type="button" onClick={addGradingRow} className="text-sm text-[var(--gt-purple-dark)] font-medium">+ {t("Add Row", lang)}</button>
                    </div>
                    {errors.grading_rows && <div className="text-xs text-red-600 mb-2">{errors.grading_rows}</div>}
                    <div className="space-y-2">
                      {(form.grading_rows || []).map((row: any, idx: number) => (
                        <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-start">
                          <div>
                            <select className="gt-input" value={row.variety} onChange={(e) => updateGradingRow(idx, "variety", e.target.value)}>
                              {GRADE_VARIETIES.map((v) => <option key={v} value={v}>{t(v, lang)}</option>)}
                            </select>
                            {row.variety === "Other" && (
                              <input className="gt-input mt-1" placeholder={t("Specify variety", lang)} value={row.variety_other} onChange={(e) => updateGradingRow(idx, "variety_other", e.target.value)} />
                            )}
                          </div>
                          <input type="number" min="0" step="0.01" className="gt-input" placeholder={t("Quantity (Qtl)", lang)} value={row.quantity_qtl} onChange={(e) => updateGradingRow(idx, "quantity_qtl", e.target.value.replace(/^-+/, ""))} />
                          <input type="number" min="0" step="0.01" className="gt-input" placeholder={t("Rate (INR/Quintal)", lang)} value={row.rate_inr_per_kg} onChange={(e) => updateGradingRow(idx, "rate_inr_per_kg", e.target.value.replace(/^-+/, ""))} />
                          <button type="button" onClick={() => removeGradingRow(idx)} className="gt-input px-3 text-red-600">×</button>
                        </div>
                      ))}
                      {(form.grading_rows || []).length === 0 && (
                        <div className="text-sm text-[var(--gt-text-muted)]">{t("No rows yet — add at least one grade/variety.", lang)}</div>
                      )}
                    </div>
                  </div>
                )}
                <Field label="Month of Sale" required>
                  <select className="gt-input" value={form.sale_month} onChange={(e) => set("sale_month", e.target.value)}>
                    {MONTHS.map((mo) => <option key={mo} value={mo}>{t(mo, lang)}</option>)}
                  </select>
                </Field>
                <div className="md:col-span-2 gt-card p-3 bg-[#F1EBF7] border-none">
                  <div className="text-xs text-[var(--gt-text-muted)]">{t("Auto-calculated Total Income from Areca", lang)}</div>
                  {hasIncomeInputs ? (
                    <div className="text-xl font-bold text-[var(--gt-purple-dark)]">₹ {computedIncome.toLocaleString("en-IN")}</div>
                  ) : (
                    <div className="text-sm text-[var(--gt-text-muted)]">{t("Enter Yield and Rate Realised to calculate.", lang)}</div>
                  )}
                </div>
              </div>
            </SubSection>

            <SubSection icon={Warehouse} title="Storage & Logistics">
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Areca Stored - Duration (Months)" error={errors.storage_duration_months}><input type="number" step="1" className="gt-input" value={form.storage_duration_months} onChange={(e) => setNonNeg("storage_duration_months", e.target.value)} /></Field>
                <Field label="Storage Source">
                  <select className="gt-input" value={form.storage_source} onChange={(e) => set("storage_source", e.target.value)}>
                    <option value="">{t("Select", lang)}</option>
                    {(opts.storage_source || []).map((o) => <option key={o} value={o}>{t(o, lang)}</option>)}
                  </select>
                </Field>
                {form.storage_source && (
                  <Field label="Availing a Commodity/Warehouse Loan or Pledge Facility on the Stored Commodity?" required>
                    <YesNo value={form.storage_loan_availed} onChange={(v) => set("storage_loan_availed", v)} />
                  </Field>
                )}
                {form.storage_source && form.storage_loan_availed === "Yes" && (
                  <>
                    <Field label="Loan/Pledge Amount (INR)" required error={errors.storage_loan_amount_inr} hint="Required because a commodity/warehouse loan or pledge is being availed"><input max="100000000" type="number" className="gt-input" value={form.storage_loan_amount_inr} onChange={(e) => setNonNeg("storage_loan_amount_inr", e.target.value)} /></Field>
                    <Field label="Interest Rate (% per annum)" required error={errors.storage_loan_interest_pct} hint="Required because a commodity/warehouse loan or pledge is being availed"><input type="number" max="50" className="gt-input" value={form.storage_loan_interest_pct} onChange={(e) => setNonNeg("storage_loan_interest_pct", e.target.value)} /></Field>
                    <Field label="Repayment Period (Months)" required error={errors.storage_loan_repayment_months} hint="Required because a commodity/warehouse loan or pledge is being availed"><input type="number" className="gt-input" value={form.storage_loan_repayment_months} onChange={(e) => setNonNeg("storage_loan_repayment_months", e.target.value)} /></Field>
                    {form.storage_source.includes("Warehouse") && (
                      <Field label="Is a Warehouse Receipt Available?"><YesNo value={form.storage_warehouse_receipt} onChange={(v) => set("storage_warehouse_receipt", v)} /></Field>
                    )}
                  </>
                )}
                <Field label="Logistics Provider">
                  <select className="gt-input" value={form.logistics_provider} onChange={(e) => set("logistics_provider", e.target.value)}>
                    <option value="">{t("Select", lang)}</option>
                    {(opts.logistics_provider || []).map((o) => <option key={o} value={o}>{t(o, lang)}</option>)}
                    <option value="Any Other">{t("Any Other", lang)}</option>
                  </select>
                </Field>
                {form.logistics_provider === "Any Other" && (
                  <Field label="Specify Logistics Provider" required error={errors.logistics_provider_other} hint="Required because 'Any Other' logistics provider is selected">
                    <input className="gt-input" value={form.logistics_provider_other} onChange={(e) => set("logistics_provider_other", e.target.value)} />
                  </Field>
                )}
                {form.logistics_provider && (
                  <Field label="Provider-wise Cost (INR/Qtl)" error={errors.logistics_cost_inr_per_qtl}><input type="number" step="0.01" className="gt-input" value={form.logistics_cost_inr_per_qtl} onChange={(e) => setNonNeg("logistics_cost_inr_per_qtl", e.target.value)} /></Field>
                )}
              </div>
            </SubSection>
          </>
        )}

        {step === 3 && (
          <>
            <SubSection icon={TriangleAlert} title="Cultivation Challenges" first>
              <Field label="Challenges in Areca Cultivation">
                <MultiChip options={opts.cultivation_challenges || []} value={form.cultivation_challenges} onToggle={(v) => toggleMulti("cultivation_challenges", v)} />
              </Field>
              {form.cultivation_challenges?.includes("Availability of Farm Machinery") && (
                <Field label="Average Waiting Period for Farm Machinery (Days)" required error={errors.machinery_waiting_days} hint="Required because 'Availability of Farm Machinery' is selected as a challenge">
                  <input type="number" className="gt-input" value={form.machinery_waiting_days} onChange={(e) => setNonNeg("machinery_waiting_days", e.target.value)} />
                </Field>
              )}
              {form.cultivation_challenges?.includes("Other") && (
                <Field label="Specify Challenge" required error={errors.cultivation_challenges_other} hint="Required because 'Other' challenge is selected">
                  <input className="gt-input" value={form.cultivation_challenges_other} onChange={(e) => set("cultivation_challenges_other", e.target.value)} />
                </Field>
              )}
            </SubSection>

            <SubSection icon={Sprout} title="Other Crops (Diversification)">
              <div className="grid md:grid-cols-2 gap-x-4">
                {[2, 3].map((n) => (
                  <div key={n} className="md:col-span-2 border-t border-[var(--gt-border)] pt-3 mt-1 first:border-none first:pt-0 first:mt-0">
                    <div className="font-semibold text-sm mb-2 text-[var(--gt-purple-dark)]">Crop {n}</div>
                    <div className="grid md:grid-cols-2 gap-x-4">
                      <Field label="Crop Name">
                        <input className="gt-input" list="crop-list" value={form[`crop${n}_name`]} onChange={(e) => set(`crop${n}_name`, e.target.value)} />
                      </Field>
                      <Field label="Area under Cultivation (Acres)" error={errors[`crop${n}_area_acres`]}><input type="number" className="gt-input" value={form[`crop${n}_area_acres`]} onChange={(e) => setNonNeg(`crop${n}_area_acres`, e.target.value)} /></Field>
                      <Field label="Total Yield (Quintal)" error={errors[`crop${n}_yield`]}><input type="number" className="gt-input" value={form[`crop${n}_yield`]} onChange={(e) => setNonNeg(`crop${n}_yield`, e.target.value)} /></Field>
                      <Field label="Rate (INR/Kg)" error={errors[`crop${n}_rate`]}><input type="number" className="gt-input" value={form[`crop${n}_rate`]} onChange={(e) => setNonNeg(`crop${n}_rate`, e.target.value)} /></Field>
                    </div>
                  </div>
                ))}
                <datalist id="crop-list">{crops.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
            </SubSection>
          </>
        )}

        {step === 4 && (
          <>
            <SubSection icon={Wrench} title="Farm Mechanisation" first>
              <Field label="Farm Mechanisation - Own Machines"><MultiChip options={machines} value={form.mech_owned} onToggle={(v) => toggleMulti("mech_owned", v)} /></Field>
              {form.mech_owned.includes("Any Other") && (
                <Field label="Specify Owned Machine" required error={errors.mech_owned_other} hint="Required because 'Any Other' machine is selected as owned">
                  <input className="gt-input" value={form.mech_owned_other} onChange={(e) => set("mech_owned_other", e.target.value)} />
                </Field>
              )}
              <Field label="Farm Mechanisation - Rented"><MultiChip options={machines} value={form.mech_rented} onToggle={(v) => toggleMulti("mech_rented", v)} /></Field>
              {form.mech_rented.includes("Any Other") && (
                <Field label="Specify Rented Machine" required error={errors.mech_rented_other} hint="Required because 'Any Other' machine is selected as rented">
                  <input className="gt-input" value={form.mech_rented_other} onChange={(e) => set("mech_rented_other", e.target.value)} />
                </Field>
              )}
              {form.mech_rented.length > 0 && (
                <Field label="Hourly Rental Rate per Machine (INR)" error={errors.mech_rental_rate}>
                  <div className="flex flex-col gap-2">
                    {form.mech_rented.map((mc: string) => (
                      <div key={mc} className="flex items-center gap-2">
                        <span className="text-sm flex-1">{mc}</span>
                        <input
                          type="number"
                          className="gt-input w-32"
                          value={form.mech_rental_rate[mc] || ""}
                          onChange={(e) => set("mech_rental_rate", { ...form.mech_rental_rate, [mc]: e.target.value.replace(/^-+/, "") })}
                        />
                      </div>
                    ))}
                  </div>
                </Field>
              )}
              {form.mech_owned.length > 0 && (
                <Field label="If Owned, Are the Machines Financed?" required><YesNo value={form.mech_financed} onChange={(v) => set("mech_financed", v)} /></Field>
              )}
              {form.mech_owned.length > 0 && form.mech_financed === "Yes" && (
                <div className="grid md:grid-cols-2 gap-x-4">
                  <Field label="Loan Amount (INR Lakh)" required error={errors.mech_loan_amount_inr_lakh} hint="Required because the machines are financed"><input max="1000" type="number" className="gt-input" value={form.mech_loan_amount_inr_lakh} onChange={(e) => setNonNeg("mech_loan_amount_inr_lakh", e.target.value)} /></Field>
                  <Field label="Interest Rate (% per annum)" required error={errors.mech_loan_interest_pct} hint="Required because the machines are financed"><input type="number" max="50" className="gt-input" value={form.mech_loan_interest_pct} onChange={(e) => setNonNeg("mech_loan_interest_pct", e.target.value)} /></Field>
                </div>
              )}
            </SubSection>

            <SubSection icon={Truck} title="Input Supply Chain">
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Source of Input Purchase" required error={errors.input_source}>
                  {/* CR-14: multiple input sources can apply (e.g. both a Cooperative
                      Society and a Local Input Shop), so this is multi-select. */}
                  <MultiChip options={opts.input_source || []} value={form.input_source || []} onToggle={(v) => toggleMulti("input_source", v)} />
                </Field>
                {form.input_source?.includes("Other") && (
                  <Field label="Specify Input Source" required error={errors.input_source_other} hint="Required because 'Other' input source is selected">
                    <input className="gt-input" value={form.input_source_other} onChange={(e) => set("input_source_other", e.target.value)} />
                  </Field>
                )}
                <Field label="Distance of Input Source (Km)" error={errors.input_distance_km}><input type="number" min="0" step="0.1" className="gt-input" value={form.input_distance_km} onChange={(e) => setNonNeg("input_distance_km", e.target.value)} /></Field>
                <Field label="Challenges in Input Purchase">
                  {/* CR-14: multi-select — a farmer can face more than one challenge. */}
                  <MultiChip options={opts.input_challenges || []} value={form.input_challenges || []} onToggle={(v) => toggleMulti("input_challenges", v)} />
                </Field>
                {form.input_challenges?.includes("Other") && (
                  <Field label="Specify Challenge" required error={errors.input_challenges_other} hint="Required because 'Other' challenge is selected">
                    <input className="gt-input" value={form.input_challenges_other} onChange={(e) => set("input_challenges_other", e.target.value)} />
                  </Field>
                )}
                {form.input_challenges?.includes("Availability") && (
                  <Field label="Average Delay in Receiving Inputs (Days)" required error={errors.input_purchase_delay_days} hint="Required because 'Availability' is selected as a challenge">
                    <input type="number" min="0" step="1" className="gt-input" value={form.input_purchase_delay_days} onChange={(e) => setNonNeg("input_purchase_delay_days", e.target.value)} />
                  </Field>
                )}
              </div>
            </SubSection>

            <SubSection icon={Smartphone} title="Technology Adoption">
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Associated with any Technology Solution" required><YesNo value={form.tech_adoption} onChange={(v) => set("tech_adoption", v)} /></Field>
                {form.tech_adoption === "Yes" && (
                  <Field label="Details" required error={errors.tech_adoption_detail} hint="Required because a technology solution is used"><input className="gt-input" value={form.tech_adoption_detail} onChange={(e) => set("tech_adoption_detail", e.target.value)} /></Field>
                )}
              </div>
            </SubSection>
          </>
        )}

        {step === 5 && (
          <>
            <SubSection icon={Coins} title="Household Income" first>
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Total Household Income" required error={errors.total_household_income_bracket}>
                  <select className="gt-input" value={form.total_household_income_bracket} onChange={(e) => set("total_household_income_bracket", e.target.value)}>
                    <option value="">{t("Select", lang)}</option>
                    <option value="<10000">{t("Less than ₹10,000", lang)}</option>
                    <option value="10000-1L">{t("₹10,000 to ₹1 Lakh", lang)}</option>
                    <option value="1L-10L">{t("₹1 Lakh to ₹10 Lakh", lang)}</option>
                    <option value=">10L">{t("Greater than ₹10 Lakh", lang)}</option>
                  </select>
                </Field>
                <Field label="Non-Farm Income Source(s)"><MultiChip options={opts.non_farm_income_source || []} value={form.non_farm_income_source} onToggle={(v) => toggleMulti("non_farm_income_source", v)} /></Field>
                {form.non_farm_income_source?.includes("Other") && (
                  <Field label="Specify Non-Farm Income Source" required error={errors.non_farm_income_source_other} hint="Required because 'Other' income source is selected">
                    <input className="gt-input" value={form.non_farm_income_source_other} onChange={(e) => set("non_farm_income_source_other", e.target.value)} />
                  </Field>
                )}
                <Field label="Do You Own a Bank Account?" required>
                  <YesNo value={form.bank_account} onChange={(v) => { set("bank_account", v); if (v === "No") { set("overdraft_facility", "No"); set("overdraft_limit_inr_lakh", ""); } }} />
                </Field>
                {form.bank_account === "Yes" && (
                  <Field label="Overdraft Facility Available?" required><YesNo value={form.overdraft_facility} onChange={(v) => set("overdraft_facility", v)} /></Field>
                )}
                {form.bank_account === "Yes" && form.overdraft_facility === "Yes" && (
                  <Field label="Overdraft Limit (INR Lakh)" required error={errors.overdraft_limit_inr_lakh} hint="Required because Overdraft Facility = Yes"><input max="1000" step="0.01" type="number" className="gt-input" value={form.overdraft_limit_inr_lakh} onChange={(e) => setNonNeg("overdraft_limit_inr_lakh", e.target.value)} /></Field>
                )}
              </div>
            </SubSection>

            <SubSection icon={CreditCard} title="Credit & Finance">
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Credit Linkage" required><YesNo value={form.credit_linkage} onChange={(v) => set("credit_linkage", v)} /></Field>
                {form.credit_linkage === "Yes" && (
                  <>
                    <Field label="Source" required error={errors.credit_source} hint="Required because Credit Linkage = Yes">
                      <select className="gt-input" value={form.credit_source} onChange={(e) => set("credit_source", e.target.value)}>
                        <option value="">{t("Select", lang)}</option>
                        {(opts.credit_source || []).map((o) => <option key={o} value={o}>{t(o, lang)}</option>)}
                      </select>
                    </Field>
                    {form.credit_source === "Other" && (
                      <Field label="Specify Credit Source" required error={errors.credit_source_other} hint="Required because 'Other' credit source is selected">
                        <input className="gt-input" value={form.credit_source_other} onChange={(e) => set("credit_source_other", e.target.value)} />
                      </Field>
                    )}
                    <Field label="Amount (INR)" required error={errors.credit_amount_inr} hint="Required because Credit Linkage = Yes"><input max="100000000" step="0.01" type="number" className="gt-input" value={form.credit_amount_inr} onChange={(e) => setNonNeg("credit_amount_inr", e.target.value)} /></Field>
                    <Field label="Interest Rate (% per annum)" required error={errors.credit_interest_rate_pct} hint="Required because Credit Linkage = Yes"><input type="number" max="50" step="0.01" className="gt-input" value={form.credit_interest_rate_pct} onChange={(e) => setNonNeg("credit_interest_rate_pct", e.target.value)} /></Field>
                    <Field label="Repayment Period (Months)" required error={errors.credit_repayment_months} hint="Required because Credit Linkage = Yes"><input type="number" step="1" className="gt-input" value={form.credit_repayment_months} onChange={(e) => setNonNeg("credit_repayment_months", e.target.value)} /></Field>
                    <Field label="Current Outstanding Loan Amount (INR Lakh)" error={errors.credit_outstanding_inr_lakh}><input max="1000" step="0.01" type="number" className="gt-input" value={form.credit_outstanding_inr_lakh} onChange={(e) => setNonNeg("credit_outstanding_inr_lakh", e.target.value)} /></Field>
                  </>
                )}
                {form.credit_linkage === "No" && (
                  <>
                    <Field label="Outcome of Previous Loan Application" required error={errors.loan_application_outcome} hint="Required because Credit Linkage = No">
                      <select className="gt-input" value={form.loan_application_outcome} onChange={(e) => set("loan_application_outcome", e.target.value)}>
                        <option value="">{t("Select", lang)}</option>
                        <option value="Approved">{t("Approved", lang)}</option><option value="Partially Approved">{t("Partially Approved", lang)}</option><option value="Pending">{t("Pending", lang)}</option><option value="Rejected">{t("Rejected", lang)}</option>
                      </select>
                    </Field>
                    {form.loan_application_outcome === "Rejected" && (
                      <Field label="Reason for Rejection" required error={errors.loan_rejection_reason} hint="Required because the previous loan application was Rejected">
                        <select className="gt-input" value={form.loan_rejection_reason} onChange={(e) => set("loan_rejection_reason", e.target.value)}>
                          <option value="">{t("Select", lang)}</option>
                          {(opts.loan_rejection_reason || []).map((o) => <option key={o} value={o}>{t(o, lang)}</option>)}
                        </select>
                      </Field>
                    )}
                    {form.loan_application_outcome === "Rejected" && form.loan_rejection_reason === "Other" && (
                      <Field label="Specify Reason" required error={errors.loan_rejection_reason_other} hint="Required because 'Other' rejection reason is selected">
                        <input className="gt-input" value={form.loan_rejection_reason_other} onChange={(e) => set("loan_rejection_reason_other", e.target.value)} />
                      </Field>
                    )}
                  </>
                )}
                <Field label="Gap Between Required Credit and Credit Availed (INR Lakh)" error={errors.credit_gap_inr_lakh}><input max="1000" step="0.01" type="number" className="gt-input" value={form.credit_gap_inr_lakh} onChange={(e) => setNonNeg("credit_gap_inr_lakh", e.target.value)} /></Field>
                <Field label="Do You Have a KCC Account?" required><YesNo value={form.kcc_account} onChange={(v) => set("kcc_account", v)} /></Field>
                {form.kcc_account === "Yes" && (
                  <Field label="KCC Limit (INR Lakh)" required error={errors.kcc_limit_inr_lakh} hint="Required because you have a KCC Account"><input max="1000" step="0.01" type="number" className="gt-input" value={form.kcc_limit_inr_lakh} onChange={(e) => setNonNeg("kcc_limit_inr_lakh", e.target.value)} /></Field>
                )}
              </div>
            </SubSection>

            <SubSection icon={Landmark} title="Government Schemes">
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Availed any Government Scheme (Last 2 Years)" required><YesNo value={form.scheme_availed} onChange={(v) => set("scheme_availed", v)} /></Field>
                {form.scheme_availed === "Yes" && (
                  <>
                    <Field label="Name of Scheme" required error={errors.scheme_name} hint="Required because a Government Scheme was availed — select all that apply">
                      {/* CR-15: a farmer can be enrolled in more than one scheme, so
                          this is a multi-select over the master list. A native
                          <datalist> was found unreliable on Android Chrome (OBS-013),
                          which is why this stays tappable chips rather than a
                          dropdown — plus a free-text "other" entry for anything not
                          yet in the master list. */}
                      {schemes.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {schemes.map((s) => {
                            const selected = (form.scheme_name || []).includes(s);
                            return (
                              <button
                                type="button"
                                key={s}
                                onClick={() => toggleMulti("scheme_name", s)}
                                className={`text-[11px] px-2 py-1 rounded-full border whitespace-nowrap flex items-center gap-1 ${
                                  selected
                                    ? "gt-gradient text-white border-transparent"
                                    : "bg-white text-[var(--gt-text-muted)] border-[var(--gt-border)]"
                                }`}
                              >
                                {selected && <CheckCircle2 size={11} />} {s}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <input
                        className="gt-input mt-1.5"
                        value={schemeNameInput}
                        onChange={(e) => setSchemeNameInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && schemeNameInput.trim()) {
                            e.preventDefault();
                            toggleMulti("scheme_name", schemeNameInput.trim());
                            setSchemeNameInput("");
                          }
                        }}
                        placeholder="Type a scheme not listed above, then press Enter"
                      />
                      {(form.scheme_name || []).filter((s: string) => !schemes.includes(s)).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {(form.scheme_name || []).filter((s: string) => !schemes.includes(s)).map((s: string) => (
                            <span key={s} className="text-[11px] px-2 py-1 rounded-full gt-gradient text-white flex items-center gap-1">
                              {s}
                              <button type="button" onClick={() => toggleMulti("scheme_name", s)} className="font-bold">×</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </Field>
                    <Field label="Scheme Benefits" required error={errors.scheme_benefits} hint="Required because a Government Scheme was availed">
                      <textarea className="gt-input" rows={3} value={form.scheme_benefits} onChange={(e) => set("scheme_benefits", e.target.value)} />
                    </Field>
                  </>
                )}
              </div>
            </SubSection>
          </>
        )}

        {step === 6 && (
          <>
            <SubSection icon={Droplets} title="Irrigation" first>
              <Field label="Source of Irrigation" required error={errors.irrigation_source}><MultiChip options={opts.irrigation_source || []} value={form.irrigation_source} onToggle={(v) => toggleMulti("irrigation_source", v)} /></Field>
              <Field label="Challenges in Irrigation"><input className="gt-input" value={form.irrigation_challenges} onChange={(e) => set("irrigation_challenges", e.target.value)} /></Field>
            </SubSection>

            <SubSection icon={FlaskConical} title="Soil Health & Crop Insurance">
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Soil Test Conducted" required><YesNo value={form.soil_test_done} onChange={(v) => set("soil_test_done", v)} /></Field>
                <Field label="Crop Insurance" required><YesNo value={form.crop_insurance} onChange={(v) => set("crop_insurance", v)} /></Field>
                {form.crop_insurance === "Yes" && (
                  <Field label="Insurance Detail" required error={errors.crop_insurance_detail} hint="Required because Crop Insurance = Yes"><input className="gt-input" value={form.crop_insurance_detail} onChange={(e) => set("crop_insurance_detail", e.target.value)} /></Field>
                )}
                <Field label="Natural Calamity (Flood/Drought) in Region in Last 5 Years?" required><YesNo value={form.natural_calamity_5yr} onChange={(v) => set("natural_calamity_5yr", v)} /></Field>
              </div>
            </SubSection>
          </>
        )}

        {step === 7 && (
          <>
            <div className="grid md:grid-cols-2 gap-x-4 mb-2">
              <Field label="Geo-location">
                {geoStatus === "idle" && (
                  <button type="button" className="gt-btn-secondary flex items-center gap-1.5 w-fit" onClick={captureGeo}><MapPin size={16} /> {t("Detect My Location", lang)}</button>
                )}
                {geoStatus === "locating" && (
                  <div className="text-xs flex items-center gap-1.5 text-[var(--gt-text-muted)]"><MapPin size={14} className="animate-pulse" /> {t("Fetching device GPS…", lang)}</div>
                )}
                {geoStatus === "done" && form.geo_lat && (
                  <div className="text-xs flex items-center gap-1.5 text-[var(--gt-success)] font-medium">
                    <CheckCircle2 size={14} /> Lat {form.geo_lat}, Long {form.geo_long}
                  </div>
                )}
                {geoStatus === "error" && (
                  <div className="flex flex-col gap-2">
                    <div className="text-xs text-[var(--gt-danger)]">{t(geoError || "Could not access device GPS. Enable location and retry.", lang)}</div>
                    <div className="text-[11px] text-[var(--gt-text-muted)]">
                      {t("If your browser previously blocked location for this site, \"Retry\" won't help — clear it from the browser's site settings (tap the lock icon next to the address bar → Permissions → Location) and try again.", lang)}
                    </div>
                    <button type="button" className="gt-btn-secondary flex items-center gap-1.5 w-fit" onClick={captureGeo}><MapPin size={16} /> {t("Retry GPS", lang)}</button>
                  </div>
                )}
                {geoStatus === "done" && (
                  <button type="button" className="text-xs text-[var(--gt-purple)] underline mt-1.5" onClick={captureGeo}>{t("Refresh location", lang)}</button>
                )}
              </Field>
              <Field label="Field Photo (geo-tagged)">
                <button type="button" className="gt-btn-secondary flex items-center gap-1.5" onClick={attachPhoto} disabled={photoBusy}>
                  <Camera size={16} /> {t(photoBusy ? "Opening camera…" : form.field_photo ? "Retake Photo" : "Attach Photo", lang)}
                </button>
                {photoError && (
                  <div className="flex items-center gap-2 bg-red-50 border border-[var(--gt-danger)]/30 text-[var(--gt-danger)] text-xs rounded-lg px-3 py-2 mt-2">
                    <AlertCircle size={14} /> {photoError}
                  </div>
                )}
                {form.field_photo && (
                  <div className="mt-2 flex items-start gap-3">
                    <img src={form.field_photo} alt="Field capture" className="w-24 h-24 object-cover rounded-lg border border-[var(--gt-border)]" />
                    <div className="text-xs text-[var(--gt-text-muted)]">
                      {form.geo_lat ? (
                        <div className="text-[var(--gt-success)] font-medium flex items-center gap-1"><MapPin size={12} /> Lat {form.geo_lat}, Long {form.geo_long}</div>
                      ) : (
                        <div className="text-[var(--gt-danger)]">No GPS fix yet — tap "Detect My Location" above so this photo is geo-tagged.</div>
                      )}
                      <button type="button" className="text-[var(--gt-purple)] underline mt-1" onClick={() => set("field_photo", "")}>{t("Remove photo", lang)}</button>
                    </div>
                  </div>
                )}
              </Field>
            </div>

            <div className="mb-2">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold text-sm text-[var(--gt-purple-dark)]">{t("Plot / Land Records", lang)} <span className="text-[var(--gt-danger)]">*</span></div>
                <button type="button" onClick={addPlot} className="text-sm text-[var(--gt-purple-dark)] font-medium">+ {t("Add Plot", lang)}</button>
              </div>
              <p className="text-xs text-[var(--gt-text-muted)] mb-3">
                {t("A farmer may hold more than one plot, including in different locations. Add one entry per plot — each needs a reported area. Capturing a GPS-measured boundary (draw on map, upload Excel/CSV, or walk with the device GPS) is optional for now and can be added later from the farmer's record.", lang)}
              </p>

              <div className="space-y-4">
                {plots.map((plot) => {
                  const area = areaInAcres(plot.points);
                  const validation = validateBoundary(plot.points);
                  const reported = parseFloat(plot.reportedArea) || 0;
                  const diffPct = validation.valid && reported > 0 ? Math.abs(area - reported) / reported * 100 : null;
                  return (
                    <div key={plot.key} className="gt-card p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <input className="gt-input flex-1" value={plot.label} onChange={(e) => updatePlot(plot.key, { label: e.target.value })} placeholder={t("Plot label", lang)} />
                        {plots.length > 1 && (
                          <button type="button" onClick={() => removePlot(plot.key)} className="gt-input px-3 text-red-600 shrink-0">×</button>
                        )}
                      </div>
                      <Field label="Reported Area (Acres)" required>
                        <input type="number" min="0" step="0.01" className="gt-input" value={plot.reportedArea} onChange={(e) => updatePlot(plot.key, { reportedArea: e.target.value.replace(/^-+/, "") })} />
                      </Field>

                      <div className="flex gap-2 overflow-x-auto pb-1 mb-2 mt-2">
                        {PLOT_METHODS.map(({ key, label, icon: Icon }) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => switchPlotMethod(plot.key, key)}
                            className={`shrink-0 flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-full border whitespace-nowrap transition-colors ${
                              plot.method === key
                                ? "gt-gradient text-white border-transparent shadow-sm"
                                : "bg-white text-[var(--gt-text-muted)] border-[var(--gt-border)]"
                            }`}
                          >
                            <Icon size={15} /> {t(label, lang)}
                          </button>
                        ))}
                      </div>

                      <div className="gt-card p-3 flex items-center gap-4 text-sm mb-2 flex-wrap">
                        <span><b>{plot.points.length}</b> {t("vertices", lang)}</span>
                        <span className="text-[var(--gt-purple-dark)] font-semibold">{t("GPS-measured:", lang)} {formatArea(area, lang)}</span>
                        <span className="text-[var(--gt-text-muted)]">{t("Reported:", lang)} {reported.toFixed(2)} {t("acres", lang)}</span>
                        {diffPct !== null && (
                          <span className={`text-xs font-medium ${diffPct > 10 ? "text-[var(--gt-danger)]" : "text-[var(--gt-success)]"}`}>
                            {diffPct > 10 ? t("⚠ differs by", lang) : t("✓ matches within", lang)} {diffPct.toFixed(0)}%
                          </span>
                        )}
                      </div>

                      <div className="gt-card p-4">
                        {plot.method === "draw" && <DrawMapTab points={plot.points} onChange={(pts) => updatePlot(plot.key, { points: pts })} />}
                        {plot.method === "excel" && <ExcelUploadTab onParsed={(pts) => updatePlot(plot.key, { points: pts })} />}
                        {plot.method === "gps" && <GpsCaptureTab points={plot.points} onChange={(pts) => updatePlot(plot.key, { points: pts })} />}
                      </div>

                      {plot.points.length > 0 && !validation.valid && (
                        <div className="flex items-center gap-2 bg-red-50 border border-[var(--gt-danger)]/30 text-[var(--gt-danger)] text-xs rounded-lg px-3 py-2 mt-3">
                          <AlertCircle size={14} /> {validation.error}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="gt-card p-3 mt-3 bg-[#F1EBF7] border-none flex items-center gap-4 text-sm flex-wrap">
                <span className="font-semibold text-[var(--gt-purple-dark)]">{t("Total across all plots:", lang)}</span>
                <span>{t("Reported", lang)} <b>{totalReportedArea.toFixed(2)} {t("acres", lang)}</b></span>
                <span>{t("GPS-Measured", lang)} <b>{totalGpsArea.toFixed(2)} {t("acres", lang)}</b></span>
              </div>

              {!plotsValidation.valid && (
                <div className="flex items-center gap-2 bg-red-50 border border-[var(--gt-danger)]/30 text-[var(--gt-danger)] text-xs rounded-lg px-3 py-2 mt-3">
                  <AlertCircle size={14} /> {plotsValidation.error}
                </div>
              )}
            </div>

            <div className="gt-card p-4 bg-[#F1EBF7] border-none">
              <div className="font-semibold text-sm mb-2 text-[var(--gt-purple-dark)]">{t("Review Summary", lang)}</div>
              <div className="grid md:grid-cols-2 gap-1 text-sm">
                <div>{t("Farmer:", lang)} <b>{form.farmer_name}</b> ({form.farmer_id || t("ID assigned on submit", lang)})</div>
                <div>{t("Location:", lang)} <b>{form.village}, {form.taluka}, {form.district}</b></div>
                <div>{t("Areca Area:", lang)} <b>{form.areca_area_acres} {t("acres", lang)}</b>, {form.areca_plant_count} {t("plants", lang)}</div>
                <div>{t("Yield:", lang)} <b>{form.yield_raw_qtl} {t("Qtl", lang)}</b></div>
                <div>{t("Sale:", lang)} <b>{t(form.sale_type, lang)}</b> {t("via", lang)} {t(form.marketing_channel, lang)}</div>
                <div>{t("Net Income:", lang)} <b className="text-[var(--gt-purple-dark)]">₹{computedIncome.toLocaleString("en-IN")}</b></div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex justify-between gap-3">
        <button className="gt-btn-secondary flex items-center gap-1" onClick={back}>
          <ChevronLeft size={16} /> {t(step === 0 ? "Cancel" : "Back", lang)}
        </button>
        <div className="flex items-center gap-2">
          {form.status !== "submitted" && (
            <button className="gt-btn-secondary flex items-center gap-1.5" onClick={saveDraft} disabled={savingDraft || submitting}>
              <Save size={16} /> {t(savingDraft ? "Saving…" : "Save as Draft", lang)}
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button className="gt-btn-primary flex items-center gap-1" onClick={next}>
              {t("Next", lang)} <ChevronRight size={16} />
            </button>
          ) : (
            <button className="gt-btn-primary flex items-center gap-1.5" onClick={submit} disabled={submitting}>
              <CheckCircle2 size={16} /> {t(submitting ? "Submitting…" : "Submit Survey", lang)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

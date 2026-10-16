# Arecanut Farmer Survey — Test Cases (Web + Mobile)

Covers the web app (`https://arecanut-frontend.vercel.app`) and the Android
app (Capacitor-wrapped build of the same codebase, currently v5.0 /
versionCode 5). Both share the same UI code, so most test cases apply
identically to both — the **Platform** column calls out anything mobile- or
web-specific (camera/GPS hardware, offline queue behavior, browser-only
flows like URL-based password reset).

**Test accounts** (production seed data — replace passwords if rotated):
| Username | Role | Password |
|---|---|---|
| `admin` | Admin | `Admin@2024Gt` |
| `enumerator1` | Field | `Field@2024Gt` |
| `enumerator2` | Field | `Field@2024Gt` |

Legend: **P** = Priority (H/M/L), **Platform** = Web / Mobile / Both.

---

## 1. Authentication

| ID | Title | Preconditions | Steps | Expected Result | P | Platform |
|---|---|---|---|---|---|---|
| AUTH-01 | Successful login | Valid credentials exist | 1. Open app → Login screen. 2. Enter valid username/password. 3. Tap Sign In. | Redirected to Dashboard; nav shows options matching the user's role. | H | Both |
| AUTH-02 | Login with wrong password | — | Enter valid username, wrong password, submit. | Error message shown, stays on login screen, no token stored. | H | Both |
| AUTH-03 | Login with unknown username | — | Enter a username that doesn't exist. | Generic "invalid credentials" error (does not reveal whether the username exists). | M | Both |
| AUTH-04 | Account lockout after repeated failures | — | Submit wrong password 5 times in a row for the same user. | Account locks for 15 minutes; further attempts (even correct password) are rejected until lockout expires. | H | Both |
| AUTH-05 | Session persists across refresh | Logged in | Reload the page / relaunch the app. | User remains logged in (access + refresh token in storage); no forced re-login. | H | Both |
| AUTH-06 | Silent token refresh on expiry | Logged in, access token expired but refresh token valid | Perform any authenticated action after access-token TTL has passed. | Request succeeds transparently via silent refresh; user is not bounced to login. | M | Both |
| AUTH-07 | Forced logout when refresh also fails | Refresh token expired/revoked | Perform an authenticated action. | User is redirected to Login with a "session expired" message; tokens cleared. | H | Both |
| AUTH-08 | Logout | Logged in | Tap Log Out. | Tokens cleared, refresh token revoked server-side, redirected to Login. | H | Both |
| AUTH-09 | Forgot password — valid identifier | — | On Login, tap "Forgot password?", enter a registered username or email, submit. | Generic success message shown (doesn't confirm/deny whether the identifier exists); reset email sent if it matches. | M | Web (reset link is opened in a browser either way) |
| AUTH-10 | Forgot password — unknown identifier | — | Submit an identifier that doesn't exist. | Same generic success message as AUTH-09 (no information leak). | M | Web |
| AUTH-11 | Reset password with valid token | A reset email/link was issued | Open the reset link, enter a new password meeting strength rules, submit. | Password updated; old sessions revoked; can log in with the new password. | H | Web |
| AUTH-12 | Reset password with expired/used token | Token already used once, or >expiry window | Attempt reset again with the same link. | Rejected with "invalid or expired" error; password unchanged. | M | Web |
| AUTH-13 | Password strength enforcement | — | On reset or user-creation, enter a password under 10 chars, or missing an uppercase letter/digit. | Rejected client- and server-side with a specific message (length / uppercase / digit). | M | Both |
| AUTH-14 | Disabled user cannot log in | An admin has disabled a field user (see USR-08) | Attempt login with that user's credentials. | Login rejected even with correct password. | H | Both |

---

## 2. Role-Based Access Control (2 roles: Admin / Field)

| ID | Title | Preconditions | Steps | Expected Result | P | Platform |
|---|---|---|---|---|---|---|
| RBAC-01 | Admin sees full navigation | Logged in as `admin` | Observe nav bar (desktop) / bottom nav (mobile). | All items visible: Dashboard, New Survey Entry, Farmer Records, Plots Map, Master Data, Users. | H | Both |
| RBAC-02 | Field user sees only granted modules | Logged in as a field user with only `survey_entry` granted | Observe nav. | Only Dashboard + New Survey Entry visible; no Farmer Records / Plots / Master Data / Users links. | H | Both |
| RBAC-03 | Direct URL navigation is blocked, not just hidden | Logged in as a field user without `farmer_records` | Manually navigate to `/farmers` (address bar or deep link). | Redirected to Dashboard (`/`) — the route guard blocks it server-independent of nav visibility. | H | Web (mobile: same SPA routing inside the WebView) |
| RBAC-04 | Field user with partial permissions | Field user granted only `plots_map` | Log in; try `/entry`, `/farmers`, `/plots`. | `/entry` and `/farmers` redirect to Dashboard; `/plots` loads normally. | H | Both |
| RBAC-05 | Admin has implicit access to everything | Logged in as `admin`, admin has no `permissions` set | Visit every route (`/entry`, `/farmers`, `/plots`, `/masters`, `/users`). | All load successfully — admin bypasses the permission check entirely. | H | Both |
| RBAC-06 | Backend enforces permissions independent of UI | Logged in as a field user without `farmer_records` | Call `GET /api/surveys` directly (e.g. via curl/Postman) with that user's token. | HTTP 403 `Missing permission: farmer_records` — proves the UI gating isn't the only defense. | H | API |
| RBAC-07 | `DELETE /api/surveys/{id}` is admin-only regardless of granted permissions | Field user granted `farmer_records` (which includes edit) | Attempt to delete a survey (API call or, if a delete control exists, via UI). | HTTP 403 — delete is never exposed as a grantable module permission. | M | API |
| RBAC-08 | Non-admin blocked from `/api/users` | Field user, any permission set | Call `GET /api/users` with a field user's token. | HTTP 403 `Not permitted for this role`. | H | API |
| RBAC-09 | Non-admin blocked from `/api/admin/master-data/*` | Field user | Call `GET /api/admin/master-data/district` with a field user's token. | HTTP 403. | H | API |

---

## 3. User Management (Admin-only)

| ID | Title | Preconditions | Steps | Expected Result | P | Platform |
|---|---|---|---|---|---|---|
| USR-01 | View user list | Logged in as admin | Go to Users. | Table lists all users with name, username, email, role, granted modules, active status. | H | Both |
| USR-02 | Create a field user with a subset of permissions | Logged in as admin | Tap New User; fill username/name/password; select role = Field Team; check only "New Survey Entry"; save. | User created; list shows the new user with only that one module listed under "Modules". | H | Both |
| USR-03 | Create a field user with all three modules | — | Same as USR-02 but check all three checkboxes. | User created with `survey_entry, farmer_records, plots_map`. | M | Both |
| USR-04 | Duplicate username is rejected | A user named `fieldtest` already exists | Attempt to create another user with username `fieldtest`. | Rejected with "username already taken" error; form stays open. | M | Both |
| USR-05 | Weak password rejected at creation | — | Attempt to create a user with password `abc123` (too short / no uppercase). | Rejected with the specific strength-rule violated. | M | Both |
| USR-06 | **Second admin cannot be created** | An admin account already exists | In the New User form, attempt to select role = Admin. | The Admin option is disabled with an explanatory note ("An admin account already exists…"); if attempted via direct API call, server returns HTTP 400. | H | Both + API |
| USR-07 | Edit a field user's permissions | A field user exists with 1 module granted | Open Edit on that user, check a second module, save. | User's module list updates immediately in the table; that user's nav (on next login/refresh) reflects the new access. | H | Both |
| USR-08 | Disable a field user | A field user exists and is active | Tap "Disable" next to a field user. | Status flips to "Disabled"; that user can no longer log in (see AUTH-14). | H | Both |
| USR-09 | Re-enable a disabled user | A field user is disabled | Tap "Enable". | Status flips back to Active; user can log in again. | M | Both |
| USR-10 | Admin toggle not offered for the admin row | Viewing the users table | Observe the admin's row. | No Disable/Enable button next to the admin account (only Edit). | M | Both |
| USR-11 | **Sole admin cannot be demoted** | Only one admin exists | Edit the admin user, attempt to change role to Field Team. | Rejected — either blocked in the UI or, via direct API `PUT /api/users/{id}`, HTTP 400 "sole admin cannot be demoted". | H | Both + API |
| USR-12 | **Sole admin cannot be deactivated** | Only one admin exists | Via API, `PUT /api/users/{admin_id}` with `is_active: false`. | HTTP 400 — rejected. | H | API |
| USR-13 | Change a user's password | Any user exists | Edit user, enter a new password in "New Password", save. | Password updated; that user's existing sessions/refresh tokens are revoked (they must log in again). | M | Both |
| USR-14 | Edit user without changing password | — | Edit user, change only full name, leave password blank, save. | Full name updates; password and active sessions unaffected. | M | Both |
| USR-15 | Field user cannot see or reach Users screen | Logged in as a field user | Observe nav; try navigating to `/users` directly. | No "Users" link in nav; direct navigation redirects to Dashboard. | H | Both |

---

## 4. Master Data Management (Admin-only CRUD)

| ID | Title | Preconditions | Steps | Expected Result | P | Platform |
|---|---|---|---|---|---|---|
| MD-01 | View all master-data tabs | Logged in as admin, on Master Data | Observe tabs. | 8 tabs present: Districts, Talukas, Villages, Societies/FPCs, Other Crops, Government Schemes, Mechanisation Equipment, Dropdown Option Lists. | H | Both |
| MD-02 | Add a District | On Districts tab | Tap Add, enter a unique name, save. | New district appears in the list immediately. | H | Both |
| MD-03 | Duplicate District name rejected | A district "Shivamogga" exists | Attempt to add another "Shivamogga". | Rejected with "already exists" error. | M | Both |
| MD-04 | Add a Taluka under a District (FK dropdown) | At least one district exists | Switch to Talukas tab, tap Add, select a district from the dropdown, enter a taluka name, save. | Taluka created; the list shows the district's name (not just its id) in the District column. | H | Both |
| MD-05 | New parent row appears immediately in FK dropdown | A new District was just added (MD-02) | Switch to Talukas tab, open Add form. | The newly added district appears as a selectable option without needing a page reload. | M | Both |
| MD-06 | Reject a Taluka with a non-existent District id | — (API-level check) | Call `POST /api/admin/master-data/taluka` with `district_id: 999999`. | HTTP 400 "no such record". | M | API |
| MD-07 | Add a Village under a Taluka | At least one taluka exists | Villages tab → Add → select taluka → enter name → save. | Village created and listed with its taluka's name. | H | Both |
| MD-08 | Add a Society / FPC (optional FK fields) | — | Societies tab → Add → enter name, optionally leave District/Taluka blank, toggle "State-level" if applicable → save. | Society created; district/taluka show "—" if left blank, consistent with `is_state_level`. | M | Both |
| MD-09 | Add Crop / Scheme / Machine (simple unique-name tables) | — | On each of Other Crops / Government Schemes / Mechanisation Equipment, add a new unique entry. | Each is created and listed; duplicates rejected same as MD-03. | M | Both |
| MD-10 | Add a Dropdown Option (list_code + label + sort_order) | — | Dropdown Option Lists tab → Add → enter list_code, label, optional sort_order → save. | Option created; appears in the table. | L | Both |
| MD-11 | Edit an existing master row | Any row exists | Tap the pencil/edit icon, change the name, save. | Row updates in place; any dependent rows' FK-display text (e.g. talukas under a renamed district) reflects the new name on next load. | H | Both |
| MD-12 | **Delete blocked when referenced elsewhere** | A District has at least one Taluka under it | Attempt to delete that District. | Rejected with "Cannot delete — still referenced by existing Talukas records."; row remains. | H | Both |
| MD-13 | Delete succeeds after dependents removed | Continuing MD-12 | Delete the referencing Taluka first, then retry deleting the District. | Taluka deletes successfully; District then deletes successfully. | H | Both |
| MD-14 | Delete a leaf-level row with no dependents | A Crop/Scheme/Machine/Option row with nothing referencing it | Delete it. | Deletes immediately without any blocking message. | M | Both |
| MD-15 | Deleting a non-existent row | — | Call `DELETE /api/admin/master-data/district/999999`. | HTTP 404. | L | API |
| MD-16 | All master-data mutations are audited | Any create/update/delete above performed | (Backend check) query the `audit_log` table for the action. | A row exists with the correct `action` (`master_data_create`/`update`/`delete`), `user`, `resource`, and timestamp. | M | Backend/DB |
| MD-17 | Master-data edits reflect in the survey wizard's dropdowns | A new District/Taluka/Village added via Master Data | Go to New Survey Entry, use the village autocomplete. | The newly added village (and its auto-filled taluka/district) is selectable. | H | Both |

---

## 5. Dashboard

| ID | Title | Preconditions | Steps | Expected Result | P | Platform |
|---|---|---|---|---|---|---|
| DASH-01 | KPIs load on open | Logged in, surveys exist | Open Dashboard. | Key metrics (farmer counts, area, etc.) render with real numbers, no errors. | H | Both |
| DASH-02 | Filter dashboard by district | — | Change the district filter dropdown. | KPIs and charts recompute for the selected district only; "Whole State" resets to aggregate. | M | Both |
| DASH-03 | Marketing Channel Share pie renders with labels | Survey data with varied `marketing_channel` values exists | Observe the pie chart. | Pie renders (not blank), segment labels are visible and their percentages sum to 100. | M | Both |
| DASH-04 | Raw vs Processed Sale Share pie renders with labels | Survey data with varied `sale_type` values exists | Observe the second pie chart. | Same as DASH-03 — non-blank, labeled, sums to 100. | M | Both |
| DASH-05 | Yield benchmark comparison loads | — | Observe the yield benchmark section/inputs. | Values load from `/dashboard/yield-benchmarks` without error. | L | Both |
| DASH-06 | Dashboard accessible to field users | Logged in as a field user | Open Dashboard. | Loads normally — Dashboard has no permission gate. | M | Both |

---

## 6. New Survey Entry (multi-step wizard)

| ID | Title | Preconditions | Steps | Expected Result | P | Platform |
|---|---|---|---|---|---|---|
| ENT-01 | Access gated by `survey_entry` permission | Field user without `survey_entry` | Try to open New Survey Entry (nav hidden + direct nav). | Nav link absent; direct `/entry` navigation redirects to Dashboard. | H | Both |
| ENT-02 | Village-first autocomplete auto-fills Taluka/District | On the wizard's location step | Type a partial village name (e.g. "kal"). | Up to 8 matching villages shown with their taluka/district as a sub-label; selecting one locks the field and auto-fills Taluka + District (marked "auto-filled"). | H | Both |
| ENT-03 | Village not found | — | Type a village name that doesn't exist in master data. | No matches shown; Taluka/District remain unset; user cannot proceed without a valid selection (or is flagged by validation). | M | Both |
| ENT-04 | Mobile number OTP (simulated) — send & verify | — | Enter a valid 10-digit mobile number, tap Send OTP, enter any 4+ digit code, tap Verify. | Status shows "Verified" with a checkmark; no real SMS is sent (this is explicitly simulated pending a real SMS gateway). | M | Both |
| ENT-05 | OTP send disabled for invalid mobile number | — | Enter fewer than 10 digits. | Send OTP button stays disabled. | L | Both |
| ENT-06 | Changing mobile number resets verification | Mobile already verified (ENT-04) | Edit the mobile number field. | "Verified" state clears; must re-verify. | M | Both |
| ENT-07 | Farmer ID is auto-generated, not manually entered | — | Observe the Farmer ID field before submission. | Field is read-only, shows "Will be assigned on submit"; no way to type into it. | H | Both |
| ENT-08 | Farmer ID assigned only after full validation passes | Wizard filled out completely and validly | Submit the survey. | A new sequential `NCCF/KA/####` id is assigned and shown on the resulting record — assignment happens only post-validation, not on an invalid/partial submit attempt. | H | Both |
| ENT-09 | Conditional required-field hints | On any field whose requirement depends on an earlier answer (e.g. Credit Linkage = Yes) | Toggle the dependency to make the field required. | Muted hint text appears under the field's label explaining why it's now required (e.g. "Required because Credit Linkage = Yes"); hint disappears if a validation error is shown instead. | L | Both |
| ENT-10 | "Other" free-text fields appear when "Any Other" is selected | On a multi-select with an "Other" option (Cultivation Challenges, Mechanisation Owned/Rented, Non-Farm Income Source, Credit Source, Marketing Channel, Input Source, Logistics Provider, etc.) | Select "Other"/"Any Other". | A free-text input appears and is required before proceeding. | M | Both |
| ENT-11 | Numeric fields reject negative input at keystroke time | Any numeric field (cost, yield, area, etc.) | Attempt to type a leading "-". | The "-" is stripped immediately — negative values are structurally impossible to enter, not just flagged after submit. | M | Both |
| ENT-12 | Upper bounds enforced on monetary/interest fields | — | Enter an absolute-INR field (e.g. cultivation cost) above ₹10 crore, or an interest-rate field above 20%. | Client-side validation rejects the value before submit; if bypassed, server also rejects with `Field(le=...)` validation error. | M | Both |
| ENT-13 | Total Household Income uses bracket selection | — | Observe the income field. | A dropdown with brackets (`<₹10,000` / `₹10,000–1L` / `₹1L–10L` / `>₹10L`) — not a free numeric field. | L | Both |
| ENT-14 | Sale Type "Both raw and processed" requires both yield fields | — | Select Sale Type = "Sold both raw and processed areca". | Both `Raw Yield` and `Processed Yield` fields appear and are both required; total income calculation sums both. | M | Both |
| ENT-15 | Overdraft question only shown when Bank Account = Yes | — | Set Bank Account = No. | Overdraft Facility question hidden and its value cleared if it was previously set. | L | Both |
| ENT-16 | Society/FPC name optional when channel = FPC/FPO | Marketing Channel = FPC/FPO | Leave the FPC name blank. | Submission succeeds — an "Optional — fill in if known" hint is shown instead of a required-field error. | L | Both |
| ENT-17 | Photo capture (camera) | Mobile device/emulator with camera | On the field-photo step, tap to capture a photo. | Camera opens (native Capacitor Camera plugin on mobile / file picker or webcam on browser), photo is compressed client-side (~1280px, quality 70) and attached as a base64 data URL. | H | Mobile (camera hardware); Web (file upload fallback) |
| ENT-18 | Submit a fully valid survey | All required fields completed | Complete the wizard, submit. | Survey created successfully, farmer id assigned, redirected to a confirmation/view screen, record appears in Farmer Records. | H | Both |
| ENT-19 | Submit with missing required field | One required field left blank | Attempt to submit. | Blocked with a clear inline error on the offending field(s); form does not submit. | H | Both |
| ENT-20 | Offline submission is queued, not lost | Device/browser goes offline (airplane mode or DevTools offline) | Fill out and submit a survey while offline. | Submission is stored in the local offline queue (IndexedDB); UI shows a "pending sync" indicator; no data loss. | H | Both (mobile especially — field use in low-connectivity areas) |
| ENT-21 | Queued survey syncs when back online | Continuing ENT-20 | Restore connectivity; either wait for auto-sync or tap manual "Sync". | Queued survey(s) POST to the server; pending count drops to 0; record now visible in Farmer Records from any device. | H | Both |
| ENT-22 | Sync retry does not duplicate | A survey already synced once, sync is triggered again | Manually trigger Sync again after a successful sync. | No duplicate record created — dedup is by `client_uuid` server-side; already-synced entries are simply skipped/removed from the queue. | M | Both |
| ENT-23 | Partial sync failure — some queued, some fail | Multiple queued surveys, one has since become invalid (e.g. references a deleted village) | Trigger sync. | Valid entries sync successfully and clear from the queue; the failing entry remains queued (not silently dropped) and is retried on next sync attempt. | M | Both |

---

## 7. Farmer Records

| ID | Title | Preconditions | Steps | Expected Result | P | Platform |
|---|---|---|---|---|---|---|
| FR-01 | Access gated by `farmer_records` permission | Field user without `farmer_records` | Nav + direct `/farmers` navigation. | Link hidden; direct nav redirects to Dashboard. | H | Both |
| FR-02 | List all farmer records | User has `farmer_records` (or is admin) | Open Farmer Records. | Paginated/scrollable list of survey records loads. | H | Both |
| FR-03 | Search/filter farmer records | Records exist | Use the search/filter control (by name, village, district, etc. — whatever's exposed). | List narrows to matching records only. | M | Both |
| FR-04 | View a single farmer's full record | A record exists | Tap into a record from the list. | All submitted fields display correctly, matching what was entered/submitted. | H | Both |
| FR-05 | Edit an existing record | User has `farmer_records` | Open a record, edit a field, save. | Record updates; farmer_id is preserved (not regenerated); changes visible on reload. | H | Both |
| FR-06 | Farmer lookup / autocomplete for existing farmers | — | In a context that looks up an existing farmer (e.g. re-survey), type a partial name/id. | Matching existing farmers surface for selection. | M | Both |
| FR-07 | Delete a record is admin-only | Logged in as a field user with `farmer_records` | Attempt to delete a record (UI control, if present, or direct API call). | Denied (403) — delete is admin-only regardless of `farmer_records` grant (see RBAC-07). | M | Both + API |
| FR-08 | Admin can delete a record | Logged in as admin | Delete a survey record. | Record removed; no longer appears in the list. | M | Both |

---

## 8. Plot Boundary Capture & Plots Map

| ID | Title | Preconditions | Steps | Expected Result | P | Platform |
|---|---|---|---|---|---|---|
| PLOT-01 | Access gated by `plots_map` permission | Field user without `plots_map` | Nav + direct navigation to `/plots` and `/farmers/:id/plot-boundary`. | Both blocked/hidden for a user lacking this permission. | H | Both |
| PLOT-02 | Capture boundary via GPS walk | Mobile device with GPS, physically able to walk the plot (or emulator with simulated location) | From a farmer record, choose "GPS Walk", start capture, move around the plot perimeter, stop. | Points are recorded as the device moves; a polygon is formed and area (in acres) computed. | H | Mobile (real GPS hardware) — web can simulate via browser geolocation but is impractical for a real walk |
| PLOT-03 | Capture boundary via Excel upload | A correctly formatted lat/long Excel file | Choose "Excel Upload" tab, select the file. | Points parsed from the file, polygon rendered, area computed. | M | Both |
| PLOT-04 | Excel upload — malformed file rejected | A file missing expected columns or with invalid coordinates | Upload it. | Clear error message; no partial/corrupt boundary saved. | M | Both |
| PLOT-05 | Capture boundary via "Draw on Map" | None — Leaflet + Esri World Imagery tiles, no API key | Choose "Draw on Map", tap points on the map to trace the plot, then "Finish Boundary". | Polygon drawn interactively; editable (drag corner/midpoint, right-click to delete a vertex); area computed from the drawn shape. | M | Both |
| PLOT-07 | Save a captured boundary | A boundary has been captured by any method | Confirm/save. | `PUT /api/surveys/{id}/plot-boundary` succeeds; boundary + area persist and reload correctly on revisit. | H | Both |
| PLOT-08 | Edit/re-capture an existing boundary | A boundary already exists for a record | Re-open plot-boundary capture, redo it, save. | Old boundary replaced with the new one; area recalculated. | M | Both |
| PLOT-09 | Delete a boundary | A boundary exists | Trigger delete (if exposed in UI) or call the DELETE endpoint. | Boundary cleared from the record; `plot_boundary_area_acres` resets. | L | Both + API |
| PLOT-10 | Plots Registry lists all captured plots | Multiple records have boundaries | Open Plots Map / registry list. | All plots with a captured boundary are listed with their computed area, farmer name, location. | H | Both |
| PLOT-11 | Plots Registry excludes records with no boundary (default filter) | Some records have no boundary | Observe the default list (`only_with_boundary=true`). | Only records with a saved boundary appear. | M | Both |
| PLOT-12 | Boundary capture is mandatory on new submissions | New survey being created | Attempt to submit a new survey without capturing a boundary. | Submission is blocked — plot boundary is a mandatory field on `SurveyIn` (per the existing validator). | H | Both |
| PLOT-13 | Existing pre-boundary-mandate records still readable | A legacy record predates the mandatory-boundary rule | Open that record / list it in Farmer Records. | Loads and displays fine — `SurveyOut` neutralizes the mandatory validator so old rows aren't rejected on read. | H | Both |

---

## 9. Language Toggle (English / Kannada)

| ID | Title | Preconditions | Steps | Expected Result | P | Platform |
|---|---|---|---|---|---|---|
| LANG-01 | Toggle from English to Kannada | Logged in | Tap the language switch button in the header. | UI labels switch to Kannada (ಕನ್ನಡ) for translated strings; button now reads "English" to switch back. | M | Both |
| LANG-02 | Language preference persists across navigation | Kannada selected | Navigate between pages. | Language stays Kannada until manually switched back. | L | Both |
| LANG-03 | Untranslated strings fall back gracefully | Kannada selected, viewing a screen with incomplete translation coverage | Observe any string without a Kannada translation. | Falls back to English rather than showing a blank/broken label (known partial-coverage gap — not a full audit yet). | L | Both |

---

## 10. Mobile-Specific (Capacitor / Android)

| ID | Title | Preconditions | Steps | Expected Result | P | Platform |
|---|---|---|---|---|---|---|
| MOB-01 | App installs and launches | v5.0 APK, Android device/emulator | Sideload and open the APK. | App installs (as an update over v2–v4, same signing cert) and launches to the Login screen. | H | Mobile |
| MOB-02 | App works fully offline for data entry | Airplane mode enabled | Open the app, log in (if a session is cached — see AUTH-05), fill and submit a survey. | Works per ENT-20/21 — offline queue behavior. | H | Mobile |
| MOB-03 | Camera permission prompt | First photo capture attempt | Trigger photo capture. | Android permission dialog appears; granting allows capture, denying shows a graceful fallback/error (not a crash). | M | Mobile |
| MOB-04 | Location permission prompt | First GPS Walk attempt | Trigger GPS Walk capture. | Android location-permission dialog appears; behaves gracefully on denial. | M | Mobile |
| MOB-05 | Share functionality (if used) | A shareable artifact exists (e.g. exported record/photo) | Trigger the native Share action. | Android share sheet opens with the expected content. | L | Mobile |
| MOB-06 | Back-button behavior | Any screen | Press the Android hardware back button. | Currently exits the app (interception explicitly deferred — OBS-028, not a bug). | L | Mobile |
| MOB-07 | App icon, name, and version correct | — | Check installed app's info in Android Settings. | Name "Arecanut Farmer Survey", package `com.gtbharat.arecanutsurvey`, version 5.0 (versionCode 5). | L | Mobile |
| MOB-08 | Mixed-content / HTTP calls to backend succeed | — | Use the app normally (all API calls go to the HTTPS production backend). | No blocked mixed-content errors — backend is served over HTTPS in production. | M | Mobile |
| MOB-09 | PWA install prompt (web only, not the packaged app) | Using the web app in a supporting mobile browser | Visit the web app on a phone browser. | Browser offers "Add to Home Screen" / install prompt (PWA manifest configured); installed PWA behaves like a standalone app. | L | Web (mobile browser) |
| MOB-10 | Service worker caches master-data GETs, not API mutations | PWA installed, previously visited | Go offline, reopen the app. | Cached master-data lookups (`/api/masters/*`) may still resolve from cache; survey/auth calls are never served from a stale cache (explicitly excluded) and correctly surface as real network failures for the offline queue to handle. | M | Web/Mobile (PWA) |

---

## 11. Cross-Cutting / Non-Functional

| ID | Title | Steps | Expected Result | P | Platform |
|---|---|---|---|---|---|
| NF-01 | Audit log captures auth events | Log in, log out, fail a login. | Each event produces an `AuditLog` row with correct `action`, `user`, `ip_address`, timestamp. | M | Backend/DB |
| NF-02 | Rate limiting on login endpoint | Rapidly repeat login attempts beyond the configured limit. | HTTP 429 returned once the rate limit is exceeded. | M | API |
| NF-03 | Security headers present | Inspect any API response's headers. | OWASP-recommended headers present (e.g. anti-clickjacking, content-type-options). | L | API |
| NF-04 | CORS restricted appropriately | Call the API from an unapproved origin (browser fetch from a different domain). | Blocked by CORS policy in a browser context. | L | Web |
| NF-05 | Responsive layout — desktop | Resize browser to desktop width. | Full nav bar, multi-column layouts render correctly. | M | Web |
| NF-06 | Responsive layout — mobile width | Resize browser to phone width / use actual mobile device. | Bottom nav appears instead of top nav; forms remain usable, no horizontal scroll/clipping. | M | Both |
| NF-07 | No console errors on core flows | Open DevTools console. | Login, Dashboard, Survey Entry, Farmer Records, Plots, Master Data, Users all load without uncaught JS errors. | M | Both |
| NF-08 | Large dataset performance | 100+ survey records exist (seed data provides this) | Load Farmer Records, Dashboard, Plots Registry. | Pages load within a reasonable time (no pagination-less runaway rendering, no timeout). | L | Both |

---

## Notes on scope and known gaps

- **Village master data for some newer talukas is incomplete** (client-acknowledged, pending their Social Team) — test cases involving those specific talukas will show gaps in village autocomplete by design, not as a bug.
- **OTP verification (ENT-04) is explicitly simulated** — there is no real SMS gateway wired up yet. Do not report "no real SMS received" as a defect.
- **Kannada translation coverage is partial** (LANG-03) — a full audit hasn't been done; missing strings falling back to English is expected, not a bug, until that audit happens.
- **Android hardware back-button interception (MOB-06)** and **village/taluka/district-name display alongside raw GPS coordinates** were both explicitly deferred by the client — do not file these as defects.
- Any test that requires **production data mutation** (creating/deleting real districts, users, surveys) should be run against a local/staging backend where possible; if run against production, clean up test records afterward (as done during this project's own verification rounds — see `PROJECT_STATE.md` Session Log for the established pattern).

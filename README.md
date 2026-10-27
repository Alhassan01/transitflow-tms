# TransitFlow Transport Management System

React/Vite frontend, Express API, MongoDB/Mongoose database.

## Run locally

Requirements: Node.js 20+ and MongoDB Community Server running locally or a MongoDB Atlas URI.

1. In `server`, copy `.env.example` to `.env` and set `MONGODB_URI`, `JWT_SECRET` (use a long random secret), and other environment settings as needed.
2. In a terminal: `cd server && npm install && npm run seed && npm run dev`.
3. In a second terminal: `cd client && npm install && npm run dev`.
4. Open the URL Vite prints (normally `http://localhost:5173`).

## Passenger town-service workflow

Passengers can create a town-service request with pickup, destination, preferred time, estimated distance, contact phone, and notes. The fare is calculated from an active operator-defined fare rate. Passengers can view their own requests and edit/cancel requests while the status remains `Requested`. Once accepted/assigned, the request becomes read-only to the passenger. Operations staff can review requests in Town Services and update their status/driver/vehicle using the existing operations workflow.

Passenger scheduled-trip booking remains separate from town-service requests. Passengers can browse scheduled trips and view their own bookings.

## Important setup notes

- At least one active fare rate must exist for town-service requests to be submitted. An administrator/transport manager should configure this in Fare Rates.
- For operational use, configure HTTPS, a strong JWT secret, secure MongoDB credentials, backups, and verify authorization rules in your deployment environment.
- This package has server syntax checks; a full end-to-end test against your local MongoDB and frontend environment is still required before production use.

## Troubleshooting fixes (October 2026)

- `http://localhost:4000/` now serves a small API landing page. The actual web application is served by Vite at `http://localhost:5173`; `/api/health` reports API/database status.
- `GET ... 304` in Morgan logs is normal HTTP caching (`Not Modified`), not a server error.
- The audit logger now reads the user-agent from `req.headers` rather than calling `req.get()` on a plain object. This fixes `Audit log error: req.get is not a function` during login audit events.
- A `POST /api/auth/change-password 400` means the API rejected the submitted values. Most commonly, the current password did not match, or the new password was shorter than 10 characters. The endpoint intentionally does not change the password when the current password is wrong. If the account password is unknown, an administrator can reset it from Users & Access.
- Restart the backend after replacing files. In `server`, run `npm install`, then `npm run dev`. In `client`, run `npm install`, then `npm run dev`.

## Verification and automated tests

A GitHub Actions workflow is included at `.github/workflows/verify.yml`. It builds the frontend and runs a MongoDB-backed passenger/driver town-service integration test. See `docs/VERIFICATION_STATUS.md` for exactly what has and has not been executed in the current workspace. Do not treat the project as fully verified until the workflow completes successfully.

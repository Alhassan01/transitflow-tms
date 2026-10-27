# API notes

The Express API connects to MongoDB using `MONGODB_URI`.

## Data model
Mongoose schemas are in `src/models.js`. They represent users, vehicles, drivers, routes, trips, passengers, customers, bookings, fare rates, town services, fuel transactions/readings/anomalies, GPS devices/locations, geofences, maintenance, incidents, invoices, payments, notifications, and audit logs.

## Security
- JWT authentication and bcrypt password hashes
- Role checks on write endpoints
- Helmet, CORS allowlist, login rate limiting
- Input validation through Mongoose schemas
- Audit records for create/update/delete and login events

For a production deployment, add centralized request validation, refresh-token rotation, password reset workflow, CSRF protections if using cookies, stricter per-role read scopes, and security review.

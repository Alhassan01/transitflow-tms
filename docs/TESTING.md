# Smoke test checklist

1. Start MongoDB and run `npm run seed` in `server`.
2. Log in with the demo administrator account.
3. Create a vehicle, driver, route and trip. Try creating a second overlapping trip using the same driver or vehicle; the API should reject it.
4. Create a fare rate and town service. Verify estimated fare is calculated from the rate model.
5. Create a fuel transaction and verify vehicle fuel balance increases.
6. Submit a fuel reading far below the balance; verify a fuel anomaly is created.
7. Submit GPS coordinates and verify they appear under Live Tracking.
8. Create two bookings for the same trip/seat; the second should be rejected.
9. Complete a maintenance record and verify the vehicle is marked available.
10. Review dashboard, reports and audit log.

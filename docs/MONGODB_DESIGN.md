# MongoDB data design

This project translates the source requirements' relational entities into MongoDB collections and ObjectId references. MongoDB does not use SQL primary/foreign keys; `_id` is the primary identifier and references are ObjectIds.

## Collections
`users`, `vehicles`, `drivers`, `routes`, `trips`, `passengers`, `customers`, `bookings`, `farerates`, `townservices`, `fueltransactions`, `fuelreadings`, `fuelanomalies`, `gpsdevices`, `gpslocations`, `geofences`, `maintenances`, `incidents`, `invoices`, `payments`, `notifications`, `auditlogs`.

## Integrity notes
- Unique indexes cover user email, vehicle registration, booking reference, and the `(trip, seatNumber)` pair for non-cancelled bookings.
- Related records use ObjectId references and are populated where useful.
- Town service records snapshot the pricing mode/base/rate used when created, preserving the original quote if the manager later changes pricing.
- GPS location history is indexed by vehicle and recorded time.
- Fuel readings that differ materially from the recorded balance create a fuel anomaly to investigate; this is not an automatic theft determination.
- Schedule overlap and booking seat availability are checked in application code. For high concurrency production systems, use replica-set transactions and/or stronger reservation patterns.

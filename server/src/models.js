import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const opts = { timestamps: true, strict: true };

const UserSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['Administrator','Transport Manager','Booking Officer','Driver','Accountant','Maintenance Officer','Passenger'], default: 'Booking Officer' },
  phone: String, active: { type: Boolean, default: true }, lastLogin: Date
}, opts);

const VehicleSchema = new Schema({
  registrationNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
  type: { type: String, required: true }, make: String, model: String, year: Number, color: String,
  seatCapacity: { type: Number, default: 4, min: 1 }, fuelType: { type: String, enum: ['Petrol','Diesel','Electric','Hybrid','Other'], default: 'Petrol' },
  currentMileageKm: { type: Number, default: 0, min: 0 }, fuelCapacityLitres: { type: Number, default: 60 },
  currentFuelLitres: { type: Number, default: 0 }, expectedConsumptionLPer100Km: { type: Number, default: 12 },
  insuranceExpiry: Date, licenseExpiry: Date,
  status: { type: String, enum: ['Available','Assigned','On Trip','Town Service','Under Maintenance','Out of Service'], default: 'Available' },
  gpsDeviceId: { type: Schema.Types.ObjectId, ref: 'GpsDevice' }, notes: String
}, opts);

const DriverSchema = new Schema({
  driverCode: { type: String, unique: true, sparse: true }, name: { type: String, required: true },
  phone: String, address: String, licenseNumber: { type: String, unique: true, sparse: true },
  licenseCategory: String, licenseExpiry: Date, employmentStatus: { type: String, enum: ['Active','Inactive','Suspended'], default: 'Active' },
  assignedVehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle' }, emergencyContactName: String, emergencyContactPhone: String
}, opts);

const RouteSchema = new Schema({
  code: { type: String, unique: true, sparse: true }, name: { type: String, required: true },
  origin: { type: String, required: true }, destination: { type: String, required: true },
  stops: [String], distanceKm: { type: Number, min: 0, default: 0 }, estimatedDurationMinutes: Number,
  fare: { type: Number, min: 0, default: 0 }, active: { type: Boolean, default: true }
}, opts);

const TripSchema = new Schema({
  code: { type: String, unique: true, sparse: true }, route: { type: Schema.Types.ObjectId, ref: 'Route', required: true },
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true }, driver: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
  departureAt: { type: Date, required: true }, expectedArrivalAt: Date, actualDepartureAt: Date, actualArrivalAt: Date,
  estimatedDistanceKm: Number, actualDistanceKm: Number,
  status: { type: String, enum: ['Scheduled','Boarding','Departed','In Transit','Completed','Cancelled'], default: 'Scheduled' },
  notes: String, createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, opts);

const PassengerSchema = new Schema({
  name: { type: String, required: true }, phone: String, email: String, address: String,
  identificationType: String, identificationNumber: String, emergencyContact: String, emergencyPhone: String
}, opts);

const CustomerSchema = new Schema({
  name: { type: String, required: true }, type: { type: String, enum: ['Individual','Organization'], default: 'Individual' },
  phone: String, email: String, address: String
}, opts);

const BookingSchema = new Schema({
  reference: { type: String, unique: true }, trip: { type: Schema.Types.ObjectId, ref: 'Trip', required: true },
  passenger: { type: Schema.Types.ObjectId, ref: 'Passenger', required: true }, seatNumber: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 }, amountPaid: { type: Number, default: 0, min: 0 },
  paymentStatus: { type: String, enum: ['Paid','Partially Paid','Unpaid','Refunded'], default: 'Unpaid' },
  status: { type: String, enum: ['Confirmed','Cancelled','Completed'], default: 'Confirmed' }, bookedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, opts);
BookingSchema.index({ trip: 1, seatNumber: 1 }, { unique: true, partialFilterExpression: { status: { $ne: 'Cancelled' } } });

const FareRateSchema = new Schema({
  name: { type: String, required: true }, pricingMode: { type: String, enum: ['PER_KM','FIXED','BASE_PLUS_PER_KM'], default: 'PER_KM' },
  baseFare: { type: Number, default: 0, min: 0 }, ratePerKm: { type: Number, default: 0, min: 0 },
  fixedFare: { type: Number, default: 0, min: 0 }, minimumFare: { type: Number, default: 0, min: 0 },
  active: { type: Boolean, default: true }, effectiveFrom: Date, effectiveTo: Date, createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, opts);

const TownServiceSchema = new Schema({
  reference: { type: String, unique: true }, customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
  customerName: String, customerPhone: String,
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle' }, driver: { type: Schema.Types.ObjectId, ref: 'Driver' },
  pickup: { type: String, required: true }, destination: { type: String, required: true }, stops: [String],
  requestedAt: { type: Date, default: Date.now }, scheduledAt: Date, startedAt: Date, completedAt: Date,
  estimatedDistanceKm: { type: Number, required: true, min: 0 }, actualDistanceKm: { type: Number, min: 0 },
  fareRate: { type: Schema.Types.ObjectId, ref: 'FareRate' }, pricingMode: String, baseFare: Number, ratePerKm: Number,
  estimatedFare: { type: Number, min: 0 }, finalFare: { type: Number, min: 0 },
  fuelUsedLitres: { type: Number, min: 0, default: 0 }, paymentStatus: { type: String, enum: ['Paid','Partially Paid','Unpaid','Refunded'], default: 'Unpaid' },
  status: { type: String, enum: ['Requested','Accepted','Driver Assigned','Vehicle Dispatched','In Progress','Completed','Cancelled'], default: 'Requested' },
  driverResponse: { type: String, enum: ['Pending','Accepted','Rejected','Referred'], default: 'Pending' }, referredDriver: { type: Schema.Types.ObjectId, ref: 'Driver' }, passengerReferralDecision: { type: String, enum: ['Pending','Accepted','Declined'], default: 'Pending' },
  passengerRequestConfirmedAt: Date, passengerArrivalConfirmedAt: Date, driverArrivalConfirmedAt: Date, passengerDestinationConfirmedAt: Date, driverDestinationConfirmedAt: Date,
  paymentMethod: { type: String, enum: ['Cash','Card','Mobile Money','Bank Transfer','Other'], default: 'Cash' }, paymentRecordedBy: { type: Schema.Types.ObjectId, ref: 'User' }, paidAt: Date,
  notes: String, createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, opts);

const FuelTransactionSchema = new Schema({
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true }, driver: { type: Schema.Types.ObjectId, ref: 'Driver' },
  fuelType: String, previousFuelLitres: Number, quantityLitres: { type: Number, required: true, min: 0 },
  pricePerLitre: { type: Number, min: 0 }, totalCost: { type: Number, min: 0 }, odometerKm: Number,
  station: String, transactionReference: String, latitude: Number, longitude: Number,
  recordedAt: { type: Date, default: Date.now }, recordedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, opts);

const FuelReadingSchema = new Schema({
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true }, fuelLevelLitres: { type: Number, required: true, min: 0 },
  source: { type: String, enum: ['SENSOR','MANUAL','TELEMATICS'], default: 'MANUAL' }, recordedAt: { type: Date, default: Date.now },
  latitude: Number, longitude: Number, ignitionOn: Boolean
}, opts);

const FuelAnomalySchema = new Schema({
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true }, detectedAt: { type: Date, default: Date.now },
  expectedFuelLitres: Number, actualFuelLitres: Number, differenceLitres: Number,
  type: { type: String, enum: ['UNEXPECTED_DROP','UNAUTHORIZED_REFUEL','EXCESSIVE_CONSUMPTION','SENSOR_ANOMALY','OTHER'], default: 'UNEXPECTED_DROP' },
  description: String, status: { type: String, enum: ['Open','Under Investigation','Resolved','Dismissed'], default: 'Open' },
  investigatedBy: { type: Schema.Types.ObjectId, ref: 'User' }, investigationNote: String, resolvedAt: Date,
  latitude: Number, longitude: Number
}, opts);

const GpsDeviceSchema = new Schema({
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle' }, serialNumber: { type: String, unique: true },
  provider: String, simNumber: String, installedAt: Date, status: { type: String, enum: ['Active','Inactive','Faulty'], default: 'Active' },
  lastCommunication: Date, apiKey: { type: String, select: false }
}, opts);

const GpsLocationSchema = new Schema({
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true }, device: { type: Schema.Types.ObjectId, ref: 'GpsDevice' },
  recordedAt: { type: Date, default: Date.now }, latitude: { type: Number, required: true, min: -90, max: 90 },
  longitude: { type: Number, required: true, min: -180, max: 180 }, speedKmh: Number, heading: Number,
  ignitionOn: Boolean, odometerKm: Number, fuelLevelLitres: Number, fuelLevelPercentage: Number
}, opts);
GpsLocationSchema.index({ vehicle: 1, recordedAt: -1 });

const GeofenceSchema = new Schema({
  name: { type: String, required: true }, description: String, type: { type: String, enum: ['YARD','FUEL_STATION','SERVICE_AREA','RESTRICTED','OTHER'], default: 'OTHER' },
  centerLatitude: { type: Number, required: true }, centerLongitude: { type: Number, required: true },
  radiusMeters: { type: Number, required: true, min: 1 }, active: { type: Boolean, default: true }
}, opts);

const MaintenanceSchema = new Schema({
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true }, type: { type: String, required: true },
  serviceDate: { type: Date, default: Date.now }, mileageKm: Number, description: String,
  serviceProvider: String, cost: { type: Number, min: 0, default: 0 }, nextServiceDate: Date, nextServiceMileageKm: Number,
  status: { type: String, enum: ['Scheduled','In Progress','Completed'], default: 'Completed' }, recordedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, opts);

const IncidentSchema = new Schema({
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true }, driver: { type: Schema.Types.ObjectId, ref: 'Driver' },
  trip: { type: Schema.Types.ObjectId, ref: 'Trip' }, service: { type: Schema.Types.ObjectId, ref: 'TownService' },
  type: { type: String, enum: ['Accident','Breakdown','Damage','Security','Other'], default: 'Other' },
  occurredAt: { type: Date, default: Date.now }, location: String, latitude: Number, longitude: Number,
  description: { type: String, required: true }, estimatedDamageCost: Number, actionTaken: String,
  status: { type: String, enum: ['Open','Under Investigation','Resolved','Closed'], default: 'Open' }, reportedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, opts);

const InvoiceSchema = new Schema({
  number: { type: String, unique: true }, customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
  townService: { type: Schema.Types.ObjectId, ref: 'TownService' }, issuedAt: { type: Date, default: Date.now },
  subtotal: Number, discount: { type: Number, default: 0 }, tax: { type: Number, default: 0 },
  totalAmount: { type: Number, required: true }, amountPaid: { type: Number, default: 0 }, balanceDue: Number,
  status: { type: String, enum: ['Paid','Partially Paid','Unpaid','Cancelled'], default: 'Unpaid' }, createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, opts);

const PaymentSchema = new Schema({
  invoice: { type: Schema.Types.ObjectId, ref: 'Invoice' }, booking: { type: Schema.Types.ObjectId, ref: 'Booking' }, townService: { type: Schema.Types.ObjectId, ref: 'TownService' }, trip: { type: Schema.Types.ObjectId, ref: 'Trip' }, payer: { type: Schema.Types.ObjectId, ref: 'User' }, payerName: String, serviceType: { type: String, enum: ['Town Service','Scheduled Trip','Booking','Other'], default: 'Other' },
  amount: { type: Number, required: true, min: 0 }, method: { type: String, enum: ['Cash','Card','Mobile Money','Bank Transfer','Other'], default: 'Cash' },
  transactionReference: String, paidAt: { type: Date, default: Date.now }, receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['Successful','Pending','Failed','Refunded'], default: 'Successful' }, notes: String
}, opts);

const NotificationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User' }, type: String, title: { type: String, required: true },
  message: { type: String, required: true }, relatedEntity: String, relatedId: String, read: { type: Boolean, default: false }
}, opts);

const AuditLogSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User' }, action: String, resource: String, recordId: String,
  oldValues: Schema.Types.Mixed, newValues: Schema.Types.Mixed, ipAddress: String, userAgent: String
}, { timestamps: { createdAt: true, updatedAt: false } });

export const User = model('User', UserSchema);
export const Vehicle = model('Vehicle', VehicleSchema);
export const Driver = model('Driver', DriverSchema);
export const Route = model('Route', RouteSchema);
export const Trip = model('Trip', TripSchema);
export const Passenger = model('Passenger', PassengerSchema);
export const Customer = model('Customer', CustomerSchema);
export const Booking = model('Booking', BookingSchema);
export const FareRate = model('FareRate', FareRateSchema);
export const TownService = model('TownService', TownServiceSchema);
export const FuelTransaction = model('FuelTransaction', FuelTransactionSchema);
export const FuelReading = model('FuelReading', FuelReadingSchema);
export const FuelAnomaly = model('FuelAnomaly', FuelAnomalySchema);
export const GpsDevice = model('GpsDevice', GpsDeviceSchema);
export const GpsLocation = model('GpsLocation', GpsLocationSchema);
export const Geofence = model('Geofence', GeofenceSchema);
export const Maintenance = model('Maintenance', MaintenanceSchema);
export const Incident = model('Incident', IncidentSchema);
export const Invoice = model('Invoice', InvoiceSchema);
export const Payment = model('Payment', PaymentSchema);
export const Notification = model('Notification', NotificationSchema);
export const AuditLog = model('AuditLog', AuditLogSchema);

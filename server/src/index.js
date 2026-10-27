import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import * as M from './models.js';
import { authenticate, allowRoles, asyncHandler } from './middleware.js';

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }));
const admin = ['Administrator'];
const managers = ['Administrator','Transport Manager'];
const operations = ['Administrator','Transport Manager','Booking Officer','Accountant','Maintenance Officer'];
const finance = ['Administrator','Accountant'];
const safe = (obj) => { const x = { ...obj }; delete x.password; delete x.passwordHash; return x; };
const code = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
const audit = async (req, action, resource, recordId, oldValues, newValues) => {
  try { await M.AuditLog.create({ user: req.user?._id, action, resource, recordId: String(recordId || ''), oldValues, newValues, ipAddress: req.ip, userAgent: req.headers?.['user-agent'] || '' }); } catch (e) { console.error('Audit log error:', e.message); }
};
const notify = async (title, message, type = 'SYSTEM', relatedEntity = '', relatedId = '') => {
  try { await M.Notification.create({ type, title, message, relatedEntity, relatedId }); } catch {}
};

app.get('/', (req,res) => res.status(200).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TransitFlow API</title><style>body{font:16px system-ui;max-width:760px;margin:12vh auto;padding:24px;color:#172554}code{background:#f1f5f9;padding:4px 8px;border-radius:6px}.ok{color:#15803d}</style></head><body><h1>TransitFlow API</h1><p class="ok">API server is running.</p><p>Use the frontend at <code>http://localhost:5173</code> to operate the system.</p><p>Health status: <a href="/api/health">/api/health</a></p><p>API endpoints are under <code>/api</code>; this root page is not the application dashboard.</p></body></html>`));
app.get('/api/health', (req,res) => res.json({ status:'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));

app.post('/api/auth/register', asyncHandler(async (req,res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const phone = String(req.body.phone || '').trim();
  if (!name || !email || password.length < 10) return res.status(400).json({message:'Name, email, and a password of at least 10 characters are required.'});
  if (await M.User.findOne({email})) return res.status(409).json({message:'An account with this email already exists.'});
  const user = await M.User.create({name,email,phone,role:'Passenger',active:true,passwordHash:await bcrypt.hash(password,12)});
  const passenger = await M.Passenger.create({name,email,phone});
  user.passengerProfile = passenger.id; // retained on the passenger profile; schema remains strict
  const token = jwt.sign({sub:user.id,role:user.role},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN || '8h'});
  res.status(201).json({token,user:safe(user.toObject())});
}));

app.post('/api/auth/login', asyncHandler(async (req,res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = await M.User.findOne({ email }).select('+passwordHash');
  if (!user || !user.active || !(await bcrypt.compare(String(req.body.password || ''), user.passwordHash))) {
    return res.status(401).json({ message: 'Email or password is incorrect.' });
  }
  user.lastLogin = new Date(); await user.save();
  const token = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
  req.user = user; await audit(req, 'LOGIN', 'User', user.id, null, { email:user.email, role:user.role });
  res.json({ token, user: safe(user.toObject()) });
}));
app.get('/api/auth/me', authenticate, (req,res) => res.json({ user: safe(req.user.toObject()) }));
app.put('/api/auth/profile', authenticate, asyncHandler(async(req,res)=>{const allowed={};for(const k of ['name','phone'])if(req.body[k]!==undefined)allowed[k]=String(req.body[k]).trim();if(req.body.email!==undefined){const email=String(req.body.email).trim().toLowerCase();const existing=await M.User.findOne({email,_id:{$ne:req.user.id}});if(existing)return res.status(409).json({message:'Email already belongs to another account.'});allowed.email=email;}const doc=await M.User.findByIdAndUpdate(req.user.id,allowed,{new:true,runValidators:true}).select('-passwordHash');await audit(req,'UPDATE','User',doc.id,null,safe(doc.toObject()));res.json({user:doc});}));
app.post('/api/auth/change-password', authenticate, asyncHandler(async (req,res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || String(newPassword).length < 10) return res.status(400).json({ message: 'New password must be at least 10 characters.' });
  const user = await M.User.findById(req.user.id).select('+passwordHash');
  if (!(await bcrypt.compare(String(currentPassword || ''), user.passwordHash))) return res.status(400).json({ message: 'Current password is incorrect.' });
  user.passwordHash = await bcrypt.hash(newPassword, 12); await user.save(); res.json({ message: 'Password changed.' });
}));

// Generic authenticated CRUD resources. Per-resource write permissions are explicit.
const resources = {
  vehicles: { model:M.Vehicle, roles:managers, populate:'', search:['registrationNumber','type','make','model','status'] },
  drivers: { model:M.Driver, roles:managers, populate:'assignedVehicle', search:['name','phone','driverCode','licenseNumber','employmentStatus'] },
  routes: { model:M.Route, roles:managers, search:['name','origin','destination','code'] },
  trips: { model:M.Trip, roles:managers, populate:'route vehicle driver', search:['code','status'] },
  passengers: { model:M.Passenger, roles:operations, search:['name','phone','email'] },
  customers: { model:M.Customer, roles:operations, search:['name','phone','email'] },
  'fare-rates': { model:M.FareRate, roles:managers, search:['name','pricingMode'] },
  'fuel-transactions': { model:M.FuelTransaction, roles:managers, populate:'vehicle driver', search:['station','transactionReference','fuelType'] },
  'fuel-readings': { model:M.FuelReading, roles:managers, populate:'vehicle', search:['source'] },
  'fuel-anomalies': { model:M.FuelAnomaly, roles:managers, populate:'vehicle investigatedBy', search:['type','status','description'] },
  'gps-devices': { model:M.GpsDevice, roles:managers, populate:'vehicle', search:['serialNumber','provider','status'] },
  'gps-locations': { model:M.GpsLocation, roles:managers, populate:'vehicle', search:[] },
  geofences: { model:M.Geofence, roles:managers, search:['name','type'] },
  maintenance: { model:M.Maintenance, roles:['Administrator','Transport Manager','Maintenance Officer'], populate:'vehicle', search:['type','status','serviceProvider','description'] },
  incidents: { model:M.Incident, roles:operations, populate:'vehicle driver', search:['type','status','location','description'] },
  invoices: { model:M.Invoice, roles:finance, populate:'customer townService', search:['number','status'] },
  payments: { model:M.Payment, roles:finance, populate:'invoice booking townService trip payer receivedBy', search:['method','status','transactionReference'] },
  notifications: { model:M.Notification, roles:[...operations,'Driver'], search:['title','message','type'] },
  'audit-logs': { model:M.AuditLog, roles:admin, populate:'user', search:['action','resource','recordId'] }
};
for (const [path, cfg] of Object.entries(resources)) {
  app.get(`/api/${path}`, authenticate, asyncHandler(async (req,res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const q = String(req.query.q || '').trim();
    const filter = q && cfg.search?.length ? { $or: cfg.search.map(k => ({ [k]: { $regex:q, $options:'i' } })) } : {};
    if (req.query.status && cfg.model.schema.path('status')) filter.status = req.query.status;
    if (path === 'notifications') {
      // Notifications linked to terminal town-service requests are automatically hidden.
      const terminal = await M.TownService.find({ status: { $in: ['Completed','Cancelled'] } }).select('_id');
      const terminalIds = terminal.map(x => String(x._id));
      filter.$and = [...(filter.$and || []), { $or: [
        { relatedEntity: { $ne: 'TownService' } },
        { relatedId: { $nin: terminalIds } }
      ] }];
      // Drivers need to see open passenger requests; notifications are shared operational notices.
    }
    let query = cfg.model.find(filter).sort({ createdAt:-1 }).limit(limit);
    if (cfg.populate) query = query.populate(cfg.populate);
    res.json(await query);
  }));
  app.post(`/api/${path}`, authenticate, allowRoles(...cfg.roles), asyncHandler(async (req,res) => {
    const data = { ...req.body };
    delete data._id; delete data.__v;
    if (path === 'trips') {
      const vehicle = await M.Vehicle.findById(data.vehicle), driver = await M.Driver.findById(data.driver);
      if (!vehicle || vehicle.status === 'Under Maintenance' || vehicle.status === 'Out of Service') return res.status(400).json({ message:'Selected vehicle is unavailable.' });
      if (!driver || driver.employmentStatus !== 'Active') return res.status(400).json({ message:'Selected driver is not active.' });
      const start = new Date(data.departureAt); const end = data.expectedArrivalAt ? new Date(data.expectedArrivalAt) : new Date(start.getTime()+4*3600000);
      const overlap = await M.Trip.findOne({ status:{ $nin:['Cancelled','Completed'] }, departureAt:{ $lt:end }, expectedArrivalAt:{ $gt:start }, $or:[{vehicle:data.vehicle},{driver:data.driver}] });
      if (overlap) return res.status(409).json({ message:'Vehicle or driver already has an overlapping trip.' });
      data.createdBy = req.user.id; data.code ||= code('TRIP');
    }
    if (path === 'vehicles') data.registrationNumber = String(data.registrationNumber || '').toUpperCase();
    if (path === 'fuel-transactions') {
      data.recordedBy = req.user.id; data.totalCost ??= Number(data.quantityLitres || 0) * Number(data.pricePerLitre || 0);
      const v = await M.Vehicle.findById(data.vehicle);
      if (!v) return res.status(400).json({ message:'Vehicle not found.' });
      data.previousFuelLitres = v.currentFuelLitres;
      v.currentFuelLitres = Math.min(Number(v.fuelCapacityLitres || Infinity), Number(v.currentFuelLitres || 0) + Number(data.quantityLitres || 0));
      if (data.odometerKm != null) v.currentMileageKm = Math.max(v.currentMileageKm || 0, Number(data.odometerKm));
      await v.save();
    }
    if (path === 'fuel-readings') {
      const v = await M.Vehicle.findById(data.vehicle);
      if (!v) return res.status(400).json({ message:'Vehicle not found.' });
      const expected = Number(v.currentFuelLitres || 0);
      const actual = Number(data.fuelLevelLitres);
      if (expected - actual >= Math.max(8, expected * 0.2)) {
        await M.FuelAnomaly.create({ vehicle:v.id, expectedFuelLitres:expected, actualFuelLitres:actual, differenceLitres:expected-actual, type:'UNEXPECTED_DROP', description:'Fuel reading is materially below the vehicle fuel balance. Investigate sensor accuracy, trip consumption, and refuelling records.', latitude:data.latitude, longitude:data.longitude });
        await notify('Potential fuel anomaly', `${v.registrationNumber}: reported fuel is ${(expected-actual).toFixed(1)} L below expected. Investigate before drawing conclusions.`, 'FUEL_ANOMALY', 'Vehicle', v.id);
      }
      v.currentFuelLitres = actual; await v.save();
    }
    if (path === 'gps-locations') {
      const v = await M.Vehicle.findById(data.vehicle);
      if (!v) return res.status(400).json({ message:'Vehicle not found.' });
      if (data.fuelLevelLitres != null) {
        const expected = Number(v.currentFuelLitres || 0), actual = Number(data.fuelLevelLitres);
        if (expected - actual >= Math.max(8, expected * 0.2)) {
          await M.FuelAnomaly.create({ vehicle:v.id, expectedFuelLitres:expected, actualFuelLitres:actual, differenceLitres:expected-actual, type:'UNEXPECTED_DROP', description:'GPS/telematics fuel level is below expected balance; investigation required.', latitude:data.latitude, longitude:data.longitude });
          await notify('Potential fuel anomaly', `${v.registrationNumber}: telemetry shows a possible fuel discrepancy.`, 'FUEL_ANOMALY', 'Vehicle', v.id);
        }
        v.currentFuelLitres = actual;
      }
      if (data.odometerKm != null) v.currentMileageKm = Math.max(v.currentMileageKm || 0, Number(data.odometerKm));
      await v.save();
      const fences = await M.Geofence.find({ active:true });
      for (const f of fences) {
        const rad = 6371000, toRad = n => n*Math.PI/180;
        const dLat=toRad(data.latitude-f.centerLatitude), dLon=toRad(data.longitude-f.centerLongitude);
        const a=Math.sin(dLat/2)**2+Math.cos(toRad(f.centerLatitude))*Math.cos(toRad(data.latitude))*Math.sin(dLon/2)**2;
        if (2*rad*Math.asin(Math.sqrt(a)) <= f.radiusMeters) {
          // Current point is inside fence; event de-duplication can be added by provider integration.
        }
      }
    }
    if (path === 'fuel-anomalies') { data.investigatedBy = req.user.id; }
    if (path === 'maintenance') {
      data.recordedBy = req.user.id;
      if (data.status !== 'Completed') await M.Vehicle.findByIdAndUpdate(data.vehicle, { status:'Under Maintenance' });
    }
    if (path === 'incidents') data.reportedBy = req.user.id;
    if (path === 'invoices') { data.createdBy = req.user.id; data.number ||= code('INV'); data.balanceDue = Number(data.totalAmount || 0) - Number(data.amountPaid || 0); }
    if (path === 'payments') {
      data.receivedBy = req.user.id;
      if (data.invoice) {
        const inv = await M.Invoice.findById(data.invoice);
        if (!inv) return res.status(400).json({ message:'Invoice not found.' });
        inv.amountPaid = Number(inv.amountPaid || 0) + Number(data.amount || 0);
        inv.balanceDue = Math.max(0, Number(inv.totalAmount || 0)-inv.amountPaid);
        inv.status = inv.balanceDue === 0 ? 'Paid' : 'Partially Paid'; await inv.save();
      }
    }
    const doc = await cfg.model.create(data);
    await audit(req,'CREATE',path,doc.id,null,doc.toObject());
    res.status(201).json(doc);
  }));
  app.put(`/api/${path}/:id`, authenticate, allowRoles(...cfg.roles), asyncHandler(async (req,res) => {
    const old = await cfg.model.findById(req.params.id);
    if (!old) return res.status(404).json({ message:'Record not found.' });
    const patch = { ...req.body }; delete patch._id; delete patch.__v; delete patch.passwordHash;
    if (path === 'fuel-anomalies' && patch.status === 'Resolved') { patch.resolvedAt = new Date(); patch.investigatedBy = req.user.id; }
    if (path === 'maintenance' && patch.status === 'Completed') await M.Vehicle.findByIdAndUpdate(old.vehicle, { status:'Available' });
    const updated = await cfg.model.findByIdAndUpdate(req.params.id, patch, { new:true, runValidators:true });
    await audit(req,'UPDATE',path,updated.id,old.toObject(),updated.toObject()); res.json(updated);
  }));
  app.delete(`/api/${path}/:id`, authenticate, allowRoles(...(path === 'audit-logs' ? admin : cfg.roles)), asyncHandler(async (req,res) => {
    const old = await cfg.model.findById(req.params.id);
    if (!old) return res.status(404).json({ message:'Record not found.' });
    await cfg.model.findByIdAndDelete(req.params.id); await audit(req,'DELETE',path,req.params.id,old.toObject(),null);
    res.json({ message:'Record deleted.' });
  }));
}

// Town-service workflow with manager-controlled pricing and stored fare snapshot.
async function resolveDriverProfile(user) {
  const clauses = [];
  if (user.phone) clauses.push({ phone: user.phone });
  if (user.name) clauses.push({ name: user.name });
  return clauses.length ? M.Driver.findOne({ $or: clauses, employmentStatus: 'Active' }) : null;
}
app.get('/api/town-services', authenticate, asyncHandler(async (req,res) => {
  let filter = req.user.role === 'Passenger' ? { createdBy: req.user.id } : {};
  if (req.user.role === 'Driver') {
    const d = await resolveDriverProfile(req.user);
    filter = d ? { $or: [{ driver: d._id }, { referredDriver: d._id }, { status: 'Requested' }] } : { _id: { $exists: false } };
  }
  res.json(await M.TownService.find(filter).populate('vehicle driver referredDriver customer fareRate').sort({createdAt:-1}).limit(300));
}));
app.post('/api/town-services', authenticate, allowRoles(...operations), asyncHandler(async (req,res) => {
  const b = req.body;
  const distance = Number(b.estimatedDistanceKm);
  if (!Number.isFinite(distance) || distance < 0) return res.status(400).json({message:'Enter a valid estimated distance in kilometres.'});
  let rate = b.fareRate ? await M.FareRate.findById(b.fareRate) : await M.FareRate.findOne({active:true}).sort({createdAt:-1});
  if (!rate) return res.status(400).json({message:'Create an active fare rate before creating town services.'});
  let fare = rate.pricingMode === 'FIXED' ? Number(rate.fixedFare || 0) : rate.pricingMode === 'BASE_PLUS_PER_KM' ? Number(rate.baseFare || 0) + distance*Number(rate.ratePerKm || 0) : distance*Number(rate.ratePerKm || 0);
  fare = Math.max(fare, Number(rate.minimumFare || 0));
  const doc = await M.TownService.create({
    ...b, reference:code('TS'), estimatedFare:Math.round(fare*100)/100, finalFare:Math.round(fare*100)/100,
    pricingMode:rate.pricingMode, baseFare:rate.baseFare, ratePerKm:rate.ratePerKm, fareRate:rate.id, createdBy:req.user.id
  });
  await audit(req,'CREATE','town-services',doc.id,null,doc.toObject()); res.status(201).json(await doc.populate('vehicle driver customer fareRate'));
}));
app.put('/api/town-services/:id', authenticate, allowRoles(...operations), asyncHandler(async (req,res) => {
  const old = await M.TownService.findById(req.params.id); if (!old) return res.status(404).json({message:'Service not found.'});
  const patch = {...req.body}; delete patch._id; delete patch.reference; delete patch.createdBy;
  if (patch.status === 'In Progress' && !old.startedAt) patch.startedAt = new Date();
  if (patch.status === 'Completed') {
    patch.completedAt = new Date();
    if (patch.actualDistanceKm != null) {
      const distance = Number(patch.actualDistanceKm);
      patch.finalFare = old.pricingMode === 'FIXED' ? old.estimatedFare : old.pricingMode === 'BASE_PLUS_PER_KM' ? Number(old.baseFare||0)+distance*Number(old.ratePerKm||0) : distance*Number(old.ratePerKm||0);
    }
  }
  const doc = await M.TownService.findByIdAndUpdate(req.params.id,patch,{new:true,runValidators:true});
  if (old.status !== doc.status) await M.Notification.create({title:'Town service status updated',message:`${doc.reference}: ${old.status} → ${doc.status}`,type:'TOWN_SERVICE',relatedEntity:'TownService',relatedId:doc.id});
  await audit(req,'UPDATE','town-services',doc.id,old.toObject(),doc.toObject()); res.json(await doc.populate('vehicle driver customer fareRate'));
}));

// Driver, passenger and management workflow actions for town services.
app.post('/api/town-services/:id/driver-response', authenticate, allowRoles('Driver','Administrator','Transport Manager'), asyncHandler(async(req,res)=>{
 const doc=await M.TownService.findById(req.params.id); if(!doc)return res.status(404).json({message:'Town service not found.'});
 const action=String(req.body.action||'');
 let actorDriver=null;
 if(req.user.role==='Driver'){
   actorDriver=await resolveDriverProfile(req.user);
   if(!actorDriver)return res.status(403).json({message:'Your login is not linked to a driver profile. Ask an administrator to ensure your account phone matches your driver record.'});
 }
 if(action==='accept'){
   const isReferredDriver = req.user.role === 'Driver' && doc.status === 'Driver Assigned' && String(doc.referredDriver || '') === String(actorDriver?._id || '');
   if(doc.status !== 'Requested' && !isReferredDriver) return res.status(409).json({message:'This request is no longer available for acceptance.'});
   if(req.user.role==='Driver') doc.driver=actorDriver._id;
   if(!doc.vehicle){
     // Claim only an Available vehicle atomically; never steal one already assigned to another service.
     const vehicle=await M.Vehicle.findOneAndUpdate({status:'Available'},{$set:{status:'Town Service'}},{new:true,sort:{createdAt:1}});
     if(!vehicle)return res.status(409).json({message:'No available vehicle. Ask the transport manager to assign a vehicle.'});
     doc.vehicle=vehicle._id;
   }
   doc.referredDriver=undefined;doc.driverResponse='Accepted';doc.passengerReferralDecision='Pending';doc.status='Accepted';
   await notify('Town service accepted',`${doc.reference}: a driver accepted the request. Vehicle ${await vehicleLabel(doc.vehicle)} assigned.`, 'TOWN_SERVICE','TownService',doc.id);
 } else if(action==='reject'){
   if(req.user.role==='Driver' && ((doc.driver && String(doc.driver)!==String(actorDriver._id)) || (doc.status==='Driver Assigned' && String(doc.referredDriver||'')!==String(actorDriver._id)))) return res.status(403).json({message:'You cannot reject a request assigned or referred to another driver.'});
   if(req.user.role==='Driver' && !['Requested','Driver Assigned'].includes(doc.status)) return res.status(409).json({message:'This request is no longer available to decline.'});
   doc.driverResponse='Rejected';doc.status='Requested';doc.driver=undefined;
   await notify('Town service needs a driver',`${doc.reference} was declined and is available for another driver.`, 'TOWN_SERVICE','TownService',doc.id);
 } else if(action==='refer'){
   if(!['Administrator','Transport Manager'].includes(req.user.role))return res.status(403).json({message:'Only a manager can refer a request to another driver.'});
   const target=await M.Driver.findById(req.body.driver);if(!target||target.employmentStatus!=='Active')return res.status(400).json({message:'Choose an active driver.'});
   doc.driverResponse='Referred';doc.referredDriver=target._id;doc.passengerReferralDecision='Pending';doc.status='Driver Assigned';
   await notify('Driver referral awaiting passenger',`${doc.reference} has been referred to ${target.name}; passenger acknowledgement is required.`, 'TOWN_SERVICE','TownService',doc.id);
 } else return res.status(400).json({message:'Action must be accept, reject or refer.'});
 await doc.save();await audit(req,'UPDATE','town-services',doc.id,null,doc.toObject());res.json(await doc.populate('vehicle driver referredDriver fareRate'));
}));
async function vehicleLabel(vehicleId){const v=await M.Vehicle.findById(vehicleId).select('registrationNumber');return v?.registrationNumber||'vehicle assigned';}
app.post('/api/passenger/town-services/:id/referral-decision', authenticate, allowRoles('Passenger'), asyncHandler(async(req,res)=>{const doc=await M.TownService.findOne({_id:req.params.id,createdBy:req.user.id});if(!doc)return res.status(404).json({message:'Service not found.'});if(doc.driverResponse!=='Referred'||doc.passengerReferralDecision!=='Pending')return res.status(400).json({message:'No pending driver referral.'});doc.passengerReferralDecision=req.body.decision==='accept'?'Accepted':'Declined';if(doc.passengerReferralDecision==='Declined'){doc.driver=undefined;doc.referredDriver=undefined;doc.driverResponse='Pending';doc.status='Requested';}else{doc.driver=doc.referredDriver;doc.referredDriver=undefined;doc.driverResponse='Pending';}await doc.save();await audit(req,'UPDATE','town-services',doc.id,null,doc.toObject());res.json(doc);}));
app.post('/api/town-services/:id/confirm', authenticate, asyncHandler(async(req,res)=>{const doc=await M.TownService.findById(req.params.id);if(!doc)return res.status(404).json({message:'Service not found.'});const role=req.user.role;const action=req.body.action;if(role==='Passenger'&&String(doc.createdBy)!==req.user.id)return res.status(403).json({message:'This is not your service.'});if(!['Passenger','Driver','Administrator','Transport Manager'].includes(role))return res.status(403).json({message:'Not authorized.'});if(action==='vehicle-arrived'){if(role==='Passenger')doc.passengerArrivalConfirmedAt=new Date();else if(role==='Driver')doc.driverArrivalConfirmedAt=new Date();else {doc.passengerArrivalConfirmedAt ||= new Date();doc.driverArrivalConfirmedAt ||= new Date();}}else if(action==='destination-reached'){if(role==='Passenger')doc.passengerDestinationConfirmedAt=new Date();else if(role==='Driver')doc.driverDestinationConfirmedAt=new Date();else {doc.passengerDestinationConfirmedAt ||= new Date();doc.driverDestinationConfirmedAt ||= new Date();}if(doc.passengerDestinationConfirmedAt&&doc.driverDestinationConfirmedAt){doc.status='Completed';doc.completedAt=new Date();await M.Notification.deleteMany({relatedEntity:'TownService',relatedId:doc.id});if(doc.vehicle)await M.Vehicle.findByIdAndUpdate(doc.vehicle,{$set:{status:'Available'}});}}else return res.status(400).json({message:'Unknown confirmation action.'});await doc.save();await audit(req,'UPDATE','town-services',doc.id,null,doc.toObject());res.json(doc);}));
app.post('/api/town-services/:id/payment', authenticate, allowRoles('Passenger','Administrator','Transport Manager','Accountant','Booking Officer'), asyncHandler(async(req,res)=>{const doc=await M.TownService.findById(req.params.id);if(!doc)return res.status(404).json({message:'Service not found.'});if(req.user.role==='Passenger'&&String(doc.createdBy)!==req.user.id)return res.status(403).json({message:'This is not your service.'});const amount=Number(req.body.amount??doc.finalFare??doc.estimatedFare??0);if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({message:'Enter a valid payment amount.'});const payment=await M.Payment.create({townService:doc._id,amount,method:req.body.method||doc.paymentMethod||'Cash',payer:req.user.id,payerName:req.user.name,serviceType:'Town Service',paidAt:new Date(),receivedBy:req.user.id,status:req.body.status||'Successful',transactionReference:req.body.transactionReference,notes:req.body.notes});doc.paymentMethod=payment.method;doc.paymentRecordedBy=req.user.id;doc.paidAt=payment.paidAt;doc.paymentStatus=payment.status==='Successful'?'Paid':'Unpaid';await doc.save();await audit(req,'CREATE','payments',payment.id,null,payment.toObject());res.status(201).json({payment,service:doc});}));

// Passenger town-service requests: passengers can request a driver-operated town journey and manage their own requests.
app.get('/api/passenger/town-services', authenticate, allowRoles('Passenger'), asyncHandler(async (req,res) => {
  res.json(await M.TownService.find({createdBy:req.user.id}).populate('vehicle driver fareRate').sort({createdAt:-1}).limit(200));
}));
app.post('/api/passenger/town-services', authenticate, allowRoles('Passenger'), asyncHandler(async (req,res) => {
  const {pickup,destination,scheduledAt,estimatedDistanceKm,notes,customerPhone}=req.body;
  if(!String(pickup||'').trim() || !String(destination||'').trim()) return res.status(400).json({message:'Pickup and destination are required.'});
  const distance=Number(estimatedDistanceKm);
  if(!Number.isFinite(distance)||distance<=0) return res.status(400).json({message:'Enter an estimated distance greater than zero.'});
  const rate=await M.FareRate.findOne({active:true}).sort({createdAt:1});
  if(!rate) return res.status(400).json({message:'Town service requests are not available yet because the operator has not configured an active fare rate.'});
  let fare=rate.pricingMode==='FIXED'?Number(rate.fixedFare||0):rate.pricingMode==='BASE_PLUS_PER_KM'?Number(rate.baseFare||0)+distance*Number(rate.ratePerKm||0):distance*Number(rate.ratePerKm||0);fare=Math.max(fare,Number(rate.minimumFare||0));
  const passenger=await M.Passenger.findOne({email:req.user.email});
  const doc=await M.TownService.create({reference:code('TS'),customerName:req.user.name,customerPhone:customerPhone||passenger?.phone||'',pickup:String(pickup).trim(),destination:String(destination).trim(),scheduledAt:scheduledAt?new Date(scheduledAt):undefined,estimatedDistanceKm:distance,estimatedFare:Math.max(Number(rate.minimumFare||0),fare),fareRate:rate._id,pricingMode:rate.pricingMode,baseFare:rate.baseFare,ratePerKm:rate.ratePerKm,notes:String(notes||''),status:'Requested',createdBy:req.user.id});
  await audit(req,'CREATE','town-services',doc.id,null,doc.toObject());
  await notify('New passenger town-service request',`${doc.reference}: ${doc.pickup} → ${doc.destination}. Driver action required.`, 'TOWN_SERVICE','TownService',doc.id);
  res.status(201).json(await doc.populate('vehicle driver fareRate'));
}));
app.put('/api/passenger/town-services/:id', authenticate, allowRoles('Passenger'), asyncHandler(async (req,res) => {
  const doc=await M.TownService.findOne({ _id:req.params.id, createdBy:req.user.id });
  if(!doc) return res.status(404).json({message:'Town service request not found.'});
  if(!['Requested'].includes(doc.status)) return res.status(400).json({message:'Only requests that have not yet been accepted can be edited.'});
  const {pickup,destination,scheduledAt,estimatedDistanceKm,notes,customerPhone}=req.body;
  if(pickup!==undefined) doc.pickup=String(pickup).trim(); if(destination!==undefined) doc.destination=String(destination).trim();
  if(scheduledAt!==undefined) doc.scheduledAt=scheduledAt?new Date(scheduledAt):undefined;
  if(estimatedDistanceKm!==undefined){const d=Number(estimatedDistanceKm);if(!Number.isFinite(d)||d<=0)return res.status(400).json({message:'Estimated distance must be greater than zero.'});doc.estimatedDistanceKm=d;const rate=await M.FareRate.findById(doc.fareRate);if(rate){const f=rate.pricingMode==='FIXED'?Number(rate.fixedFare||0):Number(rate.baseFare||0)+d*Number(rate.ratePerKm||0);doc.estimatedFare=Math.max(Number(rate.minimumFare||0),f)}}
  if(notes!==undefined)doc.notes=String(notes); if(customerPhone!==undefined)doc.customerPhone=String(customerPhone);
  await doc.save(); await audit(req,'UPDATE','town-services',doc.id,null,doc.toObject()); res.json(await doc.populate('vehicle driver fareRate'));
}));
app.post('/api/passenger/town-services/:id/confirm-request', authenticate, allowRoles('Passenger'), asyncHandler(async(req,res)=>{
 const doc=await M.TownService.findOne({_id:req.params.id,createdBy:req.user.id});
 if(!doc)return res.status(404).json({message:'Town service request not found.'});
 if(!['Accepted','Driver Assigned','Vehicle Dispatched'].includes(doc.status))return res.status(400).json({message:'The request can only be confirmed after a driver accepts or is assigned.'});
 doc.passengerRequestConfirmedAt=new Date();await doc.save();await notify('Passenger confirmed town service',`${doc.reference}: passenger acknowledged the driver/vehicle assignment.`,'TOWN_SERVICE','TownService',doc.id);await audit(req,'UPDATE','town-services',doc.id,null,doc.toObject());res.json(await doc.populate('vehicle driver fareRate'));
}));

app.post('/api/passenger/town-services/:id/cancel', authenticate, allowRoles('Passenger'), asyncHandler(async (req,res) => {
  const doc=await M.TownService.findOne({_id:req.params.id,createdBy:req.user.id});
  if(!doc) return res.status(404).json({message:'Town service request not found.'});
  if(!['Requested','Accepted','Driver Assigned'].includes(doc.status)) return res.status(400).json({message:'This request can no longer be cancelled online. Contact the operator for assistance.'});
  if(doc.vehicle) await M.Vehicle.findByIdAndUpdate(doc.vehicle,{$set:{status:'Available'}});
  doc.status='Cancelled'; await doc.save(); await M.Notification.deleteMany({relatedEntity:'TownService',relatedId:doc.id}); await audit(req,'UPDATE','town-services',doc.id,null,doc.toObject()); res.json(doc);
}));

// Passenger self-service: browse scheduled trips and create/view only their own bookings.
app.get('/api/passenger/trips', authenticate, allowRoles('Passenger'), asyncHandler(async (req,res) => {
  const trips = await M.Trip.find({status:{$in:['Scheduled','Boarding']},departureAt:{$gte:new Date()}}).populate('route vehicle driver').sort({departureAt:1}).limit(200);
  const result = await Promise.all(trips.map(async t => { const count=await M.Booking.countDocuments({trip:t.id,status:{$ne:'Cancelled'}}); return {...t.toObject(), seatsAvailable:Math.max(0,(t.vehicle?.seatCapacity||0)-count), availableVehicles: t.vehicle && ['Available','Assigned'].includes(t.vehicle.status) ? [{_id:t.vehicle.id,registrationNumber:t.vehicle.registrationNumber,type:t.vehicle.type,seatCapacity:t.vehicle.seatCapacity}] : []}; }));
  res.json(result.filter(t=>t.seatsAvailable>0));
}));
app.get('/api/passenger/bookings', authenticate, allowRoles('Passenger'), asyncHandler(async (req,res) => {
  const p=await M.Passenger.findOne({email:req.user.email}); if(!p)return res.json([]);
  res.json(await M.Booking.find({passenger:p._id}).populate({path:'trip',populate:'route vehicle driver'}).sort({createdAt:-1}));
}));
app.post('/api/passenger/bookings', authenticate, allowRoles('Passenger'), asyncHandler(async (req,res) => {
  const {trip:tripId, vehicleChoice='auto'}=req.body;
  const trip=await M.Trip.findById(tripId).populate('route vehicle driver');
  if(!trip || !['Scheduled','Boarding'].includes(trip.status) || trip.departureAt < new Date()) return res.status(400).json({message:'This trip is no longer available.'});
  const passenger=await M.Passenger.findOne({email:req.user.email}); if(!passenger)return res.status(400).json({message:'Passenger profile not found. Please contact support.'});
  const count=await M.Booking.countDocuments({trip:tripId,status:{$ne:'Cancelled'}});
  if(count >= (trip.vehicle?.seatCapacity||0)) return res.status(400).json({message:'This trip is fully booked.'});
  if(vehicleChoice!=='auto' && String(trip.vehicle?._id)!==String(vehicleChoice)) return res.status(400).json({message:'Please select the vehicle assigned to this scheduled trip.'});
  const occupied=await M.Booking.find({trip:tripId,status:{$ne:'Cancelled'}}).select('seatNumber');
  const used=new Set(occupied.map(b=>b.seatNumber)); let seatNumber='1'; while(used.has(seatNumber)) seatNumber=String(Number(seatNumber)+1);
  const amount=Number(trip.route?.fare||0);
  const doc=await M.Booking.create({trip:tripId,passenger:passenger.id,seatNumber,amount,reference:code('BKG'),bookedBy:req.user.id,status:'Confirmed'});
  await audit(req,'CREATE','bookings',doc.id,null,doc.toObject());
  res.status(201).json(await M.Booking.findById(doc.id).populate({path:'trip',populate:'route vehicle driver'}));
}));

// Bookings enforce seat uniqueness and vehicle capacity.
app.get('/api/bookings', authenticate, asyncHandler(async (req,res) => res.json(await M.Booking.find().populate('trip passenger').sort({createdAt:-1}).limit(300))));
app.post('/api/bookings', authenticate, allowRoles(...operations), asyncHandler(async (req,res) => {
  const {trip:tripId, passenger, seatNumber, amount} = req.body;
  const trip = await M.Trip.findById(tripId).populate('vehicle');
  if (!trip || ['Cancelled','Completed'].includes(trip.status)) return res.status(400).json({message:'Trip is unavailable for booking.'});
  if (Number(amount) < 0) return res.status(400).json({message:'Amount cannot be negative.'});
  const count = await M.Booking.countDocuments({trip:tripId,status:{$ne:'Cancelled'}});
  if (count >= trip.vehicle.seatCapacity) return res.status(400).json({message:'No seats remain on this trip.'});
  try {
    const doc = await M.Booking.create({ ...req.body, reference:code('BKG'), bookedBy:req.user.id });
    await audit(req,'CREATE','bookings',doc.id,null,doc.toObject()); res.status(201).json(doc);
  } catch(e) { if (e.code === 11000) return res.status(409).json({message:'That seat is already booked for this trip.'}); throw e; }
}));
app.put('/api/bookings/:id', authenticate, allowRoles(...operations), asyncHandler(async (req,res) => {
  const old = await M.Booking.findById(req.params.id); if (!old) return res.status(404).json({message:'Booking not found.'});
  const patch = {...req.body}; delete patch._id; delete patch.reference; delete patch.trip; delete patch.passenger;
  const doc = await M.Booking.findByIdAndUpdate(req.params.id,patch,{new:true,runValidators:true});
  await audit(req,'UPDATE','bookings',doc.id,old.toObject(),doc.toObject()); res.json(doc);
}));

app.get('/api/dashboard', authenticate, asyncHandler(async (req,res) => {
  const today = new Date(); today.setHours(0,0,0,0); const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1);
  const [vehicles,drivers,tripsToday,bookingsToday,servicesToday,revenue,openFuelAlerts,maintenanceDue,gpsRecent] = await Promise.all([
    M.Vehicle.find().lean(), M.Driver.countDocuments(), M.Trip.countDocuments({departureAt:{$gte:today,$lt:tomorrow}}),
    M.Booking.countDocuments({createdAt:{$gte:today,$lt:tomorrow},status:{$ne:'Cancelled'}}),
    M.TownService.countDocuments({createdAt:{$gte:today,$lt:tomorrow},status:{$ne:'Cancelled'}}),
    M.Payment.aggregate([{$match:{paidAt:{$gte:today,$lt:tomorrow},status:'Successful'}},{$group:{_id:null,total:{$sum:'$amount'}}}]),
    M.FuelAnomaly.countDocuments({status:{$in:['Open','Under Investigation']}}),
    M.Maintenance.countDocuments({$or:[{nextServiceDate:{$lte:new Date()}},{status:{$in:['Scheduled','In Progress']}}]}),
    M.GpsLocation.find().sort({recordedAt:-1}).limit(1)
  ]);
  res.json({vehicles:vehicles.length,availableVehicles:vehicles.filter(v=>v.status==='Available').length,onTrip:vehicles.filter(v=>v.status==='On Trip').length,townServiceVehicles:vehicles.filter(v=>v.status==='Town Service').length,underMaintenance:vehicles.filter(v=>v.status==='Under Maintenance').length,drivers,tripsToday,bookingsToday,servicesToday,revenueToday:revenue[0]?.total||0,openFuelAlerts,maintenanceDue,lastGps:gpsRecent[0]||null});
}));

app.get('/api/reports', authenticate, asyncHandler(async (req,res) => {
  const [vehicleStatuses,tripStatuses,bookingStatuses,serviceStatuses,paymentTotals,fuelTotals,monthlyRevenue] = await Promise.all([
    M.Vehicle.aggregate([{$group:{_id:'$status',count:{$sum:1}}}]),
    M.Trip.aggregate([{$group:{_id:'$status',count:{$sum:1}}}]),
    M.Booking.aggregate([{$group:{_id:'$paymentStatus',count:{$sum:1},amount:{$sum:'$amount'}}}]),
    M.TownService.aggregate([{$group:{_id:'$status',count:{$sum:1},fare:{$sum:'$finalFare'}}}]),
    M.Payment.aggregate([{$match:{status:'Successful'}},{$group:{_id:'$method',amount:{$sum:'$amount'},count:{$sum:1}}}]),
    M.FuelTransaction.aggregate([{$group:{_id:'$fuelType',litres:{$sum:'$quantityLitres'},cost:{$sum:'$totalCost'}}}]),
    M.Payment.aggregate([{$match:{status:'Successful'}},{$group:{_id:{$dateToString:{format:'%Y-%m',date:'$paidAt'}},revenue:{$sum:'$amount'}}},{$sort:{_id:1}},{$limit:12}])
  ]);
  res.json({vehicleStatuses,tripStatuses,bookingStatuses,serviceStatuses,paymentTotals,fuelTotals,monthlyRevenue});
}));

app.get('/api/users', authenticate, allowRoles(...admin), asyncHandler(async (req,res)=>res.json(await M.User.find().sort({createdAt:-1}).select('-passwordHash'))));
app.post('/api/users', authenticate, allowRoles(...admin), asyncHandler(async (req,res)=>{
  const {name,email,password,role,phone,active} = req.body;
  if (!password || password.length < 10) return res.status(400).json({message:'Password must be at least 10 characters.'});
  const doc = await M.User.create({name,email,passwordHash:await bcrypt.hash(password,12),role,phone,active});
  await audit(req,'CREATE','users',doc.id,null,safe(doc.toObject())); res.status(201).json(safe(doc.toObject()));
}));
app.put('/api/users/:id', authenticate, allowRoles(...admin), asyncHandler(async (req,res)=>{
  const patch={...req.body}; delete patch.password; delete patch.passwordHash; delete patch._id;
  if (patch.newPassword) { if(patch.newPassword.length<10) return res.status(400).json({message:'Password must be at least 10 characters.'}); patch.passwordHash=await bcrypt.hash(patch.newPassword,12); delete patch.newPassword; }
  const doc=await M.User.findByIdAndUpdate(req.params.id,patch,{new:true,runValidators:true}).select('-passwordHash');
  if(!doc) return res.status(404).json({message:'User not found.'}); await audit(req,'UPDATE','users',doc.id,null,safe(doc.toObject())); res.json(doc);
}));

app.delete('/api/users/:id', authenticate, allowRoles(...admin), asyncHandler(async(req,res)=>{if(req.params.id===req.user.id)return res.status(400).json({message:'You cannot delete your own active administrator account.'});const doc=await M.User.findByIdAndDelete(req.params.id);if(!doc)return res.status(404).json({message:'User not found.'});await audit(req,'DELETE','users',doc.id,safe(doc.toObject()),null);res.json({message:'User deleted.'});}));

app.use((err,req,res,next)=>{
  console.error(err);
  if (err?.code === 11000) return res.status(409).json({message:'A record with that unique value already exists.'});
  if (err?.name === 'ValidationError' || err?.name === 'CastError') return res.status(400).json({message:err.message});
  res.status(500).json({message:process.env.NODE_ENV === 'production' ? 'Unexpected server error.' : err.message});
});

const port = Number(process.env.PORT || 4000);
await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transport_management_system');
console.log('Connected to MongoDB');
app.listen(port,()=>console.log(`TMS API listening on http://localhost:${port}`));

import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User, FareRate } from './models.js';
await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transport_management_system');
const email = 'admin@tms.local';
let user = await User.findOne({email}).select('+passwordHash');
if (!user) {
  user = await User.create({name:'TMS Administrator',email,passwordHash:await bcrypt.hash('ChangeMe123!',12),role:'Administrator',active:true});
  console.log('Created demo administrator: admin@tms.local / ChangeMe123!');
} else console.log('Demo administrator already exists; password was not changed.');
if (!await FareRate.findOne({active:true})) {
  await FareRate.create({name:'Default town service rate',pricingMode:'PER_KM',ratePerKm:20,minimumFare:0,active:true,createdBy:user.id});
  console.log('Created default fare rate of 20 per km. Change it in Fare Rates.');
}
await mongoose.disconnect();

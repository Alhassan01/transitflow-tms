const base = process.env.API_BASE_URL || 'http://127.0.0.1:4000/api';
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const results = [];

async function request(path, { token, method = 'GET', body, expected = [200] } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!expected.includes(response.status)) throw new Error(`${method} ${path}: expected ${expected.join('/')} but got ${response.status}: ${raw}`);
  return { data, status: response.status };
}
function check(name, condition, detail = '') {
  if (!condition) throw new Error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  results.push(`PASS ${name}`);
  console.log(`PASS ${name}`);
}

try {
  const adminLogin = await request('/auth/login', { method: 'POST', body: { email: 'admin@tms.local', password: 'ChangeMe123!' } });
  const admin = adminLogin.data.token;
  check('administrator login', Boolean(admin));

  const vehicleRes = await request('/vehicles', { token: admin, method: 'POST', body: { registrationNumber: `QA-${suffix}`.slice(0, 20), type: 'Sedan', make: 'QA', model: 'Test', seatCapacity: 4, status: 'Available' }, expected: [201] });
  const vehicle = vehicleRes.data;
  check('create available vehicle', Boolean(vehicle?._id));

  const phone = `+232${String(Date.now()).slice(-8)}`;
  const driverUserRes = await request('/users', { token: admin, method: 'POST', body: { name: `QA Driver ${suffix}`, email: `driver-${suffix}@example.test`, password: 'DriverTest123!', role: 'Driver', phone, active: true }, expected: [201] });
  check('create driver login', Boolean(driverUserRes.data?._id));
  const driverProfileRes = await request('/drivers', { token: admin, method: 'POST', body: { name: `QA Driver ${suffix}`, phone, driverCode: `QD${String(Date.now()).slice(-8)}`, licenseNumber: `QL${String(Date.now()).slice(-8)}`, employmentStatus: 'Active' }, expected: [201] });
  check('create linked driver profile', Boolean(driverProfileRes.data?._id));
  const driverLogin = await request('/auth/login', { method: 'POST', body: { email: `driver-${suffix}@example.test`, password: 'DriverTest123!' } });
  const driver = driverLogin.data.token;
  check('driver login', Boolean(driver));

  const passengerLogin = await request('/auth/register', { method: 'POST', body: { name: `QA Passenger ${suffix}`, email: `passenger-${suffix}@example.test`, password: 'PassengerTest123!', phone: `+232${String(Date.now() + 1).slice(-8)}` }, expected: [201] });
  const passenger = passengerLogin.data.token;
  check('passenger registration', Boolean(passenger));

  const rates = await request('/fare-rates?limit=20', { token: admin });
  const rate = rates.data.find(item => item.active);
  check('active fare rate available', Boolean(rate?._id));

  const createRequest = await request('/passenger/town-services', { token: passenger, method: 'POST', body: { pickup: 'QA Pickup', destination: 'QA Destination', estimatedDistanceKm: 5, notes: 'Automated integration test' }, expected: [201] });
  const serviceId = createRequest.data?._id;
  check('passenger creates request with fare', Boolean(serviceId) && Number(createRequest.data.estimatedFare) > 0);

  const driverQueue = await request('/town-services', { token: driver });
  check('driver sees open passenger request', driverQueue.data.some(item => item._id === serviceId));

  const accepted = await request(`/town-services/${serviceId}/driver-response`, { token: driver, method: 'POST', body: { action: 'accept' } });
  check('driver accepts request and vehicle is assigned', accepted.data.status === 'Accepted' && Boolean(accepted.data.vehicle?._id));
  check('vehicle marked as in town service', (await request(`/vehicles?limit=100`, { token: admin })).data.some(item => item._id === vehicle._id && item.status === 'Town Service'));

  const confirmed = await request(`/passenger/town-services/${serviceId}/confirm-request`, { token: passenger, method: 'POST', body: {} });
  check('passenger confirms assignment', Boolean(confirmed.data.passengerRequestConfirmedAt));
  await request(`/town-services/${serviceId}/confirm`, { token: passenger, method: 'POST', body: { action: 'vehicle-arrived' } });
  await request(`/town-services/${serviceId}/confirm`, { token: driver, method: 'POST', body: { action: 'vehicle-arrived' } });
  check('both parties confirm vehicle arrival', true);
  const passengerDestination = await request(`/town-services/${serviceId}/confirm`, { token: passenger, method: 'POST', body: { action: 'destination-reached' } });
  check('one destination confirmation does not prematurely complete service', passengerDestination.data.status !== 'Completed');
  const driverDestination = await request(`/town-services/${serviceId}/confirm`, { token: driver, method: 'POST', body: { action: 'destination-reached' } });
  check('service completes after both destination confirmations', driverDestination.data.status === 'Completed');
  check('vehicle released after service completion', (await request(`/vehicles?limit=100`, { token: admin })).data.some(item => item._id === vehicle._id && item.status === 'Available'));

  const notifications = await request('/notifications?limit=500', { token: admin });
  check('terminal service notifications hidden', !notifications.data.some(item => item.relatedEntity === 'TownService' && String(item.relatedId) === String(serviceId)));

  const payment = await request(`/town-services/${serviceId}/payment`, { token: passenger, method: 'POST', body: { amount: Number(driverDestination.data.finalFare || driverDestination.data.estimatedFare), method: 'Cash' }, expected: [201] });
  check('passenger payment is recorded against service', Boolean(payment.data.payment?._id) && payment.data.payment.serviceType === 'Town Service');

  const otherPassenger = await request('/auth/register', { method: 'POST', body: { name: `QA Other ${suffix}`, email: `other-${suffix}@example.test`, password: 'OtherPassenger123!', phone: `+232${String(Date.now() + 2).slice(-8)}` }, expected: [201] });
  const otherRequest = await request('/passenger/town-services', { token: otherPassenger.data.token, method: 'POST', body: { pickup: 'QA Cancel Pickup', destination: 'QA Cancel Destination', estimatedDistanceKm: 2 }, expected: [201] });
  const forbidden = await request(`/passenger/town-services/${otherRequest.data._id}/cancel`, { token: passenger, method: 'POST', body: {}, expected: [404] });
  check('passenger cannot cancel another passenger request', forbidden.status === 404);
  await request(`/passenger/town-services/${otherRequest.data._id}/cancel`, { token: otherPassenger.data.token, method: 'POST', body: {} });
  check('owner can cancel own request', (await request('/passenger/town-services', { token: otherPassenger.data.token })).data.find(item => item._id === otherRequest.data._id)?.status === 'Cancelled');

  console.log(`\nIntegration suite passed: ${results.length} checks.`);
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}

// In development, Vite proxies /api to the Express server. Set VITE_API_URL
// only when the frontend and backend are hosted on different origins.
const API = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
export function getToken(){ return localStorage.getItem('tms_token'); }
export async function request(path, options = {}) {
  const token = getToken();
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      ...options,
      headers: { 'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {}), ...(options.headers||{}) }
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Cannot connect to the TMS API. Start the backend on port 4000 and make sure MongoDB is running. See README.md → Troubleshooting.');
    }
    throw error;
  }
  const data = res.status === 204 ? null : await res.json().catch(()=>null);
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data;
}
export function saveSession(token,user){ localStorage.setItem('tms_token',token); localStorage.setItem('tms_user',JSON.stringify(user)); }
export function clearSession(){ localStorage.removeItem('tms_token'); localStorage.removeItem('tms_user'); }

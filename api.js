const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:4000') + '/api';

function token() {
  return localStorage.getItem('token');
}
function authHeaders() {
  const t = token();
  return t ? { 'Authorization': `Bearer ${t}` } : {};
}

export async function request(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}), ...authHeaders() };
  const res = await fetch(API_BASE + path, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(()=>({}));
    throw body;
  }
  return res.json();
}

export function login(email,password){
  return fetch(API_BASE + '/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email,password})})
    .then(r => r.json());
}

export function register(payload){
  return fetch(API_BASE + '/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)})
    .then(r => r.json());
}

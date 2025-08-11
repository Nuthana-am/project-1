import React, { useEffect, useState } from 'react';
import * as api from './api';

function Auth({ onLogin }) {
  const [isLogin, setIsLogin] = useState(true);
  const [form, setForm] = useState({ email:'', password:'', name:'', role:'patient' });

  async function submit(e) {
    e.preventDefault();
    try {
      if (isLogin) {
        const { token, user } = await api.login(form.email, form.password);
        localStorage.setItem('token', token);
        onLogin(user);
      } else {
        const { token, user } = await api.register(form);
        localStorage.setItem('token', token);
        onLogin(user);
      }
    } catch (err) {
      alert(err.error || 'Auth failed');
    }
  }

  return (
    <div className="auth">
      <h2>{isLogin ? 'Sign in' : 'Register'}</h2>
      <form onSubmit={submit}>
        {!isLogin && <>
          <label>Name<input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} required/></label>
          <label>Role
            <select value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}>
              <option value="patient">Patient</option>
              <option value="doctor">Doctor</option>
            </select>
          </label>
        </>}
        <label>Email<input value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} type="email" required/></label>
        <label>Password<input value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} type="password" required/></label>
        <button type="submit">{isLogin ? 'Login' : 'Register'}</button>
      </form>
      <button className="link" onClick={()=>setIsLogin(v=>!v)}>{isLogin ? 'Create account' : 'Back to login'}</button>
      <div className="demo-creds">
        <p><strong>Demo accounts:</strong></p>
        <p>Doctor: dr.jane@example.com / doctorpass</p>
        <p>Patient: john.patient@example.com / patientpass</p>
      </div>
    </div>
  );
}

function BookModal({ visible, onClose, doctor, onBooked }) {
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState([]);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState('');

  useEffect(()=>{ if (!visible) { setDate(''); setSlots([]); setSelected(null); setReason(''); } }, [visible]);

  async function loadSlots() {
    if (!date) return alert('Choose date');
    try {
      const res = await api.request(`/doctors/${doctor.id}/availability?date=${date}`);
      setSlots(res.slots || []);
    } catch (err) {
      alert(err.error || 'Failed to load slots');
    }
  }

  async function book() {
    if (!selected) return alert('Select a slot');
    try {
      await api.request('/appointments', { method: 'POST', body: JSON.stringify({ doctorId: doctor.id, startAt: selected.start, durationMinutes: 30, reason }) });
      alert('Appointment booked');
      onBooked();
      onClose();
    } catch (err) {
      alert(err.error || 'Booking failed');
    }
  }

  if (!visible) return null;
  return (
    <div className="modal">
      <div className="modal-inner" role="dialog" aria-modal="true">
        <h3>Book with {doctor.name}</h3>
        <label>Date <input type="date" value={date} onChange={e=>setDate(e.target.value)} /></label>
        <button onClick={loadSlots}>Load available slots</button>
        <div className="slots">
          {slots.length === 0 && <p>No available slots</p>}
          {slots.map(s => (
            <button key={s.start} className={selected?.start === s.start ? 'slot active' : 'slot'} onClick={()=>setSelected(s)}>
              {new Date(s.start).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
            </button>
          ))}
        </div>
        <label>Reason <input value={reason} onChange={e=>setReason(e.target.value)} /></label>
        <div className="actions">
          <button onClick={book}>Confirm</button>
          <button className="secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ user, onLogout }) {
  const [doctors, setDoctors] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [bookingDoctor, setBookingDoctor] = useState(null);

  async function load() {
    try {
      const docs = await api.request('/doctors');
      setDoctors(docs);
      const appts = await api.request('/appointments');
      setAppointments(appts);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(()=>{ load(); }, []);

  async function cancel(id) {
    if (!confirm('Cancel appointment?')) return;
    try {
      await api.request(`/appointments/${id}/cancel`, { method: 'POST' });
      load();
    } catch (err) {
      alert(err.error || 'Cancel failed');
    }
  }

  return (
    <div className="dashboard">
      <header>
        <h2>Welcome, {user.name} ({user.role})</h2>
        <div>
          <button onClick={onLogout}>Logout</button>
        </div>
      </header>

      <section>
        <h3>Find Doctors</h3>
        <div className="cards">
          {doctors.map(d => (
            <div className="card" key={d.id}>
              <div><strong>{d.name}</strong></div>
              <div>{d.specialty}</div>
              <div className="bio">{d.bio}</div>
              <div className="card-actions">
                {user.role === 'patient' && <button onClick={()=>setBookingDoctor(d)}>Book</button>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3>My Appointments</h3>
        <table className="appts">
          <thead><tr><th>When</th><th>Doctor</th><th>Patient</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {appointments.map(a => (
              <tr key={a.id}>
                <td>{new Date(a.startAt).toLocaleString()}</td>
                <td>{a.doctor?.name}</td>
                <td>{a.patient?.name}</td>
                <td>{a.status}</td>
                <td>
                  <a href={(import.meta.env.VITE_API_URL||'http://localhost:4000') + `/api/appointments/${a.id}/ics`} target="_blank" rel="noreferrer">ICS</a>
                  {' '}
                  {a.status === 'scheduled' && <button onClick={()=>cancel(a.id)}>Cancel</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <BookModal visible={!!bookingDoctor} doctor={bookingDoctor} onClose={()=>{ setBookingDoctor(null); }} onBooked={()=>load()} />
    </div>
  );
}

export default function App(){
  const [user, setUser] = useState(null);
  useEffect(()=>{
    const tok = localStorage.getItem('token');
    if (!tok) return;
    api.request('/users/me').then(u=>setUser(u)).catch(()=>localStorage.removeItem('token'));
  },[]);
  function onLogin(u){ api.request('/users/me').then(profile => setUser(profile)).catch(()=>setUser(null)); }
  function onLogout(){ localStorage.removeItem('token'); setUser(null); }

  return (
    <div className="container">
      <h1>Healthcare Appointment System</h1>
      {!user ? <Auth onLogin={onLogin} /> : <Dashboard user={user} onLogout={onLogout} />}
    </div>
  );
}

// backend/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { sequelize, User, Availability, Appointment, Op, init } = require('./models');
const nodemailer = require('nodemailer');
const { createEvent } = require('ics');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';
const REMINDER_HOURS = Number(process.env.REMINDER_HOURS || 24);

// nodemailer transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

async function sendEmail(to, subject, text, html) {
  const from = process.env.EMAIL_FROM || 'Healthcare App <no-reply@healthcare.local>';
  try {
    await transporter.sendMail({ from, to, subject, text, html });
  } catch (err) {
    console.error('Email send error', err.message || err);
  }
}

async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing authorization' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findByPk(payload.id);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/* AUTH */
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role, specialty, phone } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'Missing fields' });
  if (!['doctor','patient'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const existing = await User.findOne({ where: { email } });
  if (existing) return res.status(400).json({ error: 'Email in use' });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, passwordHash, role, specialty, phone });
  const token = signToken(user);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ where: { email } });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = signToken(user);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

/* USERS */
app.get('/api/users/me', authMiddleware, async (req, res) => {
  const u = req.user;
  res.json({ id: u.id, name: u.name, email: u.email, role: u.role, specialty: u.specialty, bio: u.bio, phone: u.phone });
});

/* DOCTORS & AVAILABILITY */
app.get('/api/doctors', async (req, res) => {
  const docs = await User.findAll({ where: { role: 'doctor' }, attributes: ['id','name','specialty','bio','phone','email']});
  res.json(docs);
});

function timeStrToMinutes(t) { const [hh,mm] = t.split(':').map(Number); return hh*60+mm; }
function minutesToTimeStr(m) { const hh = String(Math.floor(m/60)).padStart(2,'0'); const mm = String(m%60).padStart(2,'0'); return `${hh}:${mm}`; }

app.get('/api/doctors/:id/availability', async (req, res) => {
  const { id } = req.params;
  const { date, slotMinutes = 30 } = req.query;
  if (!date) return res.status(400).json({ error: 'Provide date YYYY-MM-DD' });
  const day = new Date(date + 'T00:00:00').getDay();
  const avails = await Availability.findAll({ where: { doctorId: id, dayOfWeek: day } });
  const appointments = await Appointment.findAll({
    where: {
      doctorId: id,
      status: 'scheduled',
      startAt: { [Op.between]: [new Date(date+'T00:00:00'), new Date(date+'T23:59:59')] }
    }
  });

  const busyRanges = appointments.map(a => [new Date(a.startAt).getTime(), new Date(a.endAt).getTime()]);
  const slotMins = Number(slotMinutes);

  const slots = [];
  for (const a of avails) {
    let start = timeStrToMinutes(a.startTime);
    const end = timeStrToMinutes(a.endTime);
    while (start + slotMins <= end) {
      const startDT = new Date(`${date}T${minutesToTimeStr(start)}:00`);
      const endDT = new Date(startDT.getTime() + slotMins * 60 * 1000);
      const overlap = busyRanges.some(([bStart, bEnd]) => !(endDT.getTime() <= bStart || startDT.getTime() >= bEnd));
      if (startDT.getTime() > Date.now() && !overlap) {
        slots.push({ start: startDT.toISOString(), end: endDT.toISOString() });
      }
      start += slotMins;
    }
  }
  res.json({ slots });
});

/* APPOINTMENTS */
app.post('/api/appointments', authMiddleware, async (req, res) => {
  if (req.user.role !== 'patient') return res.status(403).json({ error: 'Only patients can book' });
  const { doctorId, startAt, durationMinutes = 30, reason } = req.body;
  if (!doctorId || !startAt) return res.status(400).json({ error: 'doctorId and startAt required' });

  const start = new Date(startAt);
  const end = new Date(start.getTime() + durationMinutes*60000);

  const conflicts = await Appointment.findOne({
    where: {
      doctorId,
      status: 'scheduled',
      [Op.or]: [
        { startAt: { [Op.between]: [start, end] } },
        { endAt: { [Op.between]: [start, end] } },
        { startAt: { [Op.lte]: start }, endAt: { [Op.gte]: end } }
      ]
    }
  });
  if (conflicts) return res.status(409).json({ error: 'Time slot not available' });

  const appt = await Appointment.create({
    patientId: req.user.id,
    doctorId,
    startAt: start,
    endAt: end,
    durationMinutes,
    reason
  });

  const patient = await User.findByPk(req.user.id);
  const doctor = await User.findByPk(doctorId);
  if (patient && doctor) {
    const subject = `Appointment scheduled: ${patient.name} with ${doctor.name} on ${start.toLocaleString()}`;
    const body = `Appointment scheduled.\n\nPatient: ${patient.name}\nDoctor: ${doctor.name}\nWhen: ${start.toLocaleString()} - ${end.toLocaleString()}\nReason: ${reason || '—'}`;
    sendEmail(patient.email, subject, body);
    sendEmail(doctor.email, subject, body);
  }

  res.json(appt);
});

app.get('/api/appointments', authMiddleware, async (req, res) => {
  const where = req.user.role === 'doctor' ? { doctorId: req.user.id } : { patientId: req.user.id };
  const appts = await Appointment.findAll({ where, include: [
    { model: User, as: 'doctor', attributes: ['id','name','email','specialty'] },
    { model: User, as: 'patient', attributes: ['id','name','email'] }
  ], order: [['startAt','ASC']]});
  res.json(appts);
});

app.post('/api/appointments/:id/cancel', authMiddleware, async (req, res) => {
  const appt = await Appointment.findByPk(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Not found' });
  if (![appt.patientId, appt.doctorId].includes(req.user.id)) return res.status(403).json({ error: 'Not allowed' });
  appt.status = 'cancelled';
  await appt.save();

  const patient = await User.findByPk(appt.patientId);
  const doctor = await User.findByPk(appt.doctorId);
  const subject = `Appointment cancelled: ${patient.name} & ${doctor.name}`;
  const body = `Appointment on ${new Date(appt.startAt).toLocaleString()} was cancelled.`;
  sendEmail(patient.email, subject, body);
  sendEmail(doctor.email, subject, body);

  res.json({ ok: true });
});

/* ICS export */
app.get('/api/appointments/:id/ics', authMiddleware, async (req,res) => {
  const appt = await Appointment.findByPk(req.params.id, {
    include: [
      { model: User, as: 'doctor', attributes: ['name','email'] },
      { model: User, as: 'patient', attributes: ['name','email'] }
    ]
  });
  if (!appt) return res.status(404).json({ error: 'Not found' });
  if (![appt.patientId, appt.doctorId].includes(req.user.id)) return res.status(403).json({ error: 'Not allowed' });

  const start = new Date(appt.startAt);
  const end = new Date(appt.endAt);
  const event = {
    start: [start.getFullYear(), start.getMonth()+1, start.getDate(), start.getHours(), start.getMinutes()],
    end: [end.getFullYear(), end.getMonth()+1, end.getDate(), end.getHours(), end.getMinutes()],
    title: `Appointment: ${appt.patient.name} & ${appt.doctor.name}`,
    description: appt.reason || '',
    status: 'CONFIRMED',
    organizer: { name: 'Healthcare App', email: process.env.EMAIL_FROM || 'no-reply@healthcare.local' },
    attendees: [
      { name: appt.patient.name, email: appt.patient.email, rsvp: true, partstat: 'ACCEPTED' },
      { name: appt.doctor.name, email: appt.doctor.email, rsvp: true, partstat: 'ACCEPTED' }
    ]
  };
  createEvent(event, (error, value) => {
    if (error) return res.status(500).json({ error: 'Failed to create ICS' });
    res.setHeader('Content-Disposition', `attachment; filename=appointment-${appt.id}.ics`);
    res.setHeader('Content-Type', 'text/calendar');
    res.send(value);
  });
});

/* REMINDER JOB: runs every minute. For production use robust scheduler */
cron.schedule('*/1 * * * *', async () => {
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() + REMINDER_HOURS * 3600 * 1000);
    const appts = await Appointment.findAll({
      where: {
        status: 'scheduled',
        reminderSent: false,
        startAt: { [Op.between]: [now, cutoff] }
      },
      include: [
        { model: User, as: 'doctor', attributes: ['name','email'] },
        { model: User, as: 'patient', attributes: ['name','email'] }
      ]
    });

    for (const a of appts) {
      const subject = `Appointment reminder: ${a.patient.name} with ${a.doctor.name} at ${new Date(a.startAt).toLocaleString()}`;
      const body = `Reminder: Appointment on ${new Date(a.startAt).toLocaleString()}.\nPatient: ${a.patient.name}\nDoctor: ${a.doctor.name}\nReason: ${a.reason || '—'}`;
      await sendEmail(a.patient.email, subject, body);
      await sendEmail(a.doctor.email, subject, body);
      a.reminderSent = true;
      await a.save();
      console.log('Reminder sent for', a.id);
    }
  } catch (err) {
    console.error('Reminder job error', err);
  }
});

/* Init & start */
(async () => {
  await init({ seed: true });
  app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
})();

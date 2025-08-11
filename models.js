// backend/models.js
const { Sequelize, DataTypes, Op } = require('sequelize');
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: process.env.DB_STORAGE || './data.db',
  logging: false
});

const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.ENUM('patient', 'doctor'), allowNull: false },
  specialty: { type: DataTypes.STRING },
  bio: { type: DataTypes.TEXT },
  phone: { type: DataTypes.STRING }
}, { timestamps: true });

const Availability = sequelize.define('Availability', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  doctorId: { type: DataTypes.UUID, allowNull: false },
  dayOfWeek: { type: DataTypes.INTEGER, allowNull: false }, // 0=Sunday
  startTime: { type: DataTypes.STRING, allowNull: false }, // "09:00"
  endTime: { type: DataTypes.STRING, allowNull: false } // "17:00"
}, { timestamps: false });

const Appointment = sequelize.define('Appointment', {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  patientId: { type: DataTypes.UUID, allowNull: false },
  doctorId: { type: DataTypes.UUID, allowNull: false },
  startAt: { type: DataTypes.DATE, allowNull: false },
  endAt: { type: DataTypes.DATE, allowNull: false },
  durationMinutes: { type: DataTypes.INTEGER, allowNull: false },
  status: { type: DataTypes.ENUM('scheduled', 'cancelled', 'completed'), defaultValue: 'scheduled' },
  reason: { type: DataTypes.TEXT },
  reminderSent: { type: DataTypes.BOOLEAN, defaultValue: false }
}, { timestamps: true });

// Associations
User.hasMany(Availability, { foreignKey: 'doctorId', sourceKey: 'id' });
Availability.belongsTo(User, { foreignKey: 'doctorId' });
User.hasMany(Appointment, { foreignKey: 'doctorId', as: 'doctorAppointments' });
User.hasMany(Appointment, { foreignKey: 'patientId', as: 'patientAppointments' });
Appointment.belongsTo(User, { foreignKey: 'doctorId', as: 'doctor' });
Appointment.belongsTo(User, { foreignKey: 'patientId', as: 'patient' });

async function init({ seed = true } = {}) {
  await sequelize.sync({ alter: true });

  if (seed) {
    const bcrypt = require('bcrypt');
    const docEmail = 'dr.jane@example.com';
    const patEmail = 'john.patient@example.com';
    const existingDoc = await User.findOne({ where: { email: docEmail }});
    if (!existingDoc) {
      const pwd = await bcrypt.hash('doctorpass', 10);
      const newDoc = await User.create({
        name: 'Dr Jane Smith',
        email: docEmail,
        passwordHash: pwd,
        role: 'doctor',
        specialty: 'General Physician',
        bio: 'Experienced GP',
        phone: '+911234567890'
      });
      const slots = [
        ...[1,2,3,4,5].map(d=>({ doctorId: newDoc.id, dayOfWeek: d, startTime: '09:00', endTime: '12:00' })),
        ...[1,2,3,4,5].map(d=>({ doctorId: newDoc.id, dayOfWeek: d, startTime: '14:00', endTime: '18:00' }))
      ];
      await Availability.bulkCreate(slots);
    }
    const existingPat = await User.findOne({ where: { email: patEmail }});
    if (!existingPat) {
      const pwd = await bcrypt.hash('patientpass', 10);
      await User.create({
        name: 'John Patient',
        email: patEmail,
        passwordHash: pwd,
        role: 'patient',
        phone: '+919876543210'
      });
    }
  }
}

module.exports = { sequelize, User, Availability, Appointment, Op, init };

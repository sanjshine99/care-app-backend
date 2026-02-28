// care-app-backend/seed.js
// Sample data: Milton Keynes (MK) only. 2 admin users, 6 care givers, 16 care receivers (no visits).
// All addresses use real MK postcodes and locations. Run: node seed.js  or  npm run seed

require("dotenv").config();
const mongoose = require("mongoose");
const AdminUser = require("./models/AdminUser");
const CareGiver = require("./models/CareGiver");
const CareReceiver = require("./models/CareReceiver");
const Availability = require("./models/Availability");
const Appointment = require("./models/Appointment");
const Notification = require("./models/Notification");

// AdminUser model requires password min 8 characters
const ADMIN_PASSWORD_1 = "Admin123!"; // 9 chars
const ADMIN_PASSWORD_2 = "Admin456!"; // 9 chars

const ADMIN_USERS = [
  { name: "Sarah Mitchell", email: "sarah.mitchell@carehome.co.uk", password: ADMIN_PASSWORD_1, role: "admin" },
  { name: "James Wilson", email: "james.wilson@carehome.co.uk", password: ADMIN_PASSWORD_2, role: "admin" },
];

const CAREGIVERS = [
  {
    name: "Priya Sharma",
    email: "priya.sharma@carehome.co.uk",
    phone: "07700 900011",
    dateOfBirth: new Date("1987-04-22"),
    gender: "Female",
    address: { street: "14 Midsummer Boulevard", city: "Milton Keynes", postcode: "MK9 2EB" },
    coordinates: { type: "Point", coordinates: [-0.718, 52.048] },
    skills: ["personal_care", "medication_management", "meal_preparation", "companionship"],
    canDrive: true,
    singleHandedOnly: false,
    maxCareReceivers: 15,
    availability: [
      { dayOfWeek: "Monday", slots: [{ startTime: "09:00", endTime: "17:00" }] },
      { dayOfWeek: "Tuesday", slots: [{ startTime: "09:00", endTime: "17:00" }] },
      { dayOfWeek: "Wednesday", slots: [{ startTime: "09:00", endTime: "17:00" }] },
      { dayOfWeek: "Thursday", slots: [{ startTime: "09:00", endTime: "17:00" }] },
      { dayOfWeek: "Friday", slots: [{ startTime: "09:00", endTime: "17:00" }] },
    ],
    timeOff: [],
    isActive: true,
    notes: "Experienced in personal care and medication. Available weekdays 9–5.",
  },
  {
    name: "Oliver Thompson",
    email: "oliver.thompson@carehome.co.uk",
    phone: "07700 900022",
    dateOfBirth: new Date("1984-09-15"),
    gender: "Male",
    address: { street: "32 Portway", city: "Milton Keynes", postcode: "MK2 2DE" },
    coordinates: { type: "Point", coordinates: [-0.735, 52.038] },
    skills: ["personal_care", "mobility_assistance", "medication_management", "specialized_medical"],
    canDrive: true,
    singleHandedOnly: false,
    maxCareReceivers: 15,
    availability: [
      { dayOfWeek: "Monday", slots: [{ startTime: "08:00", endTime: "18:00" }] },
      { dayOfWeek: "Tuesday", slots: [{ startTime: "08:00", endTime: "18:00" }] },
      { dayOfWeek: "Wednesday", slots: [{ startTime: "08:00", endTime: "18:00" }] },
      { dayOfWeek: "Thursday", slots: [{ startTime: "08:00", endTime: "18:00" }] },
      { dayOfWeek: "Friday", slots: [{ startTime: "08:00", endTime: "18:00" }] },
      { dayOfWeek: "Saturday", slots: [{ startTime: "08:00", endTime: "18:00" }] },
      { dayOfWeek: "Sunday", slots: [{ startTime: "08:00", endTime: "18:00" }] },
    ],
    timeOff: [],
    isActive: true,
    notes: "Former NHS healthcare assistant. Full week availability.",
  },
  {
    name: "Sophie Williams",
    email: "sophie.williams@carehome.co.uk",
    phone: "07700 900033",
    dateOfBirth: new Date("1991-01-30"),
    gender: "Female",
    address: { street: "7 Silbury Boulevard", city: "Milton Keynes", postcode: "MK1 1AH" },
    coordinates: { type: "Point", coordinates: [-0.755, 52.041] },
    skills: ["personal_care", "dementia_care", "companionship", "household_tasks", "meal_preparation"],
    canDrive: false,
    singleHandedOnly: false,
    maxCareReceivers: 15,
    availability: [
      { dayOfWeek: "Monday", slots: [{ startTime: "06:00", endTime: "14:00" }] },
      { dayOfWeek: "Tuesday", slots: [{ startTime: "06:00", endTime: "14:00" }] },
      { dayOfWeek: "Wednesday", slots: [{ startTime: "06:00", endTime: "14:00" }] },
      { dayOfWeek: "Thursday", slots: [{ startTime: "06:00", endTime: "14:00" }] },
      { dayOfWeek: "Friday", slots: [{ startTime: "06:00", endTime: "14:00" }] },
    ],
    timeOff: [],
    isActive: true,
    notes: "Specialises in dementia care. Morning shifts only.",
  },
  {
    name: "Mohammed Hassan",
    email: "mohammed.hassan@carehome.co.uk",
    phone: "07700 900044",
    dateOfBirth: new Date("1982-07-08"),
    gender: "Male",
    address: { street: "45 Queensway", city: "Milton Keynes", postcode: "MK3 6AA" },
    coordinates: { type: "Point", coordinates: [-0.768, 52.032] },
    skills: ["mobility_assistance", "meal_preparation", "companionship", "household_tasks"],
    canDrive: true,
    singleHandedOnly: false,
    maxCareReceivers: 15,
    availability: [
      { dayOfWeek: "Monday", slots: [{ startTime: "14:00", endTime: "22:00" }] },
      { dayOfWeek: "Tuesday", slots: [{ startTime: "14:00", endTime: "22:00" }] },
      { dayOfWeek: "Wednesday", slots: [{ startTime: "14:00", endTime: "22:00" }] },
      { dayOfWeek: "Thursday", slots: [{ startTime: "14:00", endTime: "22:00" }] },
      { dayOfWeek: "Friday", slots: [{ startTime: "14:00", endTime: "22:00" }] },
    ],
    timeOff: [],
    isActive: true,
    notes: "Evening shift carer. Mobility and meal prep focus.",
  },
  {
    name: "Emily Clarke",
    email: "emily.clarke@carehome.co.uk",
    phone: "07700 900055",
    dateOfBirth: new Date("1993-11-12"),
    gender: "Female",
    address: { street: "12 Avebury Boulevard", city: "Milton Keynes", postcode: "MK4 4AX" },
    coordinates: { type: "Point", coordinates: [-0.748, 52.022] },
    skills: ["personal_care", "medication_management", "companionship", "household_tasks"],
    canDrive: false,
    singleHandedOnly: false,
    maxCareReceivers: 15,
    availability: [
      { dayOfWeek: "Monday", slots: [{ startTime: "08:00", endTime: "12:00" }, { startTime: "16:00", endTime: "20:00" }] },
      { dayOfWeek: "Tuesday", slots: [{ startTime: "08:00", endTime: "12:00" }, { startTime: "16:00", endTime: "20:00" }] },
      { dayOfWeek: "Wednesday", slots: [{ startTime: "08:00", endTime: "12:00" }, { startTime: "16:00", endTime: "20:00" }] },
      { dayOfWeek: "Thursday", slots: [{ startTime: "08:00", endTime: "12:00" }, { startTime: "16:00", endTime: "20:00" }] },
      { dayOfWeek: "Friday", slots: [{ startTime: "08:00", endTime: "12:00" }, { startTime: "16:00", endTime: "20:00" }] },
    ],
    timeOff: [],
    isActive: true,
    notes: "Split shift availability. Medication and companionship.",
  },
  {
    name: "Daniel Roberts",
    email: "daniel.roberts@carehome.co.uk",
    phone: "07700 900066",
    dateOfBirth: new Date("1979-03-25"),
    gender: "Male",
    address: { street: "88 Church Street", city: "Milton Keynes", postcode: "MK11 3EG" },
    coordinates: { type: "Point", coordinates: [-0.848, 52.045] },
    skills: ["personal_care", "dementia_care", "mobility_assistance", "meal_preparation", "specialized_medical"],
    canDrive: true,
    singleHandedOnly: false,
    maxCareReceivers: 15,
    availability: [
      { dayOfWeek: "Monday", slots: [{ startTime: "09:00", endTime: "17:00" }] },
      { dayOfWeek: "Tuesday", slots: [{ startTime: "09:00", endTime: "17:00" }] },
      { dayOfWeek: "Wednesday", slots: [{ startTime: "09:00", endTime: "17:00" }] },
      { dayOfWeek: "Thursday", slots: [{ startTime: "09:00", endTime: "17:00" }] },
      { dayOfWeek: "Friday", slots: [{ startTime: "09:00", endTime: "17:00" }] },
      { dayOfWeek: "Saturday", slots: [{ startTime: "10:00", endTime: "14:00" }] },
    ],
    timeOff: [
      { startDate: new Date(Date.UTC(2026, 2, 16)), endDate: new Date(Date.UTC(2026, 2, 22)), reason: "Annual leave" },
    ],
    isActive: true,
    notes: "Wide skill set. Weekdays plus Saturday morning. Booked leave 16–22 Mar 2026.",
  },
];

// All Milton Keynes (MK). First 6 match care giver postcodes; rest are real MK areas.
const RECEIVER_POSTCODES = [
  { city: "Milton Keynes", postcode: "MK9 2EB", coords: [-0.718, 52.048] },
  { city: "Milton Keynes", postcode: "MK2 2DE", coords: [-0.735, 52.038] },
  { city: "Milton Keynes", postcode: "MK1 1AH", coords: [-0.755, 52.041] },
  { city: "Milton Keynes", postcode: "MK3 6AA", coords: [-0.768, 52.032] },
  { city: "Milton Keynes", postcode: "MK4 4AX", coords: [-0.748, 52.022] },
  { city: "Milton Keynes", postcode: "MK11 3EG", coords: [-0.848, 52.045] },
  { city: "Milton Keynes", postcode: "MK5 8LD", coords: [-0.728, 52.028] },
  { city: "Milton Keynes", postcode: "MK6 3NN", coords: [-0.738, 52.035] },
  { city: "Milton Keynes", postcode: "MK7 7HH", coords: [-0.688, 52.025] },
  { city: "Milton Keynes", postcode: "MK8 0AA", coords: [-0.808, 52.042] },
  { city: "Milton Keynes", postcode: "MK10 9BB", coords: [-0.698, 52.030] },
  { city: "Milton Keynes", postcode: "MK12 5LH", coords: [-0.808, 52.055] },
  { city: "Milton Keynes", postcode: "MK13 7PL", coords: [-0.778, 52.015] },
  { city: "Milton Keynes", postcode: "MK14 6AN", coords: [-0.768, 52.058] },
  { city: "Milton Keynes", postcode: "MK15 8BJ", coords: [-0.738, 52.062] },
  { city: "Milton Keynes", postcode: "MK16 0AB", coords: [-0.722, 52.068] },
];

const CARE_RECEIVERS = [
  { name: "Margaret Fletcher", street: "22 Saxon Gate", contactName: "Thomas Fletcher", relationship: "Child", gender: "Female", genderPreference: "No Preference" },
  { name: "William Booth", street: "5 Witan Gate", contactName: "Helen Booth", relationship: "Spouse/Partner", gender: "Male", genderPreference: "No Preference" },
  { name: "Dorothy Hayes", street: "41 Elder Gate", contactName: "Rachel Hayes", relationship: "Child", gender: "Female", genderPreference: "Female" },
  { name: "Arthur Greenwood", street: "18 Victoria Street", contactName: "Peter Greenwood", relationship: "Child", gender: "Male", genderPreference: "Male" },
  { name: "Jean Palmer", street: "9 Stratford Road", contactName: "Susan Palmer", relationship: "Child", gender: "Female", genderPreference: "No Preference" },
  { name: "Harold Webb", street: "3 Church Street", contactName: "David Webb", relationship: "Child", gender: "Male", genderPreference: "No Preference" },
  { name: "Irene Collins", street: "7 Grafton Street", contactName: "Michael Collins", relationship: "Child", gender: "Female", genderPreference: "Female" },
  { name: "Raymond Hughes", street: "15 Willen Road", contactName: "Sarah Hughes", relationship: "Child", gender: "Male", genderPreference: "No Preference" },
  { name: "Florence Bennett", street: "2 Burchard Crescent", contactName: "Andrew Bennett", relationship: "Child", gender: "Female", genderPreference: "No Preference" },
  { name: "Stanley Powell", street: "56 Watling Street", contactName: "Linda Powell", relationship: "Spouse/Partner", gender: "Male", genderPreference: "Male" },
  { name: "Edith Russell", street: "11 High Street", contactName: "James Russell", relationship: "Child", gender: "Female", genderPreference: "No Preference" },
  { name: "Albert Stewart", street: "24 Bradwell Road", contactName: "Patricia Stewart", relationship: "Child", gender: "Male", genderPreference: "No Preference" },
  { name: "Gladys Mason", street: "8 Heelands", contactName: "Christopher Mason", relationship: "Child", gender: "Female", genderPreference: "Female" },
  { name: "Norman Hunt", street: "19 Great Linford Lane", contactName: "Jennifer Hunt", relationship: "Child", gender: "Male", genderPreference: "No Preference" },
  { name: "Marjorie Gardner", street: "4 Newport Road", contactName: "Robert Gardner", relationship: "Child", gender: "Female", genderPreference: "No Preference" },
  { name: "Herbert Reynolds", street: "31 Tongwell Street", contactName: "Elizabeth Reynolds", relationship: "Spouse/Partner", gender: "Male", genderPreference: "No Preference" },
];

function buildCareReceiver(cr, index, postcodeInfo) {
  const suffix = String(200 + index).padStart(3, "0");
  const phone = `07700900${suffix}`;
  const contactPhone = `07700901${suffix}`;
  return {
    name: cr.name,
    email: `${cr.name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
    phone,
    dateOfBirth: new Date(1935 + (index % 25), (index % 12), 1 + (index % 20)),
    gender: cr.gender,
    genderPreference: cr.genderPreference,
    address: { street: cr.street, city: postcodeInfo.city, postcode: postcodeInfo.postcode },
    coordinates: { type: "Point", coordinates: postcodeInfo.coords },
    emergencyContact: {
      name: cr.contactName,
      relationship: cr.relationship,
      phone: contactPhone,
      email: `contact.${index + 1}@example.com`,
    },
    dailyVisits: [],
    isActive: true,
    notes: "",
  };
}

async function runSeed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/care_system_db");
    console.log("Connected to MongoDB\n");

    console.log("Clearing existing data...");
    await Promise.all([
      Notification.deleteMany({}),
      Appointment.deleteMany({}),
      Availability.deleteMany({}),
      CareReceiver.deleteMany({}),
      CareGiver.deleteMany({}),
      AdminUser.deleteMany({}),
    ]);
    console.log("Cleared.\n");

    console.log("Creating 2 admin users...");
    for (const u of ADMIN_USERS) {
      await AdminUser.create(u);
      console.log(`  ${u.email}`);
    }

    console.log("\nCreating 6 care givers...");
    const createdCareGivers = await CareGiver.insertMany(CAREGIVERS);
    createdCareGivers.forEach((cg) => console.log(`  ${cg.name} (${cg.address.postcode})`));

    console.log("\nCreating Availability for each care giver...");
    for (const cg of createdCareGivers) {
      const doc = CAREGIVERS.find((c) => c.email === cg.email);
      await Availability.create({
        careGiver: cg._id,
        effectiveFrom: new Date(0),
        effectiveTo: null,
        schedule: doc.availability,
        timeOff: doc.timeOff || [],
        isActive: true,
        notes: doc.notes || "",
        version: 1,
      });
    }
    console.log("  6 availability records created.");

    console.log("\nCreating care receivers (no recurring visits, at least one per care giver postcode)...");
    const careReceiversToCreate = RECEIVER_POSTCODES.map((pc, i) =>
      buildCareReceiver(CARE_RECEIVERS[i], i, pc)
    );
    const createdCareReceivers = await CareReceiver.insertMany(careReceiversToCreate);
    createdCareReceivers.forEach((cr) =>
      console.log(`  ${cr.name} (${cr.address.postcode}, preference: ${cr.genderPreference})`)
    );

    console.log("\n" + "=".repeat(60));
    console.log("SEED COMPLETE");
    console.log("=".repeat(60));
    console.log("\nAdmin users (passwords in plain text for login):");
    console.log("  Sarah Mitchell: email = sarah.mitchell@carehome.co.uk   password = " + ADMIN_PASSWORD_1);
    console.log("  James Wilson:   email = james.wilson@carehome.co.uk     password = " + ADMIN_PASSWORD_2);
    console.log("\nCare givers: 6 (with availability: 9–5 weekdays, 8–6 full week, morning, evening, split, + time off)");
    console.log(`Care receivers: ${createdCareReceivers.length} (no daily/recurring visits; first 6 match care giver MK postcodes)`);
    console.log("All addresses in Milton Keynes (MK). Postcodes: MK1–MK16 (real MK areas).");
    console.log("");
  } catch (error) {
    console.error("Seed error:", error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log("Database connection closed.");
    process.exit(0);
  }
}

runSeed();

// care-app-backend/seed.js
// Sample data with real names and realistic UK details. 2 admin users, 6 care givers, 16 care receivers (no visits).
// Run: node seed.js  or  npm run seed

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
    address: { street: "14 Whitehall Place", city: "London", postcode: "SW1A 2DH" },
    coordinates: { type: "Point", coordinates: [-0.1246, 51.5068] },
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
    address: { street: "32 Kings Road", city: "London", postcode: "SW3 4UD" },
    coordinates: { type: "Point", coordinates: [-0.1657, 51.4875] },
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
    address: { street: "7 Wardour Street", city: "London", postcode: "W1D 6PF" },
    coordinates: { type: "Point", coordinates: [-0.1316, 51.5138] },
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
    address: { street: "45 Deansgate", city: "Manchester", postcode: "M3 2BW" },
    coordinates: { type: "Point", coordinates: [-2.2426, 53.4808] },
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
    address: { street: "12 New Street", city: "Birmingham", postcode: "B2 4QA" },
    coordinates: { type: "Point", coordinates: [-1.8986, 52.4862] },
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
    address: { street: "88 Briggate", city: "Leeds", postcode: "LS1 6LZ" },
    coordinates: { type: "Point", coordinates: [-1.5491, 53.7960] },
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

// First 6 = same postcodes as care givers (at least one care receiver per care giver postcode). Rest = valid UK postcodes.
const RECEIVER_POSTCODES = [
  { city: "London", postcode: "SW1A 2DH", coords: [-0.1246, 51.5068] },
  { city: "London", postcode: "SW3 4UD", coords: [-0.1657, 51.4875] },
  { city: "London", postcode: "W1D 6PF", coords: [-0.1316, 51.5138] },
  { city: "Manchester", postcode: "M3 2BW", coords: [-2.2426, 53.4808] },
  { city: "Birmingham", postcode: "B2 4QA", coords: [-1.8986, 52.4862] },
  { city: "Leeds", postcode: "LS1 6LZ", coords: [-1.5491, 53.7960] },
  { city: "London", postcode: "SW1A 1AA", coords: [-0.1416, 51.5014] },
  { city: "London", postcode: "EC1A 1BB", coords: [-0.0986, 51.5145] },
  { city: "Manchester", postcode: "M1 1AE", coords: [-2.2426, 53.4808] },
  { city: "Liverpool", postcode: "L1 1JQ", coords: [-2.9916, 53.4084] },
  { city: "Bristol", postcode: "BS1 5TR", coords: [-2.5879, 51.4545] },
  { city: "Sheffield", postcode: "S1 1WB", coords: [-1.4701, 53.3811] },
  { city: "Edinburgh", postcode: "EH1 1YZ", coords: [-3.1883, 55.9533] },
  { city: "Glasgow", postcode: "G1 1AA", coords: [-4.2518, 55.8642] },
  { city: "Newcastle", postcode: "NE1 4ST", coords: [-1.6178, 54.9783] },
  { city: "Cardiff", postcode: "CF10 1AL", coords: [-3.1791, 51.4816] },
];

const CARE_RECEIVERS = [
  { name: "Margaret Fletcher", street: "22 Park Lane", contactName: "Thomas Fletcher", relationship: "Child", gender: "Female", genderPreference: "No Preference" },
  { name: "William Booth", street: "5 Chelsea Gardens", contactName: "Helen Booth", relationship: "Spouse/Partner", gender: "Male", genderPreference: "No Preference" },
  { name: "Dorothy Hayes", street: "41 Soho Square", contactName: "Rachel Hayes", relationship: "Child", gender: "Female", genderPreference: "Female" },
  { name: "Arthur Greenwood", street: "18 Deansgate Court", contactName: "Peter Greenwood", relationship: "Child", gender: "Male", genderPreference: "Male" },
  { name: "Jean Palmer", street: "9 Digbeth High Street", contactName: "Susan Palmer", relationship: "Child", gender: "Female", genderPreference: "No Preference" },
  { name: "Harold Webb", street: "3 The Headrow", contactName: "David Webb", relationship: "Child", gender: "Male", genderPreference: "No Preference" },
  { name: "Irene Collins", street: "7 Victoria Street", contactName: "Michael Collins", relationship: "Child", gender: "Female", genderPreference: "Female" },
  { name: "Raymond Hughes", street: "15 St Mary's Gate", contactName: "Sarah Hughes", relationship: "Child", gender: "Male", genderPreference: "No Preference" },
  { name: "Florence Bennett", street: "2 Castle Street", contactName: "Andrew Bennett", relationship: "Child", gender: "Female", genderPreference: "No Preference" },
  { name: "Stanley Powell", street: "56 West Street", contactName: "Linda Powell", relationship: "Spouse/Partner", gender: "Male", genderPreference: "Male" },
  { name: "Edith Russell", street: "11 Princes Street", contactName: "James Russell", relationship: "Child", gender: "Female", genderPreference: "No Preference" },
  { name: "Albert Stewart", street: "24 Buchanan Street", contactName: "Patricia Stewart", relationship: "Child", gender: "Male", genderPreference: "No Preference" },
  { name: "Gladys Mason", street: "8 Grey Street", contactName: "Christopher Mason", relationship: "Child", gender: "Female", genderPreference: "Female" },
  { name: "Norman Hunt", street: "19 Queen Street", contactName: "Jennifer Hunt", relationship: "Child", gender: "Male", genderPreference: "No Preference" },
  { name: "Marjorie Gardner", street: "4 St Mary Street", contactName: "Robert Gardner", relationship: "Child", gender: "Female", genderPreference: "No Preference" },
  { name: "Herbert Reynolds", street: "31 Churchill Way", contactName: "Elizabeth Reynolds", relationship: "Spouse/Partner", gender: "Male", genderPreference: "No Preference" },
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
    console.log(`Care receivers: ${createdCareReceivers.length} (no daily/recurring visits; first 6 match care giver postcodes)`);
    console.log("Valid UK postcodes used: SW1A 2DH, SW3 4UD, W1D 6PF, M3 2BW, B2 4QA, LS1 6LZ, SW1A 1AA, EC1A 1BB, M1 1AE, L1 1JQ, BS1 5TR, S1 1WB, EH1 1YZ, G1 1AA, NE1 4ST, CF10 1AL.");
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

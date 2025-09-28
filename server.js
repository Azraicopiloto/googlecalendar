// Load environment variables from a .env file for local development
require('dotenv').config();

// Import required packages
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const axios = require('axios'); // Used to send data to Jotform

// Initialize the express app
const app = express();
const PORT = process.env.PORT || 3001;

// Use middleware to parse JSON and enable CORS
app.use(express.json());
app.use(cors());

// Set up Google OAuth2 client
const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
oAuth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});
const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

// ====================================================================
// Function to submit data to Jotform
// ====================================================================
async function submitToJotform(formData) {
  const JOTFORM_API_KEY = process.env.JOTFORM_API_KEY;
  const JOTFORM_FORM_ID = process.env.JOTFORM_FORM_ID;

  if (!JOTFORM_API_KEY || !JOTFORM_FORM_ID) {
    console.log('Jotform credentials not found in environment, skipping submission.');
    return;
  }

  // Map your front-end data to Jotform's Question IDs (QIDs)
  // These are based on the field IDs you provided (e.g., #input_6 -> QID 6)
  const submissionData = {
    'submission[6]': formData.name,
    'submission[7]': formData.email,
    'submission[8]': formData.company,
    'submission[9]': formData.website,
    'submission[10]': formData.timezone,
    'submission[11]': formData.focusAreas.join('\n'), // Use newline for multi-select
    'submission[12]': formData.targetCountries.join(', '), // Comma-separated for chips
    'submission[13]': formData.timeline,
    'submission[15]': formData.primaryChallenge,
    'submission[16]': `From: ${formData.startISO}\nTo: ${formData.endISO}`
  };

  try {
    const url = `https://api.jotform.com/form/${JOTFORM_FORM_ID}/submissions?apiKey=${JOTFORM_API_KEY}`;
    // Jotform API expects the data in a specific URL-encoded format
    await axios.post(url, new URLSearchParams(submissionData).toString());
    console.log('Successfully submitted data to Jotform.');
  } catch (error) {
    // Log the error but don't stop the process. The main goal (booking) was successful.
    console.error('Error submitting to Jotform:', error.response ? error.response.data : error.message);
  }
}

// ====================================================================
// Endpoint to get available time slots
// ====================================================================
app.get('/availability', async (req, res) => {
  try {
    const { start, end, tz } = req.query;
    const startTime = new Date(`${start}T00:00:00Z`);
    const endTime = new Date(`${end}T23:59:59Z`);

    const freeBusyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: startTime.toISOString(),
        timeMax: endTime.toISOString(),
        timeZone: tz,
        items: [{ id: 'primary' }],
      },
    });

    const busySlots = freeBusyResponse.data.calendars.primary.busy;
    const availableSlots = [];
    const meetingDurationMinutes = 20;

    // Define working hours in UTC, corresponding to 9 AM - 5 PM in Malaysia (UTC+8)
    const workDayStartHourUTC = 1; // 9 AM MYT is 1 AM UTC
    const workDayEndHourUTC = 9;   // 5 PM MYT is 9 AM UTC

    let slot = new Date(startTime);
    slot.setUTCHours(workDayStartHourUTC, 0, 0, 0);

    const endOfDay = new Date(startTime);
    endOfDay.setUTCHours(workDayEndHourUTC, 0, 0, 0);

    while (slot < endOfDay) {
      const slotEnd = new Date(slot.getTime() + meetingDurationMinutes * 60000);
      const isBusy = busySlots.some(busy => {
        const busyStart = new Date(busy.start);
        const busyEnd = new Date(busy.end);
        return slot < busyEnd && slotEnd > busyStart;
      });

      if (!isBusy) {
        availableSlots.push({ startISO: slot.toISOString(), endISO: slotEnd.toISOString() });
      }
      
      slot.setMinutes(slot.getMinutes() + 30);
    }
    
    res.json({ days: [{ date: start, slots: availableSlots }] });

  } catch (error) {
    console.error('Error fetching availability:', error);
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
});

// ====================================================================
// Endpoint to book an event AND submit to Jotform
// ====================================================================
app.post('/book', async (req, res) => {
  try {
    const payload = req.body;
    console.log('Received booking request:', payload);

    const event = {
      summary: `Consultation: ${payload.company}`,
      description: `Booked by: ${payload.name} (${payload.email})\nPrimary Challenge: ${payload.primaryChallenge}`,
      start: { dateTime: payload.startISO, timeZone: 'Asia/Kuala_Lumpur' },
      end: { dateTime: payload.endISO, timeZone: 'Asia/Kuala_Lumpur' },
      attendees: [{ email: payload.email }],
      conferenceData: { createRequest: { requestId: `booking-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' }}},
      reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 24 * 60 }, { method: 'popup', minutes: 10 }] },
    };

    const createdEvent = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1,
    });
    console.log('Event created:', createdEvent.data.htmlLink);
    
    // After successful Google Calendar booking, submit the data to Jotform.
    await submitToJotform(payload);

    res.status(200).json({
      ok: true,
      message: 'Consultation booked successfully!',
      meetLink: createdEvent.data.hangoutLink,
    });
  } catch (error) {
    console.error('Error creating calendar event:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
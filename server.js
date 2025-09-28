// Load environment variables from a .env file
require('dotenv').config();

// Import required packages
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const { a } = require('googleapis/build/src/apis/abusiveexperiencereport');

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

// Set the refresh token
oAuth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

// Create a Google Calendar API client
const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

// ====================================================================
// NEW: Endpoint to get available time slots
// ====================================================================
app.get('/availability', async (req, res) => {
  try {
    const { start, end, tz } = req.query;
    const startTime = new Date(`${start}T00:00:00Z`);
    const endTime = new Date(`${end}T23:59:59Z`);

    // Check Google Calendar for busy times
    const freeBusyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: startTime.toISOString(),
        timeMax: endTime.toISOString(),
        timeZone: tz,
        items: [{ id: 'primary' }],
      },
    });

    const busySlots = freeBusyResponse.data.calendars.primary.busy;

    // --- Generate potential slots and filter out busy ones ---
    const availableSlots = [];
    const meetingDurationMinutes = 20; // 20-minute slots

    // Define working hours in the server's local time (adjust as needed)
    const workDayStartHour = 9; // 9 AM
    const workDayEndHour = 17; // 5 PM

    let slot = new Date(startTime);
    slot.setUTCHours(workDayStartHour, 0, 0, 0);

    const endOfDay = new Date(startTime);
    endOfDay.setUTCHours(workDayEndHour, 0, 0, 0);

    while (slot < endOfDay) {
      const slotEnd = new Date(slot.getTime() + meetingDurationMinutes * 60000);

      // Check if this slot overlaps with any busy slot
      const isBusy = busySlots.some(busy => {
        const busyStart = new Date(busy.start);
        const busyEnd = new Date(busy.end);
        // Overlap condition: (SlotStart < BusyEnd) and (SlotEnd > BusyStart)
        return slot < busyEnd && slotEnd > busyStart;
      });

      if (!isBusy) {
        availableSlots.push({
          startISO: slot.toISOString(),
          endISO: slotEnd.toISOString(),
        });
      }
      
      // Move to the next potential slot (e.g., every 30 mins to allow for breaks)
      slot.setMinutes(slot.getMinutes() + 30);
    }
    
    res.json({ days: [{ date: start, slots: availableSlots }] });

  } catch (error) {
    console.error('Error fetching availability:', error);
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
});


// ====================================================================
// Endpoint to book an event
// ====================================================================
app.post('/book', async (req, res) => {
  try {
    const { name, email, company, startISO, endISO, primaryChallenge } = req.body;
    console.log('Received booking request:', req.body);

    const event = {
      summary: `Consultation: ${company}`,
      description: `Booked by: ${name} (${email})\nPrimary Challenge: ${primaryChallenge}`,
      start: { dateTime: startISO, timeZone: 'Asia/Kuala_Lumpur' },
      end: { dateTime: endISO, timeZone: 'Asia/Kuala_Lumpur' },
      attendees: [{ email: email }],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 10 },
        ],
      },
      // Add Google Meet link generation
      conferenceData: {
        createRequest: {
          requestId: `booking-${Date.now()}`,
          conferenceSolutionKey: {
            type: 'hangoutsMeet',
          },
        },
      },
    };

    const createdEvent = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1, // Required to generate a Google Meet link
    });

    console.log('Event created: ', createdEvent.data.htmlLink);

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
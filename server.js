// Load environment variables from a .env file
require('dotenv').config();

// Import required packages
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');

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
  process.env.GOOGLE_REDIRECT_URI // This should be set in your Google Cloud Console
);

// We need a refresh token to get a new access token
// In a real app, you would get this token after the user authorizes your app for the first time
// For a server-to-server app, you should use a Service Account instead.
// But for this project, you can get a refresh token using the OAuth Playground:
// https://developers.google.com/oauthplayground
oAuth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

// Create a Google Calendar API client
const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

// Define the API endpoint for booking an event
app.post('/book', async (req, res) => {
  try {
    // Get booking details from the request body
    const { name, email, company, startISO, endISO, primaryChallenge } = req.body;

    console.log('Received booking request:', req.body);

    // Create a new calendar event
    const event = {
      summary: `Consultation: ${company}`,
      description: `Booked by: ${name} (${email})\nPrimary Challenge: ${primaryChallenge}`,
      start: {
        dateTime: startISO,
        timeZone: 'Asia/Kuala_Lumpur', // Or get this from the user
      },
      end: {
        dateTime: endISO,
        timeZone: 'Asia/Kuala_Lumpur',
      },
      attendees: [{ email: email }], // Add the person who booked as an attendee
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 10 },
        ],
      },
    };

    // Insert the event into the calendar
    const createdEvent = await calendar.events.insert({
      calendarId: 'primary', // Use 'primary' for the main calendar
      resource: event,
    });

    console.log('Event created: ', createdEvent.data.htmlLink);

    // Send a success response back to the front-end
    res.status(200).json({
      ok: true,
      message: 'Consultation booked successfully!',
      meetLink: createdEvent.data.hangoutLink,
    });
  } catch (error) {
    console.error('Error creating calendar event:', error);
    // Send an error response
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
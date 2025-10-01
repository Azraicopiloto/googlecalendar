// Load environment variables from a .env file for local development
require('dotenv').config();

// Import required packages
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const axios = require('axios'); // Used to send data to Jotform
const Brevo = require('sib-api-v3-sdk'); // For sending emails
const { formatInTimeZone } = require('date-fns-tz'); // For formatting dates

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
// Function to send a confirmation email using Brevo
// ====================================================================
async function sendBrevoConfirmationEmail(formData, meetLink) {
  const SENDER_EMAIL = process.env.SENDER_EMAIL;
  const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;

  if (!process.env.BREVO_API_KEY) {
    console.log('Brevo API key not found, skipping email notification.');
    return;
  }

  // Format the date and time nicely
  const eventStart = new Date(formData.startISO);
  const clientTimeZone = formData.timezone || 'Asia/Kuala_Lumpur';
  const formattedDateTime = formatInTimeZone(eventStart, clientTimeZone, "eeee, d MMMM yyyy 'at' h:mm a (zzzz)");

  // Richer HTML with logo and event details
  const emailHtmlContent = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <img src="https://seo-ku.com/wp-content/uploads/2025/09/seo-ku.svg" alt="SEO-ku Logo" style="width: 150px; margin-bottom: 20px;">
      <h3>Hi ${formData.name},</h3>
      <p>Thank you for booking a consultation. Your meeting is confirmed!</p>
      <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px;">
        <strong>Topic:</strong> SEO Consultation for ${formData.company}<br>
        <strong>Date & Time:</strong> ${formattedDateTime}<br>
        <strong>Meeting Link:</strong> <a href="${meetLink}">${meetLink}</a>
      </div>
      <p>An official invitation has been sent to your calendar separately. We look forward to speaking with you.</p>
      <br/>
      <p>Best regards,</p>
      <p><strong>The SEO-ku Team</strong></p>
    </div>
  `;

  // Configure the Brevo API client
  const apiClient = Brevo.ApiClient.instance;
  const apiKey = apiClient.authentications['api-key'];
  apiKey.apiKey = process.env.BREVO_API_KEY;
  const transactionalEmailsApi = new Brevo.TransactionalEmailsApi();

  const msgToClient = {
    sender: { email: SENDER_EMAIL, name: 'SEO-ku Consulting' },
    to: [{ email: formData.email, name: formData.name }],
    subject: `Your Consultation is Confirmed: ${formData.company}`,
    htmlContent: emailHtmlContent,
  };
  
  const msgToAdmin = {
    sender: { email: SENDER_EMAIL, name: 'SEO-ku Booking System' },
    to: [{ email: RECIPIENT_EMAIL }],
    subject: `New Booking: ${formData.company}`,
    textContent: `A new consultation has been booked with ${formData.name} (${formData.email}) for ${formattedDateTime}. The event has been added to your Google Calendar.`
  };

  try {
    await transactionalEmailsApi.sendTransacEmail(msgToClient);
    console.log(`Brevo confirmation email sent to ${formData.email}`);
    await transactionalEmailsApi.sendTransacEmail(msgToAdmin);
    console.log(`Brevo admin notification sent to ${RECIPIENT_EMAIL}`);
  } catch (error) {
    console.error('Error sending email via Brevo:', error.body || error);
  }
}

// ====================================================================
// Function to submit data to Jotform
// ====================================================================
async function submitToJotform(formData) {
  const JOTFORM_API_KEY = process.env.JOTFORM_API_KEY;
  const JOTFORM_FORM_ID = process.env.JOTFORM_FORM_ID;

  if (!JOTFORM_API_KEY || !JOTFORM_FORM_ID) {
    console.log('Jotform credentials not found, skipping submission.');
    return;
  }

  const submissionData = {
    'submission[6]': formData.name,
    'submission[7]': formData.email,
    'submission[8]': formData.company,
    'submission[9]': formData.website,
    'submission[10]': formData.timezone,
    'submission[11]': formData.focusAreas.join('\n'),
    'submission[12]': formData.targetCountries.join(', '),
    'submission[13]': formData.timeline,
    'submission[15]': formData.primaryChallenge,
    'submission[16]': `From: ${formData.startISO}\nTo: ${formData.endISO}`
  };

  try {
    const url = `https://api.jotform.com/form/${JOTFORM_FORM_ID}/submissions?apiKey=${JOTFORM_API_KEY}`;
    await axios.post(url, new URLSearchParams(submissionData).toString());
    console.log('Successfully submitted data to Jotform.');
  } catch (error) {
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

    const workDayStartHourUTC = 1;
    const workDayEndHourUTC = 9;  

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
    
    // After everything else is successful, send the confirmation emails.
    sendBrevoConfirmationEmail(payload, createdEvent.data.hangoutLink);
    
    // Submit the data to Jotform.
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
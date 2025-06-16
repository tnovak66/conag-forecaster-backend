// server.js - FINAL VERSION v4 - Corrected Sheets Auth & Gemini Proxy

// 1. Import Dependencies
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library'); // <-- NEW: For Sheets Auth
const Brevo = require('@getbrevo/brevo');
const fetch = require('node-fetch');

// 2. Initialize App & CORS
const app = express();
const allowedOrigins = ['https://conagmarketing.com'];
const corsOptions = {
  origin: function (origin, callback) {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};
app.use(cors(corsOptions));
app.use(express.json());

// --- NEW: Service Account Credentials for Google Sheets ---
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
  ],
});

// --- Helper function to get an authenticated Brevo API client ---
function getBrevoApiClient(apiType) {
    let defaultClient = Brevo.ApiClient.instance;
    let apiKey = defaultClient.authentications['api-key'];
    apiKey.apiKey = process.env.BREVO_API_KEY;
    return new apiType();
}

// --- API ENDPOINTS ---

// Endpoint 1: Log usage data (Corrected Sheets Logic)
app.post('/api/log-forecast-usage', async (req, res) => {
    const scenarioData = req.body;
    console.log('--- Logging endpoint called for:', scenarioData.userEmail, '---');
    
    // Brevo Contact Logging
    try {
        const contactApi = getBrevoApiClient(Brevo.ContactsApi);
        const createContactRequest = new Brevo.CreateContact();
        createContactRequest.email = scenarioData.userEmail;
        createContactRequest.listIds = [parseInt(process.env.BREVO_LEAD_LIST_ID)];
        createContactRequest.attributes = {'FIRSTNAME': scenarioData.userName, 'COMPANY': scenario_data.userCompany};
        createContactRequest.updateEnabled = true;
        await contactApi.createContact(createContactRequest);
        console.log('Brevo contact created/updated.');
    } catch (error) {
        console.error('Brevo API Error:', error.response ? error.response.body : error.message);
    }
    
    // Google Sheets Logging (Corrected)
    try {
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
        await doc.loadInfo(); // loads document properties and worksheets
        const sheet = doc.sheetsByIndex[0];
        const newRow = {
            Timestamp: new Date().toISOString(),
            Name: scenarioData.userName,
            Email: scenarioData.userEmail,
            Company: scenarioData.userCompany,
            'Total Spend': scenarioData.totalMonthlyMarketingSpend,
            'Net Gain': scenarioData.netGainFromOneSale,
        };
        await sheet.addRow(newRow);
        console.log('Google Sheet updated successfully.');
    } catch (error) {
        console.error('Google Sheets Error:', error.message); // This will no longer show the old error
    }

    res.status(200).json({ message: 'Data logged successfully' });
});

// Endpoint 2: Send email
app.post('/api/send-forecast-report', async (req, res) => {
    const reportData = req.body;
    console.log('--- Email endpoint called for:', reportData.userEmail, '---');
    if (!reportData || !reportData.userEmail) { return res.status(400).json({ message: 'Missing report data.' }); }
    
    try {
        const transactionalEmailsApi = getBrevoApiClient(Brevo.TransactionalEmailsApi);
        const formatCurrency = (num) => `$${Math.round(num || 0).toLocaleString()}`;
        const htmlContent = `<h1>Your Marketing Investment Forecast</h1><p>Hi ${reportData.userName},</p><p>Here is a summary of your report.</p><h3>📈 Forecast Results</h3><ul><li>Total Monthly Spend: <strong>${formatCurrency(reportData.totalMonthlyMarketingSpend)}</strong></li><li>Profit from ONE Sale: <strong>${formatCurrency(reportData.profitFromOneSale)}</strong></li><li style="font-size: 1.2em;">Estimated Net Gain: <strong>${formatCurrency(reportData.netGainFromOneSale)}</strong></li></ul>`;
        
        const sendSmtpEmail = new Brevo.SendSmtpEmail();
        sendSmtpEmail.to = [{ email: reportData.userEmail, name: reportData.userName }];
        sendSmtpEmail.bcc = [{ email: process.env.MARKETING_TEAM_EMAIL, name: 'ConAg Marketing Team' }];
        sendSmtpEmail.sender = { email: process.env.BREVO_SENDER_EMAIL, name: 'ConAg Marketing Forecaster' };
        sendSmtpEmail.subject = `Your Marketing Forecast from ConAg Marketing`;
        sendSmtpEmail.htmlContent = htmlContent;
        await transactionalEmailsApi.sendTransacEmail(sendSmtpEmail);
        console.log('Email sent successfully.');
        res.status(200).json({ message: 'Report emailed successfully!' });
    } catch (error) {
        console.error('Brevo Email Error:', error.response ? error.response.body : error.message);
        res.status(500).json({ message: 'A server error occurred while sending the email.' });
    }
});

// Endpoint 3: Gemini proxy (Corrected)
app.post('/api/gemini-proxy', async (req, res) => {
    const { prompt, isJsonOutput, schema } = req.body;
    console.log('--- AI proxy endpoint called. ---');
    if (!prompt) { return res.status(400).json({ error: { message: "Prompt is required." } }); }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    const model = isJsonOutput ? "gemini-1.5-flash-latest" : "gemini-pro";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
    
    let payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
    
    // Corrected property names for the REST API
    if (isJsonOutput && schema) {
        payload.generationConfig = {
            "responseMimeType": "application/json",
            "responseSchema": schema
        };
    }

    try {
        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await geminiResponse.json();
        if (!geminiResponse.ok) {
            console.error("Error from Gemini API:", JSON.stringify(data, null, 2));
            return res.status(geminiResponse.status).json(data);
        }
        console.log('Successfully received AI response.');
        res.status(200).json(data);
    } catch (error) {
        console.error("Fatal error in Gemini Proxy:", error);
        res.status(500).json({ error: { message: "A critical error occurred on the backend while contacting the AI service." } });
    }
});

// Start the Server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`);
});
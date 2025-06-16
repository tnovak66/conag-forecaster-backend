// server.js - FINAL VERSION v2 - June 17, 2025

// 1. Import Dependencies
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const Brevo = require('@getbrevo/brevo');
const fetch = require('node-fetch'); // <-- ADD THIS LINE

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


// --- Endpoint 3: Securely proxy requests to the Gemini API (CORRECTED) ---
app.post('/api/gemini-proxy', async (req, res) => {
    const { prompt, isJsonOutput, schema } = req.body;
    console.log("Gemini proxy called..."); // For debugging

    if (!prompt) {
        return res.status(400).json({ error: { message: "Prompt is required." } });
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    // Using a stable, recommended model name
    const model = isJsonOutput ? "gemini-1.5-flash-latest" : "gemini-pro";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
    
    let payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
    };
    
    if (isJsonOutput && schema) {
        // Corrected property names for JSON mode
        payload.generationConfig = {
            "response_mime_type": "application/json",
            "response_schema": schema
        };
    }

    try {
        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await geminiResponse.json();

        // If the response from Google is not OK, forward the error
        if (!geminiResponse.ok) {
            console.error("Error from Gemini API:", data);
            return res.status(geminiResponse.status).json(data);
        }

        // Success, send the response back to the client
        res.status(200).json(data);

    } catch (error) {
        console.error("Fatal error in Gemini Proxy:", error);
        res.status(500).json({ error: { message: "A critical error occurred on the backend while contacting the AI service." } });
    }
});


// --- Other Endpoints (Unchanged) ---

// Endpoint 1: Log usage data
app.post('/api/log-forecast-usage', async (req, res) => {
    // ... code for this endpoint is unchanged
    const scenarioData = req.body;
    const contactApi = new Brevo.ContactsApi();
    contactApi.setApiKey(Brevo.ContactsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
    try {
        const createContactRequest = new Brevo.CreateContact();
        createContactRequest.email = scenarioData.userEmail;
        createContactRequest.listIds = [parseInt(process.env.BREVO_LEAD_LIST_ID)];
        createContactRequest.attributes = {'FIRSTNAME': scenarioData.userName, 'COMPANY': scenarioData.userCompany};
        createContactRequest.updateEnabled = true;
        await contactApi.createContact(createContactRequest);
    } catch (error) {}
    try {
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
        await doc.useServiceAccountAuth({
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        });
        await doc.loadInfo();
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
    } catch (error) {}
    res.status(200).json({ message: 'Data logged successfully' });
});

// Endpoint 2: Send email
app.post('/api/send-forecast-report', async (req, res) => {
    // ... code for this endpoint is unchanged
    const reportData = req.body;
    if (!reportData || !reportData.userEmail) { return res.status(400).json({ message: 'Missing report data or user email.' }); }
    const brevoApi = new Brevo.TransactionalEmailsApi();
    brevoApi.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
    const formatCurrency = (num) => `$${Math.round(num).toLocaleString()}`;
    const htmlContent = `<h1>Your Marketing Investment Forecast</h1><p>Hi ${reportData.userName},</p><p>Here is a summary of your report.</p><h3>📈 Forecast Results</h3><ul><li>Total Monthly Spend: <strong>${formatCurrency(reportData.totalMonthlyMarketingSpend)}</strong></li><li>Profit from ONE Sale: <strong>${formatCurrency(reportData.profitFromOneSale)}</strong></li><li style="font-size: 1.2em;">Estimated Net Gain: <strong>${formatCurrency(reportData.netGainFromOneSale)}</strong></li></ul><h3>📋 Your Selections</h3><ul><li>Company: ${reportData.userCompany}</li><li>Avg. Sale Value: ${formatCurrency(reportData.avgSaleValue)}</li><li>Avg. Profit Margin: ${reportData.avgProfitMargin}%</li></ul>`;
    try {
        const sendSmtpEmail = new Brevo.SendSmtpEmail();
        sendSmtpEmail.to = [{ email: reportData.userEmail, name: reportData.userName }];
        sendSmtpEmail.bcc = [{ email: process.env.MARKETING_TEAM_EMAIL, name: 'ConAg Marketing Team' }];
        sendSmtpEmail.sender = { email: process.env.BREVO_SENDER_EMAIL, name: 'ConAg Marketing Forecaster' };
        sendSmtpEmail.subject = `Your Marketing Forecast from ConAg Marketing`;
        sendSmtpEmail.htmlContent = htmlContent;
        await brevoApi.sendTransacEmail(sendSmtpEmail);
        res.status(200).json({ message: 'Report emailed successfully!' });
    } catch (error) {
        res.status(500).json({ message: 'There was an error sending your report.' });
    }
});


// Start the Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`);
});

// JavaScript Document
// server.js

// 1. Import Dependencies
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const Brevo = require('@getbrevo/brevo');

// 2. Initialize App and Middleware
const app = express();
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Middleware to parse JSON bodies

// --- Endpoint 1: Log usage data and create a lead in Brevo/Sheets ---
app.post('/api/log-forecast-usage', async (req, res) => {
    const scenarioData = req.body;
    console.log('Received data for logging:', scenarioData.userEmail);

    // Brevo: Add/Update Contact
    const contactApi = new Brevo.ContactsApi();
    contactApi.setApiKey(Brevo.ContactsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
    try {
        const createContactRequest = new Brevo.CreateContact();
        createContactRequest.email = scenarioData.userEmail;
        createContactRequest.listIds = [parseInt(process.env.BREVO_LEAD_LIST_ID)];
        createContactRequest.attributes = {
            'FIRSTNAME': scenarioData.userName,
            'COMPANY': scenarioData.userCompany,
        };
        createContactRequest.updateEnabled = true; // IMPORTANT: This updates the contact if they already exist.
        await contactApi.createContact(createContactRequest);
        console.log(`Brevo contact for ${scenarioData.userEmail} created/updated.`);
    } catch (error) {
        console.error('Brevo API Error:', error.response ? error.response.body : error.message);
    }

    // Google Sheets: Append Row
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
            'Equipment Types': scenarioData.equipmentTypes,
            'Avg Sale Value': scenarioData.avgSaleValue,
            'Profit Margin (%)': scenarioData.avgProfitMargin,
            'Total Spend': scenarioData.totalMonthlyMarketingSpend,
            'Net Gain': scenarioData.netGainFromOneSale,
        };
        await sheet.addRow(newRow);
        console.log(`Google Sheet updated for ${scenarioData.userEmail}.`);
    } catch (error) {
        console.error('Google Sheets API Error:', error.message);
    }
    res.status(200).json({ message: 'Data logged successfully' });
});

// --- Endpoint 2: Send the email report ---
app.post('/api/send-forecast-report', async (req, res) => {
    const reportData = req.body;
    if (!reportData || !reportData.userEmail) {
        return res.status(400).json({ message: 'Missing report data or user email.' });
    }
    const brevoApi = new Brevo.TransactionalEmailsApi();
    brevoApi.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
    const formatCurrency = (num) => `$${Math.round(num).toLocaleString()}`;
    const htmlContent = `<h1>Your Marketing Investment Forecast</h1><p>Hi ${reportData.userName},</p><p>Thank you for using the ConAg Marketing Investment Forecaster. Here is a summary of your report.</p><h3>📈 Forecast Results</h3><ul><li>Total Selected Monthly Marketing Spend: <strong>${formatCurrency(reportData.totalMonthlyMarketingSpend)}</strong></li><li>Estimated Profit from ONE Additional Sale: <strong>${formatCurrency(reportData.profitFromOneSale)}</strong></li><li style="font-size: 1.2em;">Estimated Net Gain: <strong>${formatCurrency(reportData.netGainFromOneSale)}</strong></li></ul><h3>📋 Your Selections</h3><ul><li>Company: ${reportData.userCompany}</li><li>Equipment Types: ${reportData.equipmentTypes}</li><li>Average Sale Value: ${formatCurrency(reportData.avgSaleValue)}</li><li>Average Profit Margin: ${reportData.avgProfitMargin}%</li></ul><h3>🛠️ Selected Services</h3><ul><li>Email Blasts: ${reportData.serviceInputs.emailSends} per month</li><li>Social Media Channels: ${reportData.serviceInputs.selectedSocialChannelsText}</li><li>Website Maintenance: ${reportData.serviceInputs.websiteMaintenanceSelected ? 'Yes' : 'No'}</li><li>Website SEO & AI Enhancements: ${reportData.serviceInputs.seoEnhancementsSelected ? 'Yes' : 'No'}</li><li>Google Ads Daily Spend: ${formatCurrency(reportData.serviceInputs.googleAdsDailySpend)}</li></ul><hr><p><strong>Next Steps:</strong> Want to discuss this plan in more detail? Reply to this email or contact us at ${process.env.MARKETING_TEAM_EMAIL}.</p>`;
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
        console.error('Brevo Email Error:', error.response ? error.response.body : error.message);
        res.status(500).json({ message: 'There was an error sending your report.' });
    }
});

// --- Endpoint 3: Securely proxy requests to the Gemini API ---
app.post('/api/gemini-proxy', async (req, res) => {
    const { prompt, isJsonOutput, schema } = req.body;
    if (!prompt) { return res.status(400).json({ error: { message: "Prompt is required." } }); }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${geminiApiKey}`;
    let payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
    if (isJsonOutput && schema) {
        payload.generationConfig = { responseMimeType: "application/json", responseSchema: schema };
    }
    try {
        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await geminiResponse.json();
        if (!geminiResponse.ok) { return res.status(geminiResponse.status).json(data); }
        res.status(200).json(data);
    } catch (error) {
        console.error("Gemini Proxy Error:", error);
        res.status(500).json({ error: { message: "Error contacting AI service." } });
    }
});


// 4. Start the Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`);
});
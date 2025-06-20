// server.js - FINAL VERSION v9 - Enhanced Reporting & Logging

// 1. Import Dependencies
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const Brevo = require('@getbrevo/brevo');
const fetch = require('node-fetch');

// 2. Initialize App & CORS
const app = express();
// Restrict to your domain for security
const allowedOrigins = ['https://conagmarketing.com', 'http://localhost:3000']; // Added localhost for development
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

// --- Service Account Credentials for Google Sheets ---
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// --- Helper function to get an authenticated Brevo API client ---
function getBrevoApiClient(apiType) {
    let defaultClient = Brevo.ApiClient.instance;
    let apiKey = defaultClient.authentications['api-key'];
    apiKey.apiKey = process.env.BREVO_API_KEY;
    return new apiType();
}

// --- API ENDPOINTS ---

// Endpoint 1: Log usage data
app.post('/api/log-forecast-usage', async (req, res) => {
    const scenarioData = req.body;
    console.log('--- Logging endpoint called for:', scenarioData.userEmail, '---');
    
    // Brevo Contact Logging
    try {
        const contactApi = getBrevoApiClient(Brevo.ContactsApi);
        const createContactRequest = new Brevo.CreateContact();
        createContactRequest.email = scenarioData.userEmail;
        createContactRequest.listIds = [parseInt(process.env.BREVO_LEAD_LIST_ID)];
        createContactRequest.attributes = {
            'FIRSTNAME': scenarioData.userName, 
            'COMPANY': scenarioData.userCompany,
            'DEALER_TYPE': scenarioData.equipmentTypes
        };
        createContactRequest.updateEnabled = true;
        await contactApi.createContact(createContactRequest);
        console.log('Brevo contact created/updated.');
    } catch (error) {
        console.error('Brevo API Error:', error.response ? JSON.stringify(error.response.body) : error.message);
    }
    
    // Google Sheets Logging (Expanded)
    try {
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0]; // Assumes logging to the first sheet

        // Define the new comprehensive row structure
        const newRow = {
            Timestamp: new Date().toISOString(),
            Name: scenarioData.userName,
            Email: scenarioData.userEmail,
            Company: scenarioData.userCompany,
            'Equipment Types': scenarioData.equipmentTypes,
            'Avg Sale Value': scenarioData.avgSaleValue,
            'Avg Profit Margin': scenarioData.avgProfitMargin,
            'Total Spend': scenarioData.totalMonthlyMarketingSpend,
            'Net Gain': scenarioData.netGainFromOneSale,
            'Email Sends': scenarioData.serviceInputs.emailSends,
            'Social Channels': scenarioData.serviceInputs.selectedSocialChannelsText,
            'Website Maintenance': scenarioData.serviceInputs.websiteMaintenanceSelected ? 'Yes' : 'No',
            'SEO & AI': scenarioData.serviceInputs.seoEnhancementsSelected ? 'Yes' : 'No',
            'Google Ads Daily Spend': scenarioData.serviceInputs.googleAdsDailySpend
        };

        // Ensure headers exist in the sheet. You must set these up in your Google Sheet first.
        // Example headers: Timestamp, Name, Email, Company, Equipment Types, Avg Sale Value, etc.
        await sheet.addRow(newRow);
        console.log('Google Sheet updated successfully with detailed data.');
    } catch (error) {
        console.error('Google Sheets Error:', error.message);
    }

    res.status(200).json({ message: 'Data logged successfully' });
});

// Endpoint 2: Send email (Upgraded)
app.post('/api/send-forecast-report', async (req, res) => {
    const reportData = req.body;
    console.log('--- Email endpoint called for:', reportData.userEmail, '---');
    if (!reportData || !reportData.userEmail) { return res.status(400).json({ message: 'Missing report data.' }); }
    
    try {
        const transactionalEmailsApi = getBrevoApiClient(Brevo.TransactionalEmailsApi);
        const formatCurrency = (num) => `$${Math.round(num || 0).toLocaleString()}`;
        
        // Build a detailed HTML email body
        const htmlContent = `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <h1>Your Marketing Investment Forecast</h1>
                <p>Hi ${reportData.userName},</p>
                <p>Thank you for using the ConAg Marketing Forecaster. Here is a summary of the plan you generated.</p>
                
                <h3 style="color: #002D62;">📝 Your Selections</h3>
                <ul>
                    <li><strong>What Equipment You Sell:</strong> ${reportData.equipmentTypes}</li>
                    <li><strong>Average Sale Value:</strong> ${formatCurrency(reportData.avgSaleValue)}</li>
                    <li><strong>Average Profit Margin:</strong> ${reportData.avgProfitMargin}%</li>
                    <li><strong>Email Blasts:</strong> ${reportData.serviceInputs.emailSends} send(s)/month</li>
                    <li><strong>Social Media Channels:</strong> ${reportData.serviceInputs.selectedSocialChannelsText}</li>
                    <li><strong>Website Maintenance:</strong> ${reportData.serviceInputs.websiteMaintenanceSelected ? 'Yes' : 'No'}</li>
                    <li><strong>Website SEO & AI Enhancements:</strong> ${reportData.serviceInputs.seoEnhancementsSelected ? 'Yes' : 'No'}</li>
                    <li><strong>Google Ads Daily Spend:</strong> ${formatCurrency(reportData.serviceInputs.googleAdsDailySpend)}</li>
                </ul>

                <h3 style="color: #002D62;">🎯 Your Potential with One Additional Sale</h3>
                <ul>
                    <li>Total Selected Monthly Marketing Spend: <strong>${formatCurrency(reportData.totalMonthlyMarketingSpend)}</strong></li>
                    <li>Estimated Profit from ONE Sale: <strong>${formatCurrency(reportData.profitFromOneSale)}</strong></li>
                    <li style="font-size: 1.2em;">Estimated Net Gain: <strong style="color: ${reportData.netGainFromOneSale >= 0 ? '#107C10' : '#D83B01'};">${formatCurrency(reportData.netGainFromOneSale)}</strong></li>
                </ul>

                <hr style="margin: 20px 0;">
                <p>This forecast illustrates the potential of a well-planned marketing strategy. We would love to discuss these opportunities with you further.</p>
                <p>Sincerely,<br>The ConAg Marketing Team</p>
            </div>
        `;
        
        const sendSmtpEmail = new Brevo.SendSmtpEmail();
        sendSmtpEmail.to = [{ email: reportData.userEmail, name: reportData.userName }];
        sendSmtpEmail.bcc = [{ email: process.env.MARKETING_TEAM_EMAIL, name: 'ConAg Marketing Team' }];
        sendSmtpEmail.sender = { email: process.env.BREVO_SENDER_EMAIL, name: 'ConAg Marketing Forecaster' };
        sendSmtpEmail.subject = `Your Marketing Forecast from ConAg Marketing`;
        sendSmtpEmail.htmlContent = htmlContent;
        
        await transactionalEmailsApi.sendTransacEmail(sendSmtpEmail);
        console.log('Detailed email sent successfully.');
        res.status(200).json({ message: 'Report emailed successfully!' });
    } catch (error) {
        console.error('Brevo Email Error:', error.response ? JSON.stringify(error.response.body) : error.message);
        res.status(500).json({ message: 'A server error occurred while sending the email.' });
    }
});

// Endpoint 3: Gemini proxy
app.post('/api/gemini-proxy', async (req, res) => {
    const { prompt, isJsonOutput, schema } = req.body;
    console.log('--- AI proxy endpoint called. ---');
    if (!prompt) { return res.status(400).json({ error: { message: "Prompt is required." } }); }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    const model = "gemini-1.5-flash-latest"; 
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
    
    let payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
    
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

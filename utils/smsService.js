require('dotenv').config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

// Verify credential format before creating client
const validateCredentials = () => {
    if (!accountSid || typeof accountSid !== 'string' || !accountSid.startsWith('AC')) {
        throw new Error('Invalid TWILIO_ACCOUNT_SID format');
    }
    
    if (!authToken || typeof authToken !== 'string' || authToken.length < 32) {
        throw new Error('Invalid TWILIO_AUTH_TOKEN format');
    }

    if (!process.env.TWILIO_PHONE_NUMBER || !process.env.TWILIO_PHONE_NUMBER.startsWith('+')) {
        throw new Error('Invalid TWILIO_PHONE_NUMBER format');
    }
};

// Create client only after validation
let client;
try {
    validateCredentials();
    client = require('twilio')(accountSid, authToken);
} catch (error) {
    console.error('Twilio client initialization failed:', error.message);
    throw error;
}

const sendSMS = async (phoneNumber, message) => {
    try {
        // Format phone number to E.164 format
        let formattedPhone = phoneNumber;
        
        // Add Cameroon country code if not present
        if (!phoneNumber.startsWith('+')) {
            formattedPhone = phoneNumber.startsWith('237') 
                ? '+' + phoneNumber 
                : '+237' + phoneNumber;
        }

        // Validate phone number format
        const phoneRegex = /^\+237[2368]\d{8}$/;
        if (!phoneRegex.test(formattedPhone)) {
            throw new Error(`Invalid Cameroon phone number format: ${formattedPhone}`);
        }

        // Log attempt details (safely)
        console.log('SMS Attempt Details:', {
            to: formattedPhone,
            from: process.env.TWILIO_PHONE_NUMBER,
            messageLength: message.length,
            credentials: {
                accountSid: `${accountSid.substring(0, 8)}...${accountSid.substring(accountSid.length - 4)}`,
                authTokenPresent: !!authToken,
                authTokenLength: authToken?.length,
                fromNumber: process.env.TWILIO_PHONE_NUMBER
            }
        });

        // Test client authentication before sending
        await client.api.accounts(accountSid).fetch();
        console.log('Twilio authentication successful');

        // Send the message
        const twilioMessage = await client.messages.create({
            from: process.env.TWILIO_PHONE_NUMBER,
            to: formattedPhone,
            body: message
        });

        console.log(`SMS sent successfully. SID: ${twilioMessage.sid}`);
        return {
            success: true,
            messageId: twilioMessage.sid,
            status: twilioMessage.status
        };
    } catch (error) {
        console.error('SMS Service Error:', {
            name: error.name,
            message: error.message,
            code: error.code,
            status: error.status,
            moreInfo: error.moreInfo,
            stack: error.stack
        });

        // Check for specific auth errors
        if (error.status === 401) {
            console.error('Authentication failed. Please verify your Twilio credentials.');
        }

        throw {
            message: 'Failed to send SMS',
            originalError: {
                code: error.code,
                status: error.status,
                message: error.message
            }
        };
    }
};

module.exports = sendSMS;
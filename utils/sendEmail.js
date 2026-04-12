const nodemailer = require("nodemailer");

const sendEmail = async (options) => {
    try {
        // Create a transporter using your email service settings
        const transporter = nodemailer.createTransport({
            service: 'gmail',  
            auth: {
                user: process.env.EMAIL_USERNAME,
                pass: process.env.EMAIL_PASS,
            },
        });

        // Verify recipients exist
        if (!options.to) {
            throw new Error('Recipient email address is required');
        }

        // Define email data
        const mailOptions = {
            from: `"Pikngo" <${process.env.EMAIL_USERNAME}>`,  
            to: options.to,
            subject: options.subject,
            text: options.text,
            html: options.html,
        };

        // Send the email and return the result
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent successfully:', info.messageId);
        return info;
    } catch (error) {
        console.error("Error sending email:", error);
        throw error; 
    }
};

module.exports = sendEmail;
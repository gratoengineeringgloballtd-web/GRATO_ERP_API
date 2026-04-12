const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class MTNMoMoService {
    constructor() {
        this.baseUrl = process.env.MTN_MOMO_API_URL;
        this.primaryKey = process.env.MTN_MOMO_PRIMARY_KEY;
        this.secondaryKey = process.env.MTN_MOMO_SECONDARY_KEY;
        this.apiUser = process.env.MTN_MOMO_API_USER;
        this.apiKey = process.env.MTN_MOMO_API_KEY;
    }

    async generateToken() {
        try {
            const auth = Buffer.from(`${this.apiUser}:${this.apiKey}`).toString('base64');
            console.log('Authorization:', auth);
            const response = await axios({
                method: 'post',

                url: `${this.baseUrl}/collection/token/`,
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Ocp-Apim-Subscription-Key': this.primaryKey
                }
            });
            return response.data.access_token;
        } catch (error) {
            throw new Error('Failed to generate MTN MoMo token');
        }
    }

    async initiatePayment(phoneNumber, amount, description) {
        console.log('Initiating MTN MoMo payment:', phoneNumber, amount, description);
        try {
            const token = await this.generateToken();
            const externalId = uuidv4();
            
            const payload = {
                amount: amount.toString(),
                currency: "EUR",
                externalId: externalId,
                payer: {
                    partyIdType: "MSISDN",
                    partyId: phoneNumber
                },
                payerMessage: description,
                payeeNote: description
            };

            const headers = {
                'Authorization': `Bearer ${token}`,
                'X-Reference-Id': externalId,
                'X-Target-Environment': process.env.MTN_MOMO_ENVIRONMENT || 'sandbox',
                'Ocp-Apim-Subscription-Key': this.primaryKey
            }

            const response = await axios({
                method: 'post',
                url: `${this.baseUrl}/collection/v1_0/requesttopay`,
                headers: headers,
                data: payload
            });

            return {
                transactionId: externalId,
                status: 'pending'
            };
        } catch (error) {
            console.log('MTN MoMo payment initiation error:', error.message);
            throw new Error('Failed to initiate MTN MoMo payment');
        }
    }

    async checkPaymentStatus(transactionId) {
        try {
            const token = await this.generateToken();
            
            const response = await axios({
                method: 'get',
                url: `${this.baseUrl}/collection/v1_0/requesttopay/${transactionId}`,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Target-Environment': process.env.MTN_MOMO_ENVIRONMENT,
                    'Ocp-Apim-Subscription-Key': this.primaryKey
                }
            });

            return {
                status: response.data.status.toLowerCase(),
                transactionId: transactionId
            };
        } catch (error) {
            throw new Error('Failed to check MTN MoMo payment status');
        }
    }
}

module.exports = new MTNMoMoService();
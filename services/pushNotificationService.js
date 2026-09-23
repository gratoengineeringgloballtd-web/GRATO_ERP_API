let admin = null;
let firebaseInitialized = false;

try {
    admin = require('firebase-admin');
    
    if (!admin.apps.length) {
        try {
            // Try to initialize Firebase Admin
            admin.initializeApp();
            firebaseInitialized = true;
            console.log('✅ Firebase Admin initialized successfully');
        } catch (e) {
            console.warn('⚠️ Firebase Admin not initialized. Push notifications will be disabled.', e.message);
            firebaseInitialized = false;
        }
    } else {
        firebaseInitialized = true;
    }
} catch (err) {
    console.warn('⚠️ firebase-admin module not found. Push notifications will be disabled. Install with: npm install firebase-admin');
    firebaseInitialized = false;
}

const User = require('../models/User');

class PushNotificationService {
    // constructor() {
    //     // Initialize Firebase Admin with your credentials
    //     admin.initializeApp({
    //         credential: admin.credential.cert({
    //             projectId: process.env.FIREBASE_PROJECT_ID,
    //             clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    //             privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n')
    //         })
    //     });
    // }

    async sendToUser(userId, notification) {
        if (!firebaseInitialized || !admin) {
            console.log('⚠️ Push notification skipped - Firebase not initialized. Notification record still created in DB.');
            return { success: false, message: 'Firebase not initialized', successCount: 0, failureCount: 0 };
        }
        
        try {
            const user = await User.findById(userId).select('fcmTokens');
            console.log('Attempting to send notification to user:', userId);
            console.log('User found:', !!user);
            console.log('FCM Tokens:', user?.fcmTokens?.length || 0);
    
            if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
                console.log('⚠️ User has no FCM tokens registered. Notification record still created in DB.');
                return { success: false, message: 'No FCM tokens', successCount: 0, failureCount: 0 };
            }
    
            const tokens = user.fcmTokens.map(t => t.token);
            const message = {
                notification: {
                    title: notification.title,
                    body: notification.body
                },
                data: notification.data
                    ? {
                        ...notification.data,
                    }
                    : undefined, 
                tokens: tokens,
                android: {
                    priority: 'high'
                },
                apns: {
                    payload: {
                        aps: {
                            contentAvailable: true
                        }
                    }
                }
            };
    
            console.log('Sending FCM message:', JSON.stringify(message, null, 2));
            const response = await admin.messaging().sendMulticast(message);
            console.log('FCM Response:', response);
    
            // Handle failed tokens
            if (response.failureCount > 0) {
                const failedTokens = [];
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        console.log(`Failed to send to token: ${tokens[idx]}`, resp.error);
                        failedTokens.push(tokens[idx]);
                    }
                });
    
                // Remove failed tokens
                if (failedTokens.length > 0) {
                    await User.findByIdAndUpdate(userId, {
                        $pull: {
                            fcmTokens: {
                                token: { $in: failedTokens }
                            }
                        }
                    });
                }
            }
    
            return {
                success: true,
                successCount: response.successCount,
                failureCount: response.failureCount
            };
        } catch (error) {
            console.error('Error in sendToUser:', error);
            throw error;
        }
    }

    async sendToMultipleUsers(userIds, notification) {
        if (!firebaseInitialized || !admin) {
            console.log('⚠️ Push notifications skipped - Firebase not initialized. Notification records still created in DB.');
            return { success: false, message: 'Firebase not initialized', successCount: 0, failureCount: 0 };
        }
        
        try {
            const users = await User.find({ _id: { $in: userIds } });
            const allTokens = users.reduce((tokens, user) => {
                if (user.fcmTokens && user.fcmTokens.length > 0) {
                    tokens.push(...user.fcmTokens.map(t => t.token));
                }
                return tokens;
            }, []);

            if (allTokens.length === 0) {
                console.log('⚠️ No valid FCM tokens found. Notification records still created in DB.');
                return { success: false, message: 'No FCM tokens', successCount: 0, failureCount: 0 };
            }

            const message = {
                notification: {
                    title: notification.title,
                    body: notification.body
                },
                data: {
                    ...notification.data,
                    click_action: 'NOTIFICATION_CLICK'
                },
                tokens: allTokens
            };

            const response = await admin.messaging().sendMulticast(message);
            
            // Handle failed tokens
            if (response.failureCount > 0) {
                await this.handleFailedTokens(response, allTokens, users);
            }

            return response;
        } catch (error) {
            console.error('Error sending notifications:', error);
            throw error;
        }
    }

    async handleFailedTokens(response, tokens, users) {
        const invalidTokens = [];
        response.responses.forEach((resp, idx) => {
            if (!resp.success) {
                invalidTokens.push(tokens[idx]);
            }
        });

        // Remove invalid tokens from users
        if (invalidTokens.length > 0) {
            for (const user of users) {
                const userInvalidTokens = user.fcmTokens.filter(t => 
                    invalidTokens.includes(t.token)
                );
                if (userInvalidTokens.length > 0) {
                    user.fcmTokens = user.fcmTokens.filter(t => 
                        !invalidTokens.includes(t.token)
                    );
                    await user.save();
                }
            }
        }
    }

    // Token management methods
    async registerToken(userId, token, device, platform) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            await user.addFcmToken(token, device, platform);
            return true;
        } catch (error) {
            console.error('Error registering token:', error);
            throw error;
        }
    }

    async removeToken(userId, token) {
        try {
          await User.findByIdAndUpdate(userId, {
            $pull: { fcmTokens: { token } }
          });
          return true;
        } catch (error) {
          console.error('Error removing token:', error);
          throw error;
        }
    }
}

module.exports = new PushNotificationService();
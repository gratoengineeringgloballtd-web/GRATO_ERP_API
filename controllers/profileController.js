const {uploadFile} = require('../services/fileUploadService');
const User = require('../models/User');


const safeParseJSON = (value) => {
    if (!value) return null;
    if (typeof value === 'object') return value;

    try {
        if (typeof value === 'string' && value.includes('\\"')) {
            const unescapedValue = value
                .replace(/\\\"/g, '"')
                .replace(/\\\\/g, '\\');
            return JSON.parse(unescapedValue);
        }
        return JSON.parse(value);
    } catch (error) {
        console.error('JSON parsing error:', {
            originalValue: value,
            error: error.message
        });
        return null;
    }
};

const transformProfileData = (parsedData, field) => {
    switch (field) {
        case 'spokenLanguages':
            if (Array.isArray(parsedData)) {
                return parsedData.map(lang => {
                    // Handle case where input is already in correct format
                    if (typeof lang === 'object' && lang.language) {
                        return {
                            language: lang.language,
                            proficiency: lang.proficiency || 'intermediate'
                        };
                    }
                    // Handle case where input is just language string
                    return {
                        language: lang,
                        proficiency: 'intermediate' 
                    };
                });
            }
            return null;

        case 'preferredPaymentMethods':
            if (Array.isArray(parsedData)) {
                return parsedData.filter(method =>
                    ['bank_transfer', 'mobile_money', 'cash'].includes(method)
                );
            }
            return null;

        case 'location':
            if (typeof parsedData === 'object' && parsedData.address) {
                return {
                    type: 'Point',
                    coordinates: parsedData.coordinates ? 
                        [parsedData.coordinates.lng || 0, parsedData.coordinates.lat || 0] : 
                        [0, 0],
                    address: parsedData.address,
                    city: parsedData.city,
                    country: parsedData.country
                };
            }
            return null;

        case 'paymentDetails':
            if (Array.isArray(parsedData)) {
                return parsedData;
            } else if (typeof parsedData === 'object') {
                const details = [];
                if (parsedData.bankAccount) {
                    details.push({
                        type: 'bank',
                        accountNumber: parsedData.bankAccount.accountNumber,
                        bankName: parsedData.bankAccount.bankName || '',
                        accountName: parsedData.bankAccount.accountName || ''
                    });
                }
                if (parsedData.mobileMoneyAccount) {
                    details.push({
                        type: 'mobile_money',
                        mobileMoneyProvider: parsedData.mobileMoneyAccount.provider || '',
                        mobileMoneyNumber: parsedData.mobileMoneyAccount.number || ''
                    });
                }
                return details;
            }
            return null;

        default:
            return parsedData;
    }
};

const processUpdateField = (updateData, field) => {
    if (!updateData[field]) return null;

    const parsedValue = safeParseJSON(updateData[field]);
    if (!parsedValue) {
        console.warn(`Failed to parse ${field}, removing from update`);
        return null;
    }

    const transformedValue = transformProfileData(parsedValue, field);
    if (!transformedValue) {
        console.warn(`Invalid data structure for ${field}, removing from update`);
        return null;
    }

    return transformedValue;
};


// Calculate profile completion percentage
const calculateProfileCompletion = (user) => {
    const requiredFields = {
        basic: ['fullName', 'profilePhoto', 'phone', 'email'],
        location: ['location'],
        identity: ['identificationDocument'],
        preferences: ['preferredPaymentMethods', 'spokenLanguages'],
        doerSpecific: user.role === 'doer' ? [
            'doerProfile.skills',
            'doerProfile.services',
            'doerProfile.availability'
        ] : []
    };

    const allFields = [
        ...requiredFields.basic,
        ...requiredFields.location,
        ...requiredFields.identity,
        ...requiredFields.preferences,
        ...requiredFields.doerSpecific
    ];

    const completedFields = allFields.filter(field => {
        const value = field.split('.').reduce((obj, key) => obj?.[key], user);
        return value && (
            Array.isArray(value) ? value.length > 0 : 
            typeof value === 'object' ? Object.keys(value).length > 0 : 
            Boolean(value)
        );
    });

    return Math.round((completedFields.length / allFields.length) * 100);
};

// Handle file upload with retry logic
const uploadWithRetry = async (file, maxRetries = 3) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await uploadFile(file);
        } catch (error) {
            if (attempt === maxRetries) throw error;
            await new Promise(resolve => 
                setTimeout(resolve, 1000 * Math.pow(2, attempt))
            );
        }
    }
};

const processNestedFields = (updateData) => {
    const processed = {};
    const nestedFields = {};

    // Separate dot notation fields
    for (const [key, value] of Object.entries(updateData)) {
        if (key.includes('.')) {
            nestedFields[key] = value;
        } else {
            processed[key] = value;
        }
    }

    // Process non-nested fields as before
    const fieldsToProcess = [
        'location',
        'spokenLanguages',
        'preferredPaymentMethods',
        'paymentDetails'
    ];

    for (const field of fieldsToProcess) {
        if (processed[field]) {
            const processedValue = processUpdateField(processed, field);
            if (processedValue !== null) {
                processed[field] = processedValue;
            } else {
                delete processed[field];
            }
        }
    }

    // Process nested fields
    const groupedNested = {};
    for (const [key, value] of Object.entries(nestedFields)) {
        const [mainField, ...rest] = key.split('.');
        if (!groupedNested[mainField]) {
            groupedNested[mainField] = {};
        }
        
        let current = groupedNested[mainField];
        const lastIndex = rest.length - 1;
        
        rest.forEach((part, index) => {
            // Handle array notation, e.g., skills[0]
            const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
            if (arrayMatch) {
                const [_, arrayName, arrayIndex] = arrayMatch;
                if (!current[arrayName]) {
                    current[arrayName] = [];
                }
                if (!current[arrayName][arrayIndex]) {
                    current[arrayName][arrayIndex] = {};
                }
                if (index === lastIndex) {
                    current[arrayName][arrayIndex] = safeParseJSON(value) ?? value;
                } else {
                    current = current[arrayName][arrayIndex];
                }
            } else {
                if (index === lastIndex) {
                    current[part] = safeParseJSON(value) ?? value;
                } else {
                    current[part] = current[part] || {};
                    current = current[part];
                }
            }
        });
    }

    // Merge processed nested fields
    for (const [key, value] of Object.entries(groupedNested)) {
        processed[key] = value;
    }

    return processed;
};

exports.updateProfile = async (req, res) => {
    try {
        const userId = req.user._id;
        const files = req.files || {};
        let updateData = processNestedFields({ ...req.body });

        // Handle file uploads (rest of the code remains the same)
        if (files.profilePhoto?.[0]) {
            const profilePhotoResult = await uploadWithRetry(files.profilePhoto[0]);
            updateData.profilePhoto = {
                url: profilePhotoResult.secure_url,
                verified: false,
                publicId: profilePhotoResult.public_id,
                width: profilePhotoResult.width,
                height: profilePhotoResult.height,
                format: profilePhotoResult.format,
                resourceType: profilePhotoResult.resource_type
            };
        }

        // Rest of your existing updateProfile code...
        const user = await User.findByIdAndUpdate(
            userId,
            { $set: updateData },
            { 
                new: true, 
                runValidators: true,
                select: '-password -emailVerificationToken -phoneVerificationToken' 
            }
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Calculate and update profile completion
        const completionPercentage = calculateProfileCompletion(user);
        user.profileCompletionPercentage = completionPercentage;
        user.profileCompletionStatus = 
            completionPercentage === 100 ? 'completed' : 'in_progress';
        
        await user.save();

        res.status(200).json({
            success: true,
            data: {
                user,
                completionPercentage
            }
        });

    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({
            success: false,
            message: 'Profile update failed',
            error: error.message
        });
    }
};

exports.getProfile = async (req, res) => {
    try {
        const userId = req.user._id;
        
        const user = await User.findById(userId)
            .select('-password -emailVerificationToken -phoneVerificationToken');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.status(200).json({
            success: true,
            data: { 
                user,
                completionPercentage: user.profileCompletionPercentage
            }
        });

    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve profile',
            error: error.message
        });
    }
};


exports.deleteProfile = async (req, res) => {
    try {
        const userId = req.user._id;
        
        const deletedUser = await User.findByIdAndDelete(userId);
        
        if (!deletedUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'User profile deleted'
        });

    } catch (error) {
        console.error('Delete profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete profile',
            error: error.message
        });
    }
};
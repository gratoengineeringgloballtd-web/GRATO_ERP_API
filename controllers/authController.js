const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const QuarterlyKPI = require('../models/QuarterlyKPI');
const HierarchyService = require('../services/hierarchyService');
const WorkflowService = require('../services/workflowService');

/**
 * Enhanced Authentication Controller with Hierarchy Management
 */

// ==========================================
// AUTHENTICATION
// ==========================================

const getCurrentQuarterInfo = () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const quarter = `Q${Math.ceil(month / 3)}-${year}`;
    return { quarter, year };
};

exports.login = async (req, res) => {
    try {
        console.log('=== LOGIN ATTEMPT ===');
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        const user = await User.findOne({ email }).populate('supervisor departmentHead');
        
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: 'Your account is not active. Please contact administrator.'
            });
        }

        const isValidPassword = await user.comparePassword(password);
        
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Generate JWT
        const token = jwt.sign(
            { 
                userId: user._id,
                role: user.role 
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        console.log('✅ Login successful:', user.email);

        let kpiStatus = null;
        if (user.role !== 'supplier') {
            const { quarter, year } = getCurrentQuarterInfo();
            const kpi = await QuarterlyKPI.findOne({ employee: user._id, quarter, year }).select('approvalStatus submittedAt');
            kpiStatus = {
                quarter,
                year,
                hasKpi: !!kpi,
                isSubmitted: kpi ? kpi.approvalStatus !== 'draft' : false,
                approvalStatus: kpi?.approvalStatus || null,
                submittedAt: kpi?.submittedAt || null
            };
        }

        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id,
                email: user.email,
                fullName: user.fullName,
                role: user.role,
                department: user.department,
                position: user.position,
                hierarchyLevel: user.hierarchyLevel,
                approvalCapacities: user.approvalCapacities,
                kpiStatus,
                signature: user.signature?.url ? {
                    url: user.signature.url,
                    uploadedAt: user.signature.uploadedAt
                } : null,
                supervisor: user.supervisor ? {
                    id: user.supervisor._id,
                    name: user.supervisor.fullName,
                    email: user.supervisor.email
                } : null
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed',
            error: error.message
        });
    }
};

exports.logout = async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            success: false,
            message: 'Logout failed',
            error: error.message
        });
    }
};

// ==========================================
// USER CREATION WITH HIERARCHY
// ==========================================

/**
 * Create user with automatic hierarchy setup
 */
exports.createUserWithHierarchy = async (req, res) => {
    try {
        const {
            email,
            password,
            fullName,
            department,
            position,
            supervisorId // For dynamic supervisor positions
        } = req.body;

        console.log('=== CREATING USER WITH HIERARCHY ===');
        console.log({ email, position, department });

        // Validate required fields
        if (!email || !password || !fullName || !department || !position) {
            return res.status(400).json({
                success: false,
                message: 'All required fields must be provided'
            });
        }

        // Check if user exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'User with this email already exists'
            });
        }

        // Validate position in structure
        const validation = HierarchyService.validatePosition(department, position);

        // Check if position is filled (unless multiple allowed)
        const fillStatus = await HierarchyService.isPositionFilled(department, position);
        if (!fillStatus.canCreate) {
            return res.status(400).json({
                success: false,
                message: `Position "${position}" is already filled by ${fillStatus.existingUser.fullName}`
            });
        }

        // Determine supervisor
        let supervisor = null;

        if (validation.data.dynamicSupervisor && supervisorId) {
            // For positions with dynamic supervisors (e.g., Field Technicians)
            supervisor = await User.findById(supervisorId);
            
            if (!supervisor || !supervisor.isActive) {
                return res.status(400).json({
                    success: false,
                    message: 'Selected supervisor not found or inactive'
                });
            }
        } else {
            // Standard hierarchy from structure
            supervisor = await HierarchyService.findSupervisorFromStructure(department, position);
        }

        // Get department head
        const departmentHead = await HierarchyService.getDepartmentHead(department);

        // Determine role and approval capacities
        const role = HierarchyService.determineUserRole(position, department, validation.data);
        const approvalCapacities = HierarchyService.determineApprovalCapacities(
            position, 
            department, 
            validation.isHead
        );

        // Set permissions
        const permissions = getPermissionsForRole(role, approvalCapacities);

        // Prepare user data
        const userData = {
            email,
            password,
            fullName,
            role,
            department,
            position,
            hierarchyLevel: validation.data.hierarchyLevel,
            supervisor: supervisor?._id,
            departmentHead: departmentHead?._id,
            approvalCapacities,
            permissions,
            isActive: true,
            directReports: []
        };

        // Add buyer details if applicable
        if (validation.data.buyerConfig) {
            userData.buyerDetails = {
                specializations: validation.data.buyerConfig.specializations,
                maxOrderValue: validation.data.buyerConfig.maxOrderValue,
                workload: {
                    currentAssignments: 0,
                    monthlyTarget: 50
                },
                performance: {
                    completedOrders: 0,
                    averageProcessingTime: 0,
                    customerSatisfactionRating: 5
                },
                availability: {
                    isAvailable: true
                }
            };
        }

        // Create user
        const newUser = new User(userData);
        await newUser.save();

        // Update supervisor's directReports
        if (supervisor) {
            if (!supervisor.directReports.includes(newUser._id)) {
                supervisor.directReports.push(newUser._id);
                await supervisor.save();
            }
        }

        // Calculate hierarchy path
        await HierarchyService.calculateHierarchyPath(newUser._id);

        // Generate approval chain preview
        const approvalChain = await WorkflowService.generateApprovalWorkflow(newUser._id);

        console.log('✅ User created successfully');
        console.log(`- Supervisor: ${supervisor?.fullName || 'None'}`);
        console.log(`- Dept Head: ${departmentHead?.fullName || 'None'}`);
        console.log(`- Approval Chain: ${approvalChain.length} levels`);

        res.status(201).json({
            success: true,
            message: 'User created successfully with hierarchy',
            data: {
                user: {
                    _id: newUser._id,
                    email: newUser.email,
                    fullName: newUser.fullName,
                    role: newUser.role,
                    department: newUser.department,
                    position: newUser.position,
                    hierarchyLevel: newUser.hierarchyLevel,
                    approvalCapacities: newUser.approvalCapacities
                },
                supervisor: supervisor ? {
                    _id: supervisor._id,
                    fullName: supervisor.fullName,
                    email: supervisor.email,
                    position: supervisor.position
                } : null,
                departmentHead: departmentHead ? {
                    _id: departmentHead._id,
                    fullName: departmentHead.fullName,
                    email: departmentHead.email
                } : null,
                approvalChainPreview: approvalChain.map(step => ({
                    level: step.level,
                    approver: step.approver.name,
                    position: step.approver.position,
                    capacity: step.approvalCapacity
                }))
            }
        });

    } catch (error) {
        console.error('❌ Create user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create user',
            error: error.message
        });
    }
};

// ==========================================
// HIERARCHY MANAGEMENT
// ==========================================

/**
 * Get available positions for user creation
 */
exports.getAvailablePositions = async (req, res) => {
    try {
        const positions = HierarchyService.getAvailablePositions();

        // Check which are filled
        const enrichedPositions = await Promise.all(
            positions.map(async (pos) => {
                const fillStatus = await HierarchyService.isPositionFilled(pos.department, pos.position);
                
                return {
                    ...pos,
                    isFilled: fillStatus.filled,
                    canCreate: fillStatus.canCreate,
                    currentHolder: fillStatus.existingUser ? {
                        name: fillStatus.existingUser.fullName,
                        email: fillStatus.existingUser.email
                    } : null
                };
            })
        );

        res.json({
            success: true,
            data: enrichedPositions
        });

    } catch (error) {
        console.error('Get available positions error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch positions',
            error: error.message
        });
    }
};

/**
 * Get potential supervisors for a position
 */
exports.getPotentialSupervisorsForPosition = async (req, res) => {
    try {
        const { department, position } = req.query;

        if (!department || !position) {
            return res.status(400).json({
                success: false,
                message: 'Department and position are required'
            });
        }

        const supervisors = await HierarchyService.getPotentialSupervisors(department, position);

        res.json({
            success: true,
            data: supervisors.map(sup => ({
                _id: sup._id,
                fullName: sup.fullName,
                email: sup.email,
                position: sup.position,
                currentReports: sup.directReports.length
            }))
        });

    } catch (error) {
        console.error('Get potential supervisors error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch supervisors',
            error: error.message
        });
    }
};

/**
 * Update user's supervisor
 */
exports.updateUserSupervisor = async (req, res) => {
    try {
        const { userId } = req.params;
        const { supervisorId } = req.body;
        const updatedBy = req.user.userId;

        const result = await HierarchyService.updateSupervisor(userId, supervisorId, updatedBy);

        res.json({
            success: true,
            message: 'Supervisor updated successfully',
            data: result
        });

    } catch (error) {
        console.error('Update supervisor error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update supervisor',
            error: error.message
        });
    }
};

/**
 * Get user's direct reports
 */
exports.getDirectReports = async (req, res) => {
    try {
        const userId = req.user.userId;

        const user = await User.findById(userId)
            .populate({
                path: 'directReports',
                match: { isActive: true },
                select: 'fullName email department position hierarchyLevel'
            });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: user.directReports || []
        });

    } catch (error) {
        console.error('Get direct reports error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch direct reports',
            error: error.message
        });
    }
};

/**
 * Get user's approval chain
 */
exports.getMyApprovalChain = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { workflowType = 'general' } = req.query;

        const approvalChain = await WorkflowService.generateApprovalWorkflow(userId, workflowType);

        res.json({
            success: true,
            data: approvalChain
        });

    } catch (error) {
        console.error('Get approval chain error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch approval chain',
            error: error.message
        });
    }
};

/**
 * Preview workflow before submission
 */
exports.previewWorkflow = async (req, res) => {
    try {
        const { requestorId, workflowType = 'general' } = req.query;
        
        const userId = requestorId || req.user.userId;

        const preview = await WorkflowService.previewWorkflow(userId, workflowType);

        res.json({
            success: true,
            data: preview
        });

    } catch (error) {
        console.error('Preview workflow error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to preview workflow',
            error: error.message
        });
    }
};

/**
 * Validate user hierarchy
 */
exports.validateUserHierarchy = async (req, res) => {
    try {
        const { userId } = req.params;

        const validation = await HierarchyService.validateHierarchy(userId);

        res.json({
            success: true,
            data: validation
        });

    } catch (error) {
        console.error('Validate hierarchy error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to validate hierarchy',
            error: error.message
        });
    }
};


exports.getActiveUsers = async (req, res) => {
    try {
        const users = await User.find({ 
            isActive: true,
            role: { $ne: 'supplier' }  // Exclude suppliers
        })
        .select('fullName email role department position hierarchyLevel')
        .sort({ fullName: 1 });

        res.json({
            success: true,
            data: users
        });

    } catch (error) {
        console.error('Get active users error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch active users',
            error: error.message
        });
    }
};

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Get permissions based on role and approval capacities
 */
function getPermissionsForRole(role, approvalCapacities = []) {
    const permissions = ['basic_access', 'view_own_data'];

    if (role === 'admin') {
        return [
            'all_access',
            'user_management',
            'team_management',
            'financial_approval',
            'executive_decisions',
            'system_settings'
        ];
    }

    if (role === 'finance') {
        permissions.push(
            'financial_approval',
            'budget_management',
            'invoice_processing',
            'financial_reports'
        );
    }

    if (approvalCapacities.includes('department_head') || approvalCapacities.includes('business_head')) {
        permissions.push(
            'team_management',
            'approvals',
            'team_data_access',
            'behavioral_evaluations',
            'performance_reviews'
        );
    }

    if (approvalCapacities.includes('direct_supervisor')) {
        permissions.push(
            'approvals',
            'team_data_access',
            'behavioral_evaluations'
        );
    }

    if (role === 'buyer') {
        permissions.push(
            'procurement',
            'vendor_management',
            'order_processing',
            'requisition_handling'
        );
    }

    permissions.push('submit_requests');

    return permissions;
}

module.exports = exports;





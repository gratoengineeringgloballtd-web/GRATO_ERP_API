const User = require('../models/User');
const Maintenance = require('../models/Maintenance');
const Cluster = require('../models/Cluster');
const Part = require('../models/Part');
const PartRequest = require('../models/PartRequest');
const authController = require('./authController');
const technicianController = require('./technicianController');

// Helper to determine update logic based on role
const getUpdateLogic = async (id, updates, role, req, res) => {
    // Technician update logic is in technicianController.updateTechnician
    if (role === 'technician') {
        // We reuse the logic by mocking req/res or calling inner function if refactored.
        // For now, we'll implement the update logic directly here or redirect map to the controller
        // but technicianController expects specific req/res structure. 
        // Best approach: Call the specific controller method if possible, or reimplement generic update.

        // Let's implement generic update for admin efficiency
        const user = await User.findByIdAndUpdate(id, { $set: updates }, { new: true });
        return user;
    }
    // Generic update for others
    const user = await User.findByIdAndUpdate(id, { $set: updates }, { new: true });
    return user;
};

exports.getAllUsers = authController.getUsers;

exports.createUser = async (req, res) => {
    const { role } = req.body;
    if (role === 'technician' || role === 'ac' || role === 'fuel') {
        return technicianController.createTechnician(req, res);
    } else if (role === 'supervisor') {
        return authController.createSupervisor(req, res);
    } else {
        // Fallback or generic create
        return authController.register(req, res);
    }
};

exports.updateUser = async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    if (role === 'technician' || role === 'ac' || role === 'fuel') {
        return technicianController.updateTechnician(req, res);
    } else if (role === 'supervisor') {
        return authController.updateSupervisor(req, res);
    } else {
        // Generic implementation for other roles
        try {
            const updates = { ...req.body };
            delete updates.password; // Don't update password here directly usually

            const user = await User.findByIdAndUpdate(id, { $set: updates }, { new: true });
            if (!user) return res.status(404).json({ success: false, message: 'User not found' });

            res.json({ success: true, data: user });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
};

exports.deleteUser = async (req, res) => {
    const { id } = req.params;
    // We might need to check the role of the user being deleted to call specific cleanup
    try {
        const user = await User.findById(id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (user.role === 'technician' || user.role === 'ac' || role === 'fuel') {
            return technicianController.deleteTechnician(req, res);
        } else {
            await User.findByIdAndDelete(id);
            res.json({ success: true, message: 'User deleted' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.toggleUserStatus = async (req, res) => {
    const { id } = req.params;
    try {
        const user = await User.findById(id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        user.isActive = !user.isActive;
        await user.save();

        res.json({ success: true, data: user });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getDashboard = async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const activeUsers = await User.countDocuments({ isActive: true });

        // Group by role
        const roleStats = await User.aggregate([
            { $group: { _id: "$role", count: { $sum: 1 } } }
        ]);

        // Simplify role stats object to array for charts
        const roles = roleStats.map(stat => ({
            role: stat._id,
            count: stat.count
        }));

        // Get part requests stats
        const pendingPartRequests = await PartRequest.countDocuments({ status: 'pending' });
        const totalPartRequests = await PartRequest.countDocuments();
        const approvedPartRequests = await PartRequest.countDocuments({ status: 'approved' });
        const recentPartRequests = await PartRequest.find({ status: 'pending' })
            .populate('technician', 'fullName email')
            .populate('items.part', 'name part_number')
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();

        res.json({
            success: true,
            data: {
                users: {
                    total: totalUsers,
                    active: activeUsers,
                    by_role: roles
                },
                sites: {
                    total: await require('../models/Site').countDocuments()
                },
                maintenance: {
                    active: await require('../models/Maintenance').countDocuments({ status: 'in_progress' }),
                    pending: await require('../models/Maintenance').countDocuments({ status: 'pending_approval' }),
                    trend: [] // Placeholder for now
                },
                partRequests: {
                    total: totalPartRequests,
                    pending: pendingPartRequests,
                    approved: approvedPartRequests,
                    recent: recentPartRequests
                },
                system: {
                    status: 'healthy',
                    uptime: process.uptime()
                }
            }
        });
    } catch (error) {
        console.error('Admin dashboard error:', error);
        res.status(500).json({ success: false, error: 'Failed to load dashboard metrics' });
    }
};

// ==================== SITE MANAGEMENT ====================
exports.getAllSites = async (req, res) => {
    try {
        const { page = 1, limit = 20, search, cluster } = req.query;
        const query = {};

        if (search) {
            query.$or = [
                { Site_Name: { $regex: search, $options: 'i' } },
                { IHS_ID_SITE: { $regex: search, $options: 'i' } }
            ];
        }
        if (cluster) {
            query.GRATO_Cluster = cluster;
        }

        const sites = await Site.find(query)
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .sort({ createdAt: -1 });

        const count = await Site.countDocuments(query);

        // Log the filtered results in the terminal
        console.log('Admin getAllSites:', {
            query,
            count,
            sites: sites.map(s => ({ _id: s._id, Site_Name: s.Site_Name, GRATO_Cluster: s.GRATO_Cluster }))
        });

        res.json({
            success: true,
            data: {
                sites,
                pagination: {
                    total: count,
                    pages: Math.ceil(count / limit),
                    page: parseInt(page),
                    limit: parseInt(limit)
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.createSite = async (req, res) => {
    try {
        const site = await Site.create(req.body);
        res.status(201).json({ success: true, data: site });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.updateSite = async (req, res) => {
    try {
        const site = await Site.findOneAndUpdate(
            { IHS_ID_SITE: req.params.id },
            req.body,
            { new: true, runValidators: true }
        );
        if (!site) return res.status(404).json({ success: false, message: 'Site not found' });
        res.json({ success: true, data: site });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.deleteSite = async (req, res) => {
    try {
        const site = await Site.findOneAndDelete({ IHS_ID_SITE: req.params.id });
        if (!site) return res.status(404).json({ success: false, message: 'Site not found' });
        res.json({ success: true, message: 'Site deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ==================== MAINTENANCE MANAGEMENT ====================
exports.getAllMaintenance = async (req, res) => {
    try {
        const { page = 1, limit = 20, status } = req.query;
        const query = {};
        if (status) query.status = status;

        const maintenance = await Maintenance.find(query)
            .populate('technician', 'fullName')
            .populate('supervisor', 'fullName')
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .sort({ createdAt: -1 });

        const count = await Maintenance.countDocuments(query);

        res.json({
            success: true,
            data: {
                maintenance,
                pagination: {
                    total: count,
                    pages: Math.ceil(count / limit),
                    page: parseInt(page),
                    limit: parseInt(limit)
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.updateMaintenanceStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const maintenance = await Maintenance.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true }
        );
        if (!maintenance) return res.status(404).json({ success: false, message: 'Maintenance record not found' });
        res.json({ success: true, data: maintenance });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.deleteMaintenance = async (req, res) => {
    try {
        const maintenance = await Maintenance.findByIdAndDelete(req.params.id);
        if (!maintenance) return res.status(404).json({ success: false, message: 'Maintenance record not found' });
        res.json({ success: true, message: 'Maintenance record deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ==================== CLUSTER MANAGEMENT ====================
const Site = require('../models/Site');
exports.getAllClusters = async (req, res) => {
    try {
        console.log('DEBUG: Starting cluster aggregation for /admin/clusters');
        // Aggregate sites by GRATO_Cluster to create cluster data
        const clusterAggregation = await Site.aggregate([
            {
                $match: {
                    GRATO_Cluster: { $exists: true, $ne: null, $ne: '' }
                }
            },
            {
                $group: {
                    _id: '$GRATO_Cluster',
                    region: { $first: '$Region' },
                    sites: { $push: '$$ROOT' },
                    totalSites: { $sum: 1 }
                }
            },
            {
                $sort: { _id: 1 }
            }
        ]);
        console.log('DEBUG: Aggregation result count:', clusterAggregation.length);
        // Fetch supervisor and technician info from Cluster collection
        const clusterDocs = await Cluster.find({ name: { $in: clusterAggregation.map(c => c._id) } })
            .populate('supervisor', 'fullName _id')
            .populate('assigned_technicians.technician', 'fullName _id');

        // Merge aggregation and clusterDocs
        // AFTER — _id included
const clusters = clusterAggregation.map(clusterAgg => {
    const clusterDoc = clusterDocs.find(c => c.name === clusterAgg._id);
    return {
        _id: clusterDoc?._id?.toString() || null,   // ← ADD THIS LINE
        name: clusterAgg._id,
        region: clusterAgg.region || '',
        supervisor: clusterDoc?.supervisor || null,
        assigned_technicians: clusterDoc?.assigned_technicians || [],
        sites_count: clusterAgg.totalSites,
        technicians_count: clusterDoc?.assigned_technicians?.length || 0,
        sites: Array.isArray(clusterAgg.sites) ? clusterAgg.sites : [],
    };
});
        console.log('DEBUG: Final clusters array for response:', clusters);

        res.json({ success: true, data: clusters });
    } catch (error) {
        console.error('ERROR in getAllClusters:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.createCluster = async (req, res) => {
    try {
        const cluster = await Cluster.create(req.body);
        res.status(201).json({ success: true, data: cluster });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.updateCluster = async (req, res) => {
    try {
        const cluster = await Cluster.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!cluster) return res.status(404).json({ success: false, message: 'Cluster not found' });
        res.json({ success: true, data: cluster });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.deleteCluster = async (req, res) => {
    try {
        const cluster = await Cluster.findByIdAndDelete(req.params.id);
        if (!cluster) return res.status(404).json({ success: false, message: 'Cluster not found' });
        res.json({ success: true, message: 'Cluster deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ==================== PARTS MANAGEMENT ====================
exports.getAllParts = async (req, res) => {
    try {
        const { page = 1, limit = 20, category } = req.query;
        const query = {};
        if (category) query.category = category;

        const parts = await Part.find(query)
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const count = await Part.countDocuments(query);

        res.json({
            success: true,
            data: {
                parts,
                pagination: {
                    total: count,
                    pages: Math.ceil(count / limit),
                    page: parseInt(page),
                    limit: parseInt(limit)
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.createPart = async (req, res) => {
    try {
        const part = await Part.create(req.body);
        res.status(201).json({ success: true, data: part });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.updatePart = async (req, res) => {
    try {
        const part = await Part.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!part) return res.status(404).json({ success: false, message: 'Part not found' });
        res.json({ success: true, data: part });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.deletePart = async (req, res) => {
    try {
        const part = await Part.findByIdAndDelete(req.params.id);
        if (!part) return res.status(404).json({ success: false, message: 'Part not found' });
        res.json({ success: true, message: 'Part deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ==================== PART REQUESTS MANAGEMENT ====================
exports.getAllPartRequests = async (req, res) => {
    try {
        const { page = 1, limit = 20, status, urgency, technician } = req.query;
        const query = {};
        
        if (status) query.status = status;
        if (urgency) query.urgency = urgency;
        if (technician) query.technician = technician;

        const partRequests = await PartRequest.find(query)
            .populate('technician', 'fullName email phone')
            .populate('items.part', 'name part_number category')
            .populate('supervisor_approval.approved_by', 'fullName')
            .populate('fulfillment_details.fulfilled_by', 'fullName')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .lean();

        const count = await PartRequest.countDocuments(query);

        res.json({
            success: true,
            data: {
                requests: partRequests,
                pagination: {
                    total: count,
                    pages: Math.ceil(count / limit),
                    page: parseInt(page),
                    limit: parseInt(limit)
                }
            }
        });
    } catch (error) {
        console.error('Get all part requests error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getPartRequestById = async (req, res) => {
    try {
        const partRequest = await PartRequest.findById(req.params.id)
            .populate('technician', 'fullName email phone')
            .populate('items.part', 'name part_number category stock_quantity')
            .populate('supervisor_approval.approved_by', 'fullName email')
            .populate('fulfillment_details.fulfilled_by', 'fullName email')
            .lean();

        if (!partRequest) {
            return res.status(404).json({ success: false, message: 'Part request not found' });
        }

        res.json({ success: true, data: partRequest });
    } catch (error) {
        console.error('Get part request error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.updatePartRequestStatus = async (req, res) => {
    try {
        const { status, comments, tracking_number } = req.body;
        const adminId = req.user.userId;

        const partRequest = await PartRequest.findById(req.params.id);
        if (!partRequest) {
            return res.status(404).json({ success: false, message: 'Part request not found' });
        }

        // Update status
        partRequest.status = status;

        // Handle approval
        if (status === 'approved') {
            partRequest.supervisor_approval = {
                approved_by: adminId,
                approved_at: new Date(),
                comments: comments || ''
            };
        }

        // Handle fulfillment
        if (status === 'fulfilled') {
            partRequest.fulfillment_details = {
                fulfilled_by: adminId,
                fulfilled_at: new Date(),
                tracking_number: tracking_number || ''
            };

            // Update part inventory
            for (const item of partRequest.items) {
                await Part.findByIdAndUpdate(item.part, {
                    $inc: { stock_quantity: -item.quantity }
                });
            }
        }

        await partRequest.save();

        const updatedRequest = await PartRequest.findById(req.params.id)
            .populate('technician', 'fullName email')
            .populate('items.part', 'name part_number')
            .populate('supervisor_approval.approved_by', 'fullName')
            .populate('fulfillment_details.fulfilled_by', 'fullName')
            .lean();

        res.json({ success: true, data: updatedRequest });
    } catch (error) {
        console.error('Update part request status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.deletePartRequest = async (req, res) => {
    try {
        const partRequest = await PartRequest.findByIdAndDelete(req.params.id);
        if (!partRequest) {
            return res.status(404).json({ success: false, message: 'Part request not found' });
        }
        res.json({ success: true, message: 'Part request deleted' });
    } catch (error) {
        console.error('Delete part request error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ==================== REPORTS & LOGS ====================
exports.getSystemReports = async (req, res) => {
    try {
        const { period = 30 } = req.query;
        // Placeholder implementation - in real system would aggregate from various collections
        res.json({
            success: true,
            data: {
                period: `${period} days`,
                generated_at: new Date(),
                summary: "System performance is optimal."
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getAuditLogs = async (req, res) => {
    try {
        // Placeholder - requires AuditLog model
        res.json({ success: true, data: [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.assignTechniciansToSupervisor = async (req, res) => {
    try {
        const { supervisorId, technicianIds } = req.body;

        // Deduplicate technicianIds before validation
        const uniqueTechnicianIds = [...new Set(technicianIds)];

        // Validation
        const supervisor = await User.findById(supervisorId);
        if (!supervisor || supervisor.role !== 'supervisor') {
            return res.status(400).json({ success: false, message: 'Invalid supervisor' });
        }

        // Allow both 'technician' and 'ac' roles
        const technicians = await User.find({ 
            _id: { $in: uniqueTechnicianIds }, 
            role: { $in: ['technician', 'ac'] } 
        });

        if (technicians.length !== uniqueTechnicianIds.length) {
            return res.status(400).json({ success: false, message: 'One or more invalid technicians' });
        }

        // Update Supervisor
        supervisor.assignedTechnicians = [...new Set([
            ...(supervisor.assignedTechnicians || []).map(id => id.toString()), 
            ...uniqueTechnicianIds
        ])];
        await supervisor.save();

        // Update Technicians
        await User.updateMany(
            { _id: { $in: uniqueTechnicianIds } },
            { $set: { supervisor: supervisorId } }
        );

        res.json({ success: true, message: 'Technicians assigned successfully', data: supervisor });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};



// ==================== CLUSTER TECHNICIAN ASSIGNMENT ====================
// Add these two functions at the bottom of adminController.js

exports.assignTechnicianToCluster = async (req, res) => {
    try {
        const { technicianId } = req.body;
        if (!technicianId) {
            return res.status(400).json({ success: false, error: 'technicianId is required' });
        }

        const cluster = await Cluster.findById(req.params.id);
        if (!cluster) return res.status(404).json({ success: false, error: 'Cluster not found' });

        const alreadyAssigned = cluster.assigned_technicians.some(
            t => t.technician?.toString() === technicianId
        );
        if (alreadyAssigned) {
            return res.status(400).json({ success: false, error: 'Technician already assigned to this cluster' });
        }

        cluster.assigned_technicians.push({
            technician: technicianId,
            assigned_date: new Date(),
            role: 'primary',
        });
        await cluster.save();

        const updated = await Cluster.findById(cluster._id)
            .populate('supervisor', 'fullName _id email')
            .populate('assigned_technicians.technician', 'fullName _id email');

        res.json({ success: true, data: updated });
    } catch (error) {
        console.error('assignTechnicianToCluster error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.removeTechnicianFromCluster = async (req, res) => {
    try {
        const { id, technicianId } = req.params;

        const cluster = await Cluster.findById(id);
        if (!cluster) return res.status(404).json({ success: false, error: 'Cluster not found' });

        const before = cluster.assigned_technicians.length;
        cluster.assigned_technicians = cluster.assigned_technicians.filter(
            t => t.technician?.toString() !== technicianId
        );

        if (cluster.assigned_technicians.length === before) {
            return res.status(404).json({ success: false, error: 'Technician not found in this cluster' });
        }

        await cluster.save();

        const updated = await Cluster.findById(cluster._id)
            .populate('supervisor', 'fullName _id email')
            .populate('assigned_technicians.technician', 'fullName _id email');

        res.json({ success: true, data: updated });
    } catch (error) {
        console.error('removeTechnicianFromCluster error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
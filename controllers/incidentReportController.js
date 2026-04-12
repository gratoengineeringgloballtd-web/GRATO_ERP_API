const mongoose = require('mongoose');
const IncidentReport = require('../models/IncidentReport');
const User = require('../models/User');
const { getApprovalChain } = require('../config/departmentStructure');
const { DEPARTMENT_STRUCTURE } = require('../config/departmentStructure');
const { sendIncidentReportEmail, sendEmail } = require('../services/emailService');
const fs = require('fs');
const path = require('path');



const generateReportNumber = async () => {
  let reportNumber;
  let attempts = 0;
  const maxAttempts = 10;
  
  while (attempts < maxAttempts) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    
    reportNumber = `INC${year}${month}${day}-${hours}${minutes}-${random}`;
    
    // Check uniqueness
    const existing = await IncidentReport.findOne({ reportNumber });
    if (!existing) {
      return reportNumber;
    }
    
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  throw new Error('Failed to generate unique report number');
}



// Create new incident report
const generateUniqueReportNumber = async () => {
  let reportNumber;
  let attempts = 0;
  const maxAttempts = 10;
  
  while (attempts < maxAttempts) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    
    reportNumber = `INC${year}${month}${day}-${hours}${minutes}-${random}`;
    
    // Check uniqueness
    const existing = await IncidentReport.findOne({ reportNumber });
    if (!existing) {
      return reportNumber;
    }
    
    attempts++;
    console.log(`Report number collision on attempt ${attempts}: ${reportNumber}`);
    
    // Small delay to avoid rapid collisions
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  throw new Error('Failed to generate unique report number after multiple attempts');
};

/**
 * Create Incident Report - Notification Only (No Approval Chain)
 * Notifications sent to: Supervisor, Dept Head, HSE, HR, Admin
 */
const createIncidentReport = async (req, res) => {
  try {
    console.log('=== CREATE INCIDENT REPORT (NOTIFICATION ONLY) ===');

    const {
      title,
      incidentType,
      severity,
      description,
      location,
      specificLocation,
      incidentDate,
      incidentTime,
      weatherConditions,
      lightingConditions,
      injuriesReported,
      peopleInvolved,
      witnesses,
      injuryDetails,
      equipmentDetails,
      environmentalDetails,
      immediateActions,
      emergencyServicesContacted,
      supervisorNotified,
      supervisorName,
      notificationTime,
      contributingFactors,
      rootCause,
      preventiveMeasures,
      additionalComments,
      followUpRequired,
      reporterPhone
    } = req.body;

    // Validation
    if (!description || description.length < 20) {
      return res.status(400).json({
        success: false,
        message: 'Incident description must be at least 20 characters long'
      });
    }

    // Get employee details
    const employee = await User.findById(req.user.userId);
    if (!employee) {
      return res.status(404).json({ 
        success: false, 
        message: 'Employee not found' 
      });
    }

    // Parse complex fields
    let parsedInjuryDetails = null;
    let parsedEquipmentDetails = null;
    let parsedEnvironmentalDetails = null;
    let parsedPeopleInvolved = [];
    let parsedWitnesses = [];

    try {
      if (injuryDetails) {
        parsedInjuryDetails = typeof injuryDetails === 'string' ? 
          JSON.parse(injuryDetails) : injuryDetails;
      }
      if (equipmentDetails) {
        parsedEquipmentDetails = typeof equipmentDetails === 'string' ? 
          JSON.parse(equipmentDetails) : equipmentDetails;
      }
      if (environmentalDetails) {
        parsedEnvironmentalDetails = typeof environmentalDetails === 'string' ? 
          JSON.parse(environmentalDetails) : environmentalDetails;
      }
      if (peopleInvolved) {
        parsedPeopleInvolved = typeof peopleInvolved === 'string' ? 
          peopleInvolved.split(',').map(p => p.trim()) : peopleInvolved;
      }
      if (witnesses) {
        parsedWitnesses = typeof witnesses === 'string' ? 
          witnesses.split(',').map(w => w.trim()) : witnesses;
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid format for complex fields'
      });
    }

    // Process attachments
    let attachments = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const fileName = `${Date.now()}-${file.originalname}`;
          const uploadDir = path.join(__dirname, '../uploads/incidents');
          const filePath = path.join(uploadDir, fileName);

          await fs.promises.mkdir(uploadDir, { recursive: true });

          if (file.path) {
            await fs.promises.rename(file.path, filePath);
          }

          attachments.push({
            name: file.originalname,
            url: `/uploads/incidents/${fileName}`,
            publicId: fileName,
            size: file.size,
            mimetype: file.mimetype
          });
        } catch (fileError) {
          console.error('Error processing file:', file.originalname, fileError);
        }
      }
    }

    // Create incident report - reportNumber will be auto-generated by pre-save hook
    const incidentReport = new IncidentReport({
      employee: req.user.userId,
      title,
      department: employee.department,
      incidentType,
      severity,
      description,
      location,
      specificLocation,
      incidentDate: new Date(incidentDate),
      incidentTime,
      reportedDate: new Date(),
      weatherConditions,
      lightingConditions,
      injuriesReported: injuriesReported === 'yes' || injuriesReported === true,
      peopleInvolved: parsedPeopleInvolved,
      witnesses: parsedWitnesses,
      injuryDetails: parsedInjuryDetails,
      equipmentDetails: parsedEquipmentDetails,
      environmentalDetails: parsedEnvironmentalDetails,
      immediateActions,
      emergencyServicesContacted: emergencyServicesContacted === 'yes' || emergencyServicesContacted === true,
      supervisorNotified: supervisorNotified === 'yes' || supervisorNotified === true,
      supervisorName,
      notificationTime,
      contributingFactors,
      rootCause,
      preventiveMeasures,
      additionalComments,
      followUpRequired: followUpRequired === true,
      attachments,
      status: 'submitted',
      reportedBy: {
        employeeId: employee.employeeId || employee._id,
        fullName: employee.fullName,
        department: employee.department,
        email: employee.email,
        phone: reporterPhone
      },
      hseManagement: {
        assignedTo: 'Mr. Ovo Becheni',
        assignedEmail: 'bechem.mbu@gratoglobal.com',
        investigationRequired: injuriesReported === 'yes' || severity === 'critical' || severity === 'high'
      },
      notificationsSent: {}
      // reportNumber will be auto-generated by pre-save hook
    });

    // Save - this triggers the pre-save hook which generates reportNumber
    await incidentReport.save();
    await incidentReport.populate('employee', 'fullName email department');

    console.log('✅ Incident report created:', incidentReport.reportNumber);

    // === SEND NOTIFICATIONS TO ALL STAKEHOLDERS ===
    const notifications = [];
    const notificationTracking = {};

    // Helper to find supervisor
    const findSupervisor = (empName, dept) => {
      const department = DEPARTMENT_STRUCTURE[dept];
      if (!department) return null;

      // Check if employee is department head
      if (department.head === empName) {
        // Department heads report to President
        const executive = DEPARTMENT_STRUCTURE['Executive'];
        return executive ? {
          name: executive.head,
          email: executive.headEmail,
          role: 'President'
        } : null;
      }

      // Find employee in positions
      if (department.positions) {
        for (const [pos, data] of Object.entries(department.positions)) {
          if (data.name === empName && data.supervisor) {
            // Check if supervisor is department head
            if (data.supervisor.includes('Head') || data.supervisor === department.head) {
              return {
                name: department.head,
                email: department.headEmail,
                role: 'Department Head'
              };
            }
            // Find supervisor in positions
            for (const [supPos, supData] of Object.entries(department.positions)) {
              if (supPos === data.supervisor || supData.name === data.supervisor) {
                return {
                  name: supData.name,
                  email: supData.email,
                  role: supPos
                };
              }
            }
          }
        }
      }

      // Default to department head
      return {
        name: department.head,
        email: department.headEmail,
        role: 'Department Head'
      };
    };

    // 1. NOTIFY SUPERVISOR
    const supervisor = findSupervisor(employee.fullName, employee.department);
    if (supervisor && supervisor.email) {
      console.log('Notifying supervisor:', supervisor.email);
      
      notifications.push(
        sendEmail({
          to: supervisor.email,
          subject: `🚨 New Incident Report - ${employee.fullName}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background-color: ${severity === 'critical' || injuriesReported ? '#f8d7da' : '#fff3cd'}; padding: 20px; border-radius: 8px; border-left: 4px solid ${severity === 'critical' ? '#dc3545' : '#ffc107'};">
                <h2 style="color: #333; margin-top: 0;">
                  ${injuriesReported ? '🚨' : '⚠️'} Incident Report Notification
                </h2>
                <p style="color: #666;">An incident has been reported by one of your team members.</p>
              </div>

              <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #ddd;">
                <h3 style="color: #333; margin-top: 0;">Incident Details</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Report Number:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${incidentReport.reportNumber}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employee.fullName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Department:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employee.department}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Incident Type:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${incidentType.replace('_', ' ').toUpperCase()}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Severity:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                      <span style="color: ${severity === 'critical' ? '#dc3545' : severity === 'high' ? '#fd7e14' : '#ffc107'}; font-weight: bold;">
                        ${severity.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Injuries:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                      <span style="color: ${injuriesReported ? '#dc3545' : '#28a745'}; font-weight: bold;">
                        ${injuriesReported ? '⚠️ YES' : 'No'}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Location:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${location} - ${specificLocation}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0;"><strong>Date/Time:</strong></td>
                    <td style="padding: 8px 0;">${new Date(incidentDate).toLocaleDateString()} at ${incidentTime}</td>
                  </tr>
                </table>
              </div>

              <div style="background-color: #e7f3ff; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; color: #333;">
                  <strong>Note:</strong> This incident is being managed by the HSE Coordinator (${incidentReport.hseManagement.assignedTo}). 
                  You are receiving this for awareness and may be contacted for additional information.
                </p>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/supervisor/incident-reports/${incidentReport._id}" 
                   style="display: inline-block; background-color: #2196F3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                  View Incident Report
                </a>
              </div>

              <p style="color: #888; font-size: 12px; text-align: center;">
                This is an automated notification from the Safety Management System.
              </p>
            </div>
          `
        }).then(result => {
          notificationTracking.supervisor = { sent: true, sentAt: new Date(), email: supervisor.email };
          return result;
        }).catch(error => {
          console.error('Supervisor notification failed:', error);
          notificationTracking.supervisor = { sent: false, sentAt: new Date(), email: supervisor.email };
          return { error, type: 'supervisor' };
        })
      );
    }

    // 2. NOTIFY DEPARTMENT HEAD (if different from supervisor)
    const deptHead = DEPARTMENT_STRUCTURE[employee.department];
    if (deptHead && deptHead.headEmail && deptHead.headEmail !== supervisor?.email) {
      console.log('Notifying department head:', deptHead.headEmail);
      
      notifications.push(
        sendEmail({
          to: deptHead.headEmail,
          subject: `📊 Incident Report Notification - ${employee.department}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background-color: #e3f2fd; padding: 20px; border-radius: 8px; border-left: 4px solid #2196F3;">
                <h2 style="color: #1976d2; margin-top: 0;">📊 Incident Report - ${employee.department}</h2>
                <p style="color: #666;">An incident has been reported in your department.</p>
              </div>

              <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #ddd;">
                <h3>Quick Summary</h3>
                <ul style="list-style: none; padding: 0;">
                  <li><strong>Report:</strong> ${incidentReport.reportNumber}</li>
                  <li><strong>Employee:</strong> ${employee.fullName}</li>
                  <li><strong>Type:</strong> ${incidentType}</li>
                  <li><strong>Severity:</strong> <span style="color: ${severity === 'critical' ? '#dc3545' : '#ffc107'};">${severity.toUpperCase()}</span></li>
                  <li><strong>Injuries:</strong> ${injuriesReported ? '⚠️ YES' : 'No'}</li>
                  <li><strong>HSE Coordinator:</strong> ${incidentReport.hseManagement.assignedTo}</li>
                </ul>
              </div>

              <p style="color: #666;">This incident is being handled by HSE. You may be contacted for additional information or follow-up actions.</p>

              <div style="text-align: center; margin: 20px 0;">
                <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/admin/incident-reports/${incidentReport._id}" 
                   style="display: inline-block; background-color: #2196F3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                  View Report
                </a>
              </div>
            </div>
          `
        }).then(result => {
          notificationTracking.departmentHead = { sent: true, sentAt: new Date(), email: deptHead.headEmail };
          return result;
        }).catch(error => {
          console.error('Department head notification failed:', error);
          notificationTracking.departmentHead = { sent: false, sentAt: new Date(), email: deptHead.headEmail };
          return { error, type: 'dept_head' };
        })
      );
    }

    // 3. NOTIFY HSE COORDINATOR (PRIMARY HANDLER)
    console.log('Notifying HSE Coordinator:', incidentReport.hseManagement.assignedEmail);
    
    notifications.push(
      sendEmail({
        to: incidentReport.hseManagement.assignedEmail,
        subject: `🚨 NEW INCIDENT REPORT - Action Required - ${incidentReport.reportNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: ${injuriesReported || severity === 'critical' ? '#f8d7da' : '#fff3cd'}; padding: 20px; border-radius: 8px; border-left: 4px solid ${injuriesReported || severity === 'critical' ? '#dc3545' : '#ffc107'};">
              <h2 style="color: ${injuriesReported || severity === 'critical' ? '#721c24' : '#856404'}; margin-top: 0;">
                🚨 NEW INCIDENT REPORT - ACTION REQUIRED
              </h2>
              <p style="color: #666; font-weight: bold;">You have been assigned as the HSE Coordinator for this incident.</p>
            </div>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 2px solid #ffc107;">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #ffc107; padding-bottom: 10px;">
                Incident Details
              </h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Report Number:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>${incidentReport.reportNumber}</strong></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employee.fullName} (${employee.department})</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Title:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Incident Type:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${incidentType.replace('_', ' ').toUpperCase()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Severity Level:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                    <span style="color: ${severity === 'critical' ? '#dc3545' : severity === 'high' ? '#fd7e14' : severity === 'medium' ? '#ffc107' : '#28a745'}; font-weight: bold; text-transform: uppercase;">
                      ${severity}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Injuries Reported:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                    <span style="color: ${injuriesReported ? '#dc3545' : '#28a745'}; font-weight: bold; font-size: 16px;">
                      ${injuriesReported ? '⚠️ YES - INJURIES REPORTED' : '✓ No injuries'}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Location:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${location} - ${specificLocation}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Date/Time:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${new Date(incidentDate).toLocaleDateString()} at ${incidentTime}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Immediate Actions Taken:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${immediateActions}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Investigation Required:</strong></td>
                  <td style="padding: 8px 0;">
                    <span style="color: ${incidentReport.hseManagement.investigationRequired ? '#dc3545' : '#28a745'}; font-weight: bold;">
                      ${incidentReport.hseManagement.investigationRequired ? 'YES - Investigation Recommended' : 'TBD'}
                    </span>
                  </td>
                </tr>
              </table>
            </div>

            <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
              <h4 style="margin: 0 0 10px 0; color: #856404;">📋 HSE Coordinator Responsibilities</h4>
              <ul style="margin: 0; padding-left: 20px; color: #856404;">
                <li>Review incident details and assess severity</li>
                <li>Determine if investigation is required</li>
                <li>Identify corrective and preventive actions</li>
                <li>Coordinate with relevant departments</li>
                <li>Document findings and recommendations</li>
                <li>Monitor action implementation</li>
                <li>Close incident when resolved</li>
              </ul>
            </div>

            ${description ? `
            <div style="background-color: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
              <h4 style="margin-top: 0; color: #333;">Incident Description:</h4>
              <p style="color: #555; line-height: 1.6; margin-bottom: 0;">${description}</p>
            </div>
            ` : ''}

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/hse/incident-reports/${incidentReport._id}" 
                 style="display: inline-block; background-color: ${injuriesReported || severity === 'critical' ? '#dc3545' : '#fd7e14'}; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                🚨 Review & Manage Incident
              </a>
            </div>

            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Safety Management System. Please take immediate action.
            </p>
          </div>
        `
      }).then(result => {
        notificationTracking.hse = { sent: true, sentAt: new Date(), email: incidentReport.hseManagement.assignedEmail };
        return result;
      }).catch(error => {
        console.error('HSE notification failed:', error);
        notificationTracking.hse = { sent: false, sentAt: new Date(), email: incidentReport.hseManagement.assignedEmail };
        return { error, type: 'hse' };
      })
    );

    // 4. NOTIFY HR TEAM
    const hrTeam = await User.find({ role: 'hr' }).select('email fullName');
    if (hrTeam.length > 0) {
      const hrEmails = hrTeam.map(h => h.email);
      console.log('Notifying HR team:', hrEmails);
      
      notifications.push(
        sendEmail({
          to: hrEmails,
          subject: `📊 Incident Report Notification - ${incidentReport.reportNumber}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background-color: #e8f5e9; padding: 20px; border-radius: 8px; border-left: 4px solid #4caf50;">
                <h2 style="color: #2e7d32; margin-top: 0;">📊 Incident Report - HR Notification</h2>
                <p style="color: #666;">An incident has been reported and is being managed by HSE.</p>
              </div>

              <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #ddd;">
                <h3 style="color: #333;">Incident Summary</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Report Number:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${incidentReport.reportNumber}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employee.fullName} (${employee.department})</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Type:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${incidentType.replace('_', ' ')}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Severity:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                      <span style="color: ${severity === 'critical' ? '#dc3545' : '#ffc107'}; font-weight: bold;">
                        ${severity.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Injuries:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${injuriesReported ? '⚠️ YES' : 'No'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0;"><strong>HSE Coordinator:</strong></td>
                    <td style="padding: 8px 0;">${incidentReport.hseManagement.assignedTo}</td>
                  </tr>
                </table>
              </div>

              <div style="background-color: #e3f2fd; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; color: #333;">
                  <strong>Note:</strong> This incident is being handled by HSE. HR may be contacted for employee-related matters, policy compliance, or if follow-up actions are needed.
                </p>
              </div>

              <div style="text-align: center; margin: 20px 0;">
                <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/hr/incident-reports/${incidentReport._id}" 
                   style="display: inline-block; background-color: #4caf50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                  View Report
                </a>
              </div>

              <p style="color: #888; font-size: 12px; text-align: center;">
                This is an automated notification from the Safety Management System.
              </p>
            </div>
          `
        }).then(result => {
          notificationTracking.hr = { sent: true, sentAt: new Date(), emails: hrEmails };
          return result;
        }).catch(error => {
          console.error('HR notification failed:', error);
          notificationTracking.hr = { sent: false, sentAt: new Date(), emails: hrEmails };
          return { error, type: 'hr' };
        })
      );
    }

    // 5. NOTIFY ADMIN TEAM
    const admins = await User.find({ role: 'admin' }).select('email fullName');
    if (admins.length > 0) {
      const adminEmails = admins.map(a => a.email);
      console.log('Notifying admins:', adminEmails);
      
      notifications.push(
        sendEmail({
          to: adminEmails,
          subject: `🔔 Incident Report Notification - ${incidentReport.reportNumber}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background-color: #f3e5f5; padding: 20px; border-radius: 8px; border-left: 4px solid #9c27b0;">
                <h2 style="color: #7b1fa2; margin-top: 0;">🔔 Incident Report - Admin Notification</h2>
                <p style="color: #666;">An incident has been reported in the system.</p>
              </div>

              <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #ddd;">
                <h3 style="color: #333;">Incident Overview</h3>
                <ul style="list-style: none; padding: 0;">
                  <li style="padding: 5px 0;"><strong>Report:</strong> ${incidentReport.reportNumber}</li>
                  <li style="padding: 5px 0;"><strong>Employee:</strong> ${employee.fullName} (${employee.department})</li>
                  <li style="padding: 5px 0;"><strong>Type:</strong> ${incidentType}</li>
                  <li style="padding: 5px 0;"><strong>Severity:</strong> <span style="color: ${severity === 'critical' ? '#dc3545' : '#ffc107'};">${severity.toUpperCase()}</span></li>
                  <li style="padding: 5px 0;"><strong>Injuries:</strong> ${injuriesReported ? '⚠️ YES' : 'No'}</li>
                  <li style="padding: 5px 0;"><strong>HSE Coordinator:</strong> ${incidentReport.hseManagement.assignedTo}</li>
                  <li style="padding: 5px 0;"><strong>Status:</strong> Submitted - Under HSE Review</li>
                </ul>
              </div>

              <div style="text-align: center; margin: 20px 0;">
                <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/admin/incident-reports" 
                   style="display: inline-block; background-color: #9c27b0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                  View All Incidents
                </a>
              </div>

              <p style="color: #888; font-size: 12px; text-align: center;">
                This is an automated notification from the Safety Management System.
              </p>
            </div>
          `
        }).then(result => {
          notificationTracking.admin = { sent: true, sentAt: new Date(), emails: adminEmails };
          return result;
        }).catch(error => {
          console.error('Admin notification failed:', error);
          notificationTracking.admin = { sent: false, sentAt: new Date(), emails: adminEmails };
          return { error, type: 'admin' };
        })
      );
    }

    // 6. NOTIFY EMPLOYEE (CONFIRMATION)
    console.log('Sending employee confirmation:', employee.email);
    
    notifications.push(
      sendEmail({
        to: employee.email,
        subject: `✅ Incident Report Submitted - ${incidentReport.reportNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
              <h2 style="color: #1890ff; margin-top: 0;">✅ Incident Report Submitted Successfully</h2>
              <p style="color: #666;">Your incident report has been submitted and assigned to HSE for review.</p>
            </div>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #ddd;">
              <h3 style="color: #333; margin-top: 0;">Your Report Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Report Number:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>${incidentReport.reportNumber}</strong></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Title:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                    <span style="background-color: #52c41a; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                      SUBMITTED
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Assigned To:</strong></td>
                  <td style="padding: 8px 0;">${incidentReport.hseManagement.assignedTo} (HSE Coordinator)</td>
                </tr>
              </table>
            </div>

            <div style="background-color: #f0f8ff; border-left: 4px solid #1890ff; padding: 15px; margin: 20px 0;">
              <h4 style="margin-top: 0; color: #1890ff;">📋 What Happens Next</h4>
              <ol style="margin: 0; padding-left: 20px; color: #333;">
                <li style="margin-bottom: 8px;">HSE Coordinator will review your report</li>
                <li style="margin-bottom: 8px;">Investigation may be initiated if required</li>
                <li style="margin-bottom: 8px;">You may be contacted for additional information</li>
                <li style="margin-bottom: 8px;">Corrective/preventive actions will be identified</li>
                <li>You'll be notified of the resolution</li>
              </ol>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/employee/incident-reports" 
                 style="display: inline-block; background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                Track Your Reports
              </a>
            </div>

            <div style="border-top: 1px solid #e8e8e8; padding-top: 20px; color: #666; font-size: 14px;">
              <p style="margin: 0;">Thank you for reporting this incident. Your contribution helps us maintain a safe workplace!</p>
            </div>

            <p style="color: #888; font-size: 12px; text-align: center; margin-top: 20px;">
              This is an automated confirmation from the Safety Management System.
            </p>
          </div>
        `
      }).catch(error => {
        console.error('Employee confirmation failed:', error);
        return { error, type: 'employee' };
      })
    );

    // Wait for all notifications
    console.log('Waiting for notifications to complete...');
    const notificationResults = await Promise.allSettled(notifications);

    // Log results
    notificationResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Notification ${index} failed:`, result.reason);
      } else if (result.value && result.value.error) {
        console.error(`${result.value.type} notification failed:`, result.value.error);
      } else {
        console.log(`Notification ${index} sent successfully`);
      }
    });

    // Update notification tracking in database
    incidentReport.notificationsSent = notificationTracking;
    await incidentReport.save();

    const notificationStats = {
      sent: notificationResults.filter(r => r.status === 'fulfilled' && !r.value?.error).length,
      failed: notificationResults.filter(r => r.status === 'rejected' || r.value?.error).length,
      details: notificationTracking
    };

    console.log('=== INCIDENT REPORT CREATED (NOTIFICATION ONLY) ===');
    console.log('Notification stats:', notificationStats);

    res.status(201).json({
      success: true,
      message: 'Incident report submitted successfully. All stakeholders have been notified.',
      data: incidentReport,
      notifications: notificationStats
    });

  } catch (error) {
    console.error('Create incident report error:', error);

    // Clean up uploaded files if request failed
    if (req.files && req.files.length > 0) {
      await Promise.allSettled(
        req.files.map(file => {
          if (file.path) {
            return fs.promises.unlink(file.path).catch(e => console.error('File cleanup failed:', e));
          }
        })
      );
    }

    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create incident report',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Get supervisor incident reports
const getSupervisorIncidentReports = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Find reports where current user is in the approval chain and status is pending
    const reports = await IncidentReport.find({
      'approvalChain': {
        $elemMatch: {
          'approver.email': user.email,
          'status': 'pending'
        }
      },
      status: { $in: ['pending_supervisor'] }
    })
    .populate('employee', 'fullName email department')
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: reports,
      count: reports.length
    });

  } catch (error) {
    console.error('Get supervisor incident reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch incident reports',
      error: error.message
    });
  }
};

// Process supervisor decision
const processSupervisorDecision = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { decision, comments, actionsTaken, followUpRequired, followUpDate, escalationReason } = req.body;

    console.log('=== SUPERVISOR DECISION PROCESSING ===');
    console.log('Report ID:', reportId);
    console.log('Decision:', decision);

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const report = await IncidentReport.findById(reportId)
      .populate('employee', 'fullName email department');

    if (!report) {
      return res.status(404).json({ 
        success: false, 
        message: 'Incident report not found' 
      });
    }

    // Find current user's step in approval chain
    const currentStepIndex = report.approvalChain.findIndex(
      step => step.approver.email === user.email && step.status === 'pending'
    );

    if (currentStepIndex === -1) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to review this report or it has already been processed'
      });
    }

    // Update the approval step
    report.approvalChain[currentStepIndex].status = decision;
    report.approvalChain[currentStepIndex].comments = comments;
    report.approvalChain[currentStepIndex].actionDate = new Date();
    report.approvalChain[currentStepIndex].actionTime = new Date().toLocaleTimeString('en-GB');
    report.approvalChain[currentStepIndex].decidedBy = req.user.userId;

    // Update supervisor review
    report.supervisorReview = {
      decision,
      comments,
      actionsTaken,
      decisionDate: new Date(),
      decidedBy: req.user.userId,
      followUpRequired: followUpRequired === true,
      followUpDate: followUpDate ? new Date(followUpDate) : undefined,
      escalationReason
    };

    // Update overall report status based on decision
    if (decision === 'rejected') {
      report.status = 'rejected';
    } else if (decision === 'approved') {
      // Move to HR review
      report.status = 'pending_hr_review';
    } else if (decision === 'escalated') {
      report.status = 'pending_hr_review';
    }

    await report.save();

    // Send notifications based on decision
    const notifications = [];

    if (decision === 'approved' || decision === 'escalated') {
      // Notify HR team
      const hrTeam = await User.find({ role: 'hr' }).select('email fullName');

      if (hrTeam.length > 0) {
        notifications.push(
          sendIncidentReportEmail.supervisorDecisionToHR(
            hrTeam.map(h => h.email),
            report.employee.fullName,
            report.incidentType,
            report.severity,
            report._id,
            user.fullName,
            decision,
            comments
          ).catch(error => {
            console.error('Failed to send HR notification:', error);
            return { error, type: 'hr' };
          })
        );
      }

      // Notify employee of progress
      notifications.push(
        sendIncidentReportEmail.statusUpdateToEmployee(
          report.employee.email,
          report.reportNumber,
          decision === 'escalated' ? 'escalated' : 'approved',
          user.fullName,
          comments
        ).catch(error => {
          console.error('Failed to send employee notification:', error);
            return { error, type: 'employee' };
        })
      );

    } else {
      // Report was rejected - notify employee
      notifications.push(
        sendIncidentReportEmail.statusUpdateToEmployee(
          report.employee.email,
          report.reportNumber,
          'rejected',
          user.fullName,
          comments || 'Incident report rejected during supervisor review'
        ).catch(error => {
          console.error('Failed to send employee rejection notification:', error);
          return { error, type: 'employee' };
        })
      );
    }

    // Wait for all notifications
    const notificationResults = await Promise.allSettled(notifications);
    notificationResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Notification ${index} failed:`, result.reason);
      } else if (result.value && result.value.error) {
        console.error(`${result.value.type} notification failed:`, result.value.error);
      } else {
        console.log(`Notification ${index} sent successfully`);
      }
    });

    console.log('=== SUPERVISOR DECISION PROCESSED ===');
    res.json({
      success: true,
      message: `Incident report ${decision} successfully`,
      data: report,
      notifications: {
        sent: notificationResults.filter(r => r.status === 'fulfilled').length,
        failed: notificationResults.filter(r => r.status === 'rejected').length
      }
    });

  } catch (error) {
    console.error('Process supervisor decision error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process decision',
      error: error.message
    });
  }
};

// Get HR incident reports
const getHRIncidentReports = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    let query = {};

    if (user.role === 'hr') {
      // HR users see reports assigned to them or pending HR review
      query = {
        $or: [
          { status: 'pending_hr_review' },
          { status: 'under_investigation' },
          { status: 'investigation_complete' },
          { status: 'resolved' },
          { 'hrReview.assignedOfficer': user.fullName }
        ]
      };
    } else if (user.role === 'admin') {
      // Admins see all HR-related reports
      query = {
        status: { $in: ['pending_hr_review', 'under_investigation', 'investigation_complete', 'resolved', 'rejected'] }
      };
    }

    const reports = await IncidentReport.find(query)
      .populate('employee', 'fullName email department')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: reports,
      count: reports.length
    });

  } catch (error) {
    console.error('Get HR incident reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch HR incident reports',
      error: error.message
    });
  }
};

// Process HR decision
const processHRDecision = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { decision, comments, investigationRequired, investigationDetails, assignedOfficer } = req.body;

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const report = await IncidentReport.findById(reportId)
      .populate('employee', 'fullName email department');

    if (!report) {
      return res.status(404).json({ 
        success: false, 
        message: 'Incident report not found' 
      });
    }

    // Update HR review
    report.hrReview = {
      decision,
      comments,
      decisionDate: new Date(),
      decidedBy: req.user.userId,
      investigationRequired: investigationRequired === true,
      investigationDetails,
      assignedOfficer
    };

    // Update overall report status based on decision
    if (decision === 'rejected') {
      report.status = 'rejected';
    } else if (decision === 'approved') {
      if (investigationRequired) {
        report.status = 'under_investigation';
        report.investigation = {
          required: true,
          status: 'pending',
          assignedDate: new Date(),
          assignedBy: req.user.userId,
          investigator: assignedOfficer ? await User.findOne({ fullName: assignedOfficer }) : null
        };
      } else {
        report.status = 'resolved';
        report.resolutionDate = new Date();
      }
    }

    await report.save();

    // Send notifications
    const notifications = [];

    // Notify employee of decision
    notifications.push(
      sendIncidentReportEmail.statusUpdateToEmployee(
        report.employee.email,
        report.reportNumber,
        decision,
        user.fullName,
        comments
      ).catch(error => {
        console.error('Failed to send employee notification:', error);
        return { error, type: 'employee' };
      })
    );

    // If investigation is required, notify assigned officer
    if (investigationRequired && assignedOfficer) {
      const investigator = await User.findOne({ fullName: assignedOfficer });
      if (investigator && investigator.email) {
        notifications.push(
          sendIncidentReportEmail.investigationAssigned(
            investigator.email,
            report.reportNumber,
            report.employee.fullName,
            report.incidentType,
            report._id
          ).catch(error => {
            console.error('Failed to send investigator notification:', error);
            return { error, type: 'investigator' };
          })
        );
      }
    }

    // Wait for all notifications
    const notificationResults = await Promise.allSettled(notifications);

    res.json({
      success: true,
      message: `HR decision processed successfully`,
      data: report,
      notifications: {
        sent: notificationResults.filter(r => r.status === 'fulfilled').length,
        failed: notificationResults.filter(r => r.status === 'rejected').length
      }
    });

  } catch (error) {
    console.error('Process HR decision error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process HR decision',
      error: error.message
    });
  }
};

// Update investigation status
const updateInvestigationStatus = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { status, findings, recommendations, completionDate } = req.body;

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const report = await IncidentReport.findById(reportId);
    if (!report) {
      return res.status(404).json({ 
        success: false, 
        message: 'Incident report not found' 
      });
    }

    // Check if user is authorized to update investigation
    if (!['hr', 'admin'].includes(user.role) && 
        (!report.investigation || report.investigation.investigator?.toString() !== req.user.userId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Update investigation
    report.investigation.status = status;
    report.investigation.findings = findings;
    report.investigation.recommendations = recommendations;
    
    if (status === 'completed') {
      report.investigation.completionDate = completionDate ? new Date(completionDate) : new Date();
      report.status = 'investigation_complete';
    }

    await report.save();

    res.json({
      success: true,
      message: 'Investigation status updated successfully',
      data: report
    });

  } catch (error) {
    console.error('Update investigation status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update investigation status',
      error: error.message
    });
  }
};

// Get all incident reports (admin only)
const getAllIncidentReports = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!['admin'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { page = 1, limit = 10, status, department, incidentType } = req.query;
    
    let query = {};
    
    if (status) query.status = status;
    if (department) query.department = department;
    if (incidentType) query.incidentType = incidentType;

    const reports = await IncidentReport.find(query)
      .populate('employee', 'fullName email department')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await IncidentReport.countDocuments(query);

    res.json({
      success: true,
      data: reports,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Get all incident reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch incident reports',
      error: error.message
    });
  }
};

// Get approval chain preview
const getApprovalChainPreview = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const approvalChain = getApprovalChain(user.fullName, user.department);

    res.json({
      success: true,
      data: approvalChain
    });

  } catch (error) {
    console.error('Get approval chain preview error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch approval chain preview',
      error: error.message
    });
  }
};

// // Get incident reports by role
// const getIncidentReportsByRole = async (req, res) => {
//   try {
//     const user = await User.findById(req.user.userId);
//     let query = {};

//     switch (user.role) {
//       case 'employee':
//         query = { employee: req.user.userId };
//         break;
//       case 'supervisor':
//         query = {
//           'approvalChain.approver.email': user.email,
//           status: { $in: ['pending_supervisor'] }
//         };
//         break;
//       case 'hr':
//         query = {
//           status: { $in: ['pending_hr_review', 'under_investigation', 'investigation_complete'] }
//         };
//         break;
//       case 'admin':
//         // Admins can see all reports
//         break;
//       default:
//         return res.status(403).json({
//           success: false,
//           message: 'Access denied'
//         });
//     }

//     const reports = await IncidentReport.find(query)
//       .populate('employee', 'fullName email department')
//       .sort({ createdAt: -1 });

//     res.json({
//       success: true,
//       data: reports,
//       count: reports.length
//     });

//   } catch (error) {
//     console.error('Get incident reports by role error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch incident reports',
//       error: error.message
//     });
//   }
// };

// Get dashboard statistics
const getDashboardStats = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    let query = {};
    
    // Filter by role
    if (user.role === 'employee') {
      query.employee = req.user.userId;
    } else if (user.role === 'supervisor') {
      query['approvalChain.approver.email'] = user.email;
    }

    const [
      totalReports,
      pendingReports,
      resolvedReports,
      criticalIncidents
    ] = await Promise.all([
      IncidentReport.countDocuments(query),
      IncidentReport.countDocuments({ ...query, status: { $in: ['pending_supervisor', 'pending_hr_review'] } }),
      IncidentReport.countDocuments({ ...query, status: 'resolved' }),
      IncidentReport.countDocuments({ ...query, severity: 'critical' })
    ]);

    res.json({
      success: true,
      data: {
        totalReports,
        pendingReports,
        resolvedReports,
        criticalIncidents
      }
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics',
      error: error.message
    });
  }
};

// Get incident report statistics
const getIncidentReportStats = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    if (!['hr', 'admin'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const stats = await IncidentReport.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          byStatus: { 
            $push: {
              status: '$status',
              count: 1
            }
          },
          byType: {
            $push: {
              type: '$incidentType',
              count: 1
            }
          },
          bySeverity: {
            $push: {
              severity: '$severity',
              count: 1
            }
          },
          byDepartment: {
            $push: {
              department: '$department',
              count: 1
            }
          }
        }
      },
      {
        $project: {
          total: 1,
          byStatus: {
            $arrayToObject: {
              $map: {
                input: "$byStatus",
                as: "s",
                in: { k: "$$s.status", v: { $sum: "$$s.count" } }
              }
            }
          },
          byType: {
            $arrayToObject: {
              $map: {
                input: "$byType",
                as: "t",
                in: { k: "$$t.type", v: { $sum: "$$t.count" } }
              }
            }
          },
          bySeverity: {
            $arrayToObject: {
              $map: {
                input: "$bySeverity",
                as: "sv",
                in: { k: "$$sv.severity", v: { $sum: "$$sv.count" } }
              }
            }
          },
          byDepartment: {
            $arrayToObject: {
              $map: {
                input: "$byDepartment",
                as: "d",
                in: { k: "$$d.department", v: { $sum: "$$d.count" } }
              }
            }
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: stats[0] || {
        total: 0,
        byStatus: {},
        byType: {},
        bySeverity: {},
        byDepartment: {}
      }
    });

  } catch (error) {
    console.error('Get incident report stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch incident report statistics',
      error: error.message
    });
  }
};

// Additional helper functions for specific incident types
const getIncidentTypePriority = (incidentType, severity, hasInjuries) => {
  // Priority scoring for incident routing
  let priority = 0;

  // Base severity scores
  const severityScores = {
    'critical': 4,
    'high': 3,
    'medium': 2,
    'low': 1
  };

  // Type multipliers
  const typeMultipliers = {
    'injury': 2.0,
    'fire': 1.8,
    'environmental': 1.6,
    'security': 1.4,
    'equipment': 1.2,
    'near_miss': 1.0,
    'other': 0.8
  };

  priority = (severityScores[severity] || 1) * (typeMultipliers[incidentType] || 1);

  if (hasInjuries) {
    priority *= 1.5;
  }

  return Math.round(priority * 10) / 10;
};

// Get incident reports requiring immediate attention
const getUrgentIncidentReports = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    // Only HR, Admins, and Supervisors can view urgent reports
    if (!['hr', 'admin', 'supervisor'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    let query = {
      $or: [
        { severity: { $in: ['critical', 'high'] } },
        { injuriesReported: true },
        { incidentType: 'fire' },
        { incidentType: 'environmental' },
        { 
          createdAt: { 
            $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          },
          status: { $in: ['pending_supervisor', 'pending_hr_review'] }
        }
      ]
    };

    // Filter based on role
    if (user.role === 'supervisor') {
      query['approvalChain.approver.email'] = user.email;
      query['approvalChain.status'] = 'pending';
    } else if (user.role === 'hr') {
      query.status = { $in: ['pending_hr_review', 'under_investigation'] };
    }

    const urgentReports = await IncidentReport.find(query)
      .populate('employee', 'fullName email department')
      .sort({ 
        severity: { critical: 4, high: 3, medium: 2, low: 1 },
        createdAt: -1 
      })
      .limit(20);

    // Add priority scores
    const reportsWithPriority = urgentReports.map(report => ({
      ...report.toObject(),
      priorityScore: getIncidentTypePriority(
        report.incidentType,
        report.severity,
        report.injuresReported
      )
    }));

    res.json({
      success: true,
      data: reportsWithPriority,
      count: reportsWithPriority.length
    });

  } catch (error) {
    console.error('Get urgent incident reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch urgent incident reports',
      error: error.message
    });
  }
};

// Get incident reports analytics for specific periods
const getIncidentAnalytics = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    // Only HR and Admins can view detailed analytics
    if (!['hr', 'admin'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { period = 'monthly' } = req.query;
    
    // Calculate date range based on period
    let startDate = new Date();
    switch (period) {
      case 'weekly':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'monthly':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarterly':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'yearly':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setMonth(startDate.getMonth() - 1);
    }

    const [
      typeAnalytics,
      severityAnalytics,
      departmentAnalytics,
      trendAnalytics,
      complianceMetrics
    ] = await Promise.all([
      // Type analytics
      IncidentReport.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: '$incidentType',
            count: { $sum: 1 },
            injuryCount: { $sum: { $cond: ['$injuriesReported', 1, 0] } },
            resolvedCount: { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } },
            avgResolutionTime: { $avg: '$resolutionTime' }
          }
        }
      ]),

      // Severity analytics
      IncidentReport.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: '$severity',
            count: { $sum: 1 },
            injuryRate: { $avg: { $cond: ['$injuriesReported', 1, 0] } }
          }
        }
      ]),

      // Department analytics
      IncidentReport.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: '$department',
            count: { $sum: 1 },
            criticalCount: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } },
            injuryCount: { $sum: { $cond: ['$injuriesReported', 1, 0] } }
          }
        },
        { $sort: { count: -1 } }
      ]),

      // Trend analytics (daily for the period)
      IncidentReport.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            },
            count: { $sum: 1 },
            criticalCount: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } },
            injuryCount: { $sum: { $cond: ['$injuriesReported', 1, 0] } }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
      ]),

      // Compliance metrics
      IncidentReport.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: null,
            totalReports: { $sum: 1 },
            reportedWithin24h: {
              $sum: {
                $cond: [
                  { $lte: [{ $subtract: ['$reportedDate', '$incidentDate'] }, 24 * 60 * 60 * 1000] },
                  1,
                  0
                ]
              }
            },
            supervisorNotifiedCount: { $sum: { $cond: ['$supervisorNotified', 1, 0] } },
            emergencyServicesCount: { $sum: { $cond: ['$emergencyServicesContacted', 1, 0] } },
            investigationRequiredCount: { $sum: { $cond: ['$investigation.required', 1, 0] } },
            investigationCompletedCount: {
              $sum: {
                $cond: [{ $eq: ['$investigation.status', 'completed'] }, 1, 0]
              }
            }
          }
        }
      ])
    ]);

    // Calculate compliance rates
    const compliance = complianceMetrics[0] || {};
    const complianceRates = {
      timelyReporting: compliance.totalReports > 0 ? 
        Math.round((compliance.reportedWithin24h / compliance.totalReports) * 100) : 0,
      supervisorNotification: compliance.totalReports > 0 ? 
        Math.round((compliance.supervisorNotifiedCount / compliance.totalReports) * 100) : 0,
      investigationCompletion: compliance.investigationRequiredCount > 0 ? 
        Math.round((compliance.investigationCompletedCount / compliance.investigationRequiredCount) * 100) : 0
    };

    res.json({
      success: true,
      data: {
        period,
        analytics: {
          byType: typeAnalytics,
          bySeverity: severityAnalytics,
          byDepartment: departmentAnalytics,
          trends: trendAnalytics,
          compliance: {
            ...compliance,
            rates: complianceRates
          }
        }
      }
    });

  } catch (error) {
    console.error('Get incident analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch incident analytics',
      error: error.message
    });
  }
};

// Update incident report (for drafts or pending reports)
const updateIncidentReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    const updateData = req.body;

    const report = await IncidentReport.findById(reportId);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Incident report not found'
      });
    }

    // Check if user can update this report
    if (!report.employee.equals(req.user.userId) && !['admin'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Only allow updates for pending supervisor reports
    if (!['pending_supervisor'].includes(report.status)) {
      return res.status(400).json({
        success: false,
        message: 'Can only update reports pending supervisor review'
      });
    }

    // Update allowed fields
    const allowedFields = [
      'title', 'incidentType', 'severity', 'description', 'location',
      'specificLocation', 'incidentDate', 'incidentTime', 'weatherConditions',
      'lightingConditions', 'injuriesReported', 'peopleInvolved', 'witnesses',
      'injuryDetails', 'equipmentDetails', 'environmentalDetails',
      'immediateActions', 'emergencyServicesContacted', 'supervisorNotified',
      'supervisorName', 'notificationTime', 'contributingFactors',
      'rootCause', 'preventiveMeasures', 'additionalComments',
      'followUpRequired'
    ];

    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        if (field === 'injuriesReported' || field === 'emergencyServicesContacted' || 
            field === 'supervisorNotified' || field === 'followUpRequired') {
          report[field] = updateData[field] === 'yes' || updateData[field] === true;
        } else if (field === 'incidentDate' && updateData[field]) {
          report[field] = new Date(updateData[field]);
        } else if (['injuryDetails', 'equipmentDetails', 'environmentalDetails'].includes(field)) {
          try {
            report[field] = typeof updateData[field] === 'string' ? 
              JSON.parse(updateData[field]) : updateData[field];
          } catch (error) {
            // Keep existing data if parsing fails
          }
        } else if (['peopleInvolved', 'witnesses'].includes(field)) {
          report[field] = typeof updateData[field] === 'string' ? 
            updateData[field].split(',').map(p => p.trim()) : updateData[field];
        } else {
          report[field] = updateData[field];
        }
      }
    });

    await report.save();
    await report.populate('employee', 'fullName email department');

    res.json({
      success: true,
      message: 'Incident report updated successfully',
      data: report
    });

  } catch (error) {
    console.error('Update incident report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update incident report',
      error: error.message
    });
  }
};

// Delete incident report (only for pending supervisor status)
const deleteIncidentReport = async (req, res) => {
  try {
    const { reportId } = req.params;

    const report = await IncidentReport.findById(reportId);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Incident report not found'
      });
    }

    // Check permissions
    if (!report.employee.equals(req.user.userId) && !['admin'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Only allow deletion of pending supervisor reports
    if (report.status !== 'pending_supervisor') {
      return res.status(400).json({
        success: false,
        message: 'Can only delete reports pending supervisor review'
      });
    }

    // Clean up attachments if any
    if (report.attachments && report.attachments.length > 0) {
      await Promise.allSettled(
        report.attachments.map(attachment => {
          const filePath = path.join(__dirname, '../uploads/incidents', attachment.publicId);
          return fs.promises.unlink(filePath).catch(e => console.error('File cleanup failed:', e));
        })
      );
    }

    await IncidentReport.findByIdAndDelete(reportId);

    res.json({
      success: true,
      message: 'Incident report deleted successfully'
    });

  } catch (error) {
    console.error('Delete incident report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete incident report',
      error: error.message
    });
  }
};

// Add follow-up action to incident report
const addFollowUpAction = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { action, assignedTo, dueDate, notes } = req.body;

    const user = await User.findById(req.user.userId);
    const report = await IncidentReport.findById(reportId);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Incident report not found'
      });
    }

    // Check permissions - only HR and Admin can add follow-up actions
    if (!['hr', 'admin'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Add new follow-up action
    const newAction = {
      action,
      assignedTo,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      status: 'pending',
      notes
    };

    if (!report.followUpActions) {
      report.followUpActions = [];
    }

    report.followUpActions.push(newAction);
    await report.save();

    // Send notification to assigned person if email available
    const assignedUser = await User.findOne({ fullName: assignedTo });
    if (assignedUser) {
      await sendEmail({
        to: assignedUser.email,
        subject: `Follow-up Action Assigned - ${report.reportNumber}`,
        html: `
          <h3>Follow-up Action Assignment</h3>
          <p>You have been assigned a follow-up action for incident report ${report.reportNumber}.</p>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p><strong>Action:</strong> ${action}</p>
            ${dueDate ? `<p><strong>Due Date:</strong> ${new Date(dueDate).toLocaleDateString()}</p>` : ''}
            ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
          </div>
          
          <p>Please complete this action and update the status in the system.</p>
        `
      }).catch(console.error);
    }

    res.json({
      success: true,
      message: 'Follow-up action added successfully',
      data: report
    });

  } catch (error) {
    console.error('Add follow-up action error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add follow-up action',
      error: error.message
    });
  }
};

// Update follow-up action status
const updateFollowUpAction = async (req, res) => {
  try {
    const { reportId, actionId } = req.params;
    const { status, notes } = req.body;

    const user = await User.findById(req.user.userId);
    const report = await IncidentReport.findById(reportId);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Incident report not found'
      });
    }

    const actionIndex = report.followUpActions.findIndex(
      action => action._id.toString() === actionId
    );

    if (actionIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Follow-up action not found'
      });
    }

    const action = report.followUpActions[actionIndex];

    // Check if user can update this action
    const canUpdate = 
      ['hr', 'admin'].includes(user.role) ||
      action.assignedTo === user.fullName;

    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Update action
    report.followUpActions[actionIndex].status = status;
    report.followUpActions[actionIndex].notes = notes;

    if (status === 'completed') {
      report.followUpActions[actionIndex].completedBy = req.user.userId;
      report.followUpActions[actionIndex].completedDate = new Date();
    }

    await report.save();

    res.json({
      success: true,
      message: 'Follow-up action updated successfully',
      data: report
    });

  } catch (error) {
    console.error('Update follow-up action error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update follow-up action',
      error: error.message
    });
  }
};


// Get all incidents assigned to HSE (for HSE Coordinator view)
const getHSEIncidentReports = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    if (user.role !== 'hse' && user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. HSE role required.'
      });
    }

    const { 
      status, 
      severity, 
      department, 
      incidentType,
      startDate, 
      endDate, 
      page = 1, 
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    let filter = {};

    if (status && status !== 'all') {
      filter.status = status;
    }
    if (severity && severity !== 'all') {
      filter.severity = severity;
    }
    if (department && department !== 'all') {
      filter.department = department;
    }
    if (incidentType && incidentType !== 'all') {
      filter.incidentType = incidentType;
    }
    if (startDate || endDate) {
      filter.incidentDate = {};
      if (startDate) filter.incidentDate.$gte = new Date(startDate);
      if (endDate) filter.incidentDate.$lte = new Date(endDate);
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const reports = await IncidentReport.find(filter)
      .populate('employee', 'fullName email department')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await IncidentReport.countDocuments(filter);

    // Get statistics
    const stats = await IncidentReport.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          submitted: { $sum: { $cond: [{ $eq: ['$status', 'submitted'] }, 1, 0] } },
          underReview: { $sum: { $cond: [{ $eq: ['$status', 'under_review'] }, 1, 0] } },
          underInvestigation: { $sum: { $cond: [{ $eq: ['$status', 'under_investigation'] }, 1, 0] } },
          actionRequired: { $sum: { $cond: [{ $eq: ['$status', 'action_required'] }, 1, 0] } },
          resolved: { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } },
          withInjuries: { $sum: { $cond: ['$injuriesReported', 1, 0] } },
          critical: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } }
        }
      }
    ]);

    res.json({
      success: true,
      data: reports,
      stats: stats[0] || {
        total: 0,
        submitted: 0,
        underReview: 0,
        underInvestigation: 0,
        actionRequired: 0,
        resolved: 0,
        withInjuries: 0,
        critical: 0
      },
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: reports.length,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('❌ Get HSE incident reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch incident reports',
      error: error.message
    });
  }
};

// Update incident status (HSE only)
const updateIncidentStatus = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { status, reviewNotes } = req.body;

    const user = await User.findById(req.user.userId);
    
    if (user.role !== 'hse' && user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const report = await IncidentReport.findById(reportId)
      .populate('employee', 'fullName email department');

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Incident report not found'
      });
    }

    // Update status
    report.status = status;
    
    if (!report.hseManagement.reviewStartDate && status === 'under_review') {
      report.hseManagement.reviewStartDate = new Date();
    }
    
    if (reviewNotes) {
      report.hseManagement.reviewNotes = reviewNotes;
      
      // Add to updates history
      if (!report.hseManagement.updates) {
        report.hseManagement.updates = [];
      }
      report.hseManagement.updates.push({
        date: new Date(),
        comment: reviewNotes,
        updatedBy: user.fullName
      });
    }

    await report.save();

    // Send notification to employee
    await sendIncidentReportEmail.hseStatusUpdate(
      report.employee.email,
      report.reportNumber,
      status,
      reviewNotes || `Your incident report status has been updated to ${status.replace('_', ' ')}`,
      user.fullName
    ).catch(console.error);

    res.json({
      success: true,
      message: 'Incident status updated successfully',
      data: report
    });

  } catch (error) {
    console.error('Update incident status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update incident status',
      error: error.message
    });
  }
};

// Start investigation (HSE only)
const startInvestigation = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { investigationDetails, estimatedDuration } = req.body;

    const user = await User.findById(req.user.userId);
    
    if (user.role !== 'hse' && user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const report = await IncidentReport.findById(reportId)
      .populate('employee', 'fullName email department');

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Incident report not found'
      });
    }

    // Update investigation details
    report.status = 'under_investigation';
    report.hseManagement.investigationRequired = true;
    report.hseManagement.investigationStartDate = new Date();
    
    if (!report.hseManagement.updates) {
      report.hseManagement.updates = [];
    }
    report.hseManagement.updates.push({
      date: new Date(),
      comment: `Investigation started: ${investigationDetails || 'Formal investigation initiated'}`,
      updatedBy: user.fullName
    });

    await report.save();

    // Notify employee
    await sendIncidentReportEmail.investigationStarted(
      report.employee.email,
      report.reportNumber,
      report.incidentType,
      user.fullName,
      estimatedDuration
    ).catch(console.error);

    res.json({
      success: true,
      message: 'Investigation started successfully',
      data: report
    });

  } catch (error) {
    console.error('Start investigation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start investigation',
      error: error.message
    });
  }
};

// Complete investigation (HSE only)
const completeInvestigation = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { findings, recommendations, notifyStakeholders } = req.body;

    const user = await User.findById(req.user.userId);
    
    if (user.role !== 'hse' && user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const report = await IncidentReport.findById(reportId)
      .populate('employee', 'fullName email department');

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Incident report not found'
      });
    }

    // Update investigation completion
    report.hseManagement.investigationFindings = findings;
    report.hseManagement.investigationRecommendations = recommendations;
    report.hseManagement.investigationCompletedDate = new Date();
    report.status = 'action_required'; // Move to action required status
    
    if (!report.hseManagement.updates) {
      report.hseManagement.updates = [];
    }
    report.hseManagement.updates.push({
      date: new Date(),
      comment: 'Investigation completed. Findings and recommendations documented.',
      updatedBy: user.fullName
    });

    await report.save();

    // Notify stakeholders if requested
    if (notifyStakeholders) {
      const notifyList = [report.employee.email];
      
      // Add supervisor
      const supervisor = findSupervisor(report.employee.fullName, report.department);
      if (supervisor?.email) notifyList.push(supervisor.email);
      
      // Add department head
      const deptHead = DEPARTMENT_STRUCTURE[report.department];
      if (deptHead?.headEmail) notifyList.push(deptHead.headEmail);
      
      await sendIncidentReportEmail.investigationComplete(
        [...new Set(notifyList)], // Remove duplicates
        report.reportNumber,
        findings,
        recommendations,
        user.fullName
      ).catch(console.error);
    }

    res.json({
      success: true,
      message: 'Investigation completed successfully',
      data: report
    });

  } catch (error) {
    console.error('Complete investigation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete investigation',
      error: error.message
    });
  }
};

// Add corrective action (HSE only)
const addCorrectiveAction = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { action, assignedTo, dueDate, notes } = req.body;

    const user = await User.findById(req.user.userId);
    
    if (user.role !== 'hse' && user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const report = await IncidentReport.findById(reportId)
      .populate('employee', 'fullName email department');

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Incident report not found'
      });
    }

    // Add corrective action
    if (!report.hseManagement.correctiveActions) {
      report.hseManagement.correctiveActions = [];
    }
    
    report.hseManagement.correctiveActions.push({
      action,
      assignedTo,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      status: 'pending',
      notes
    });

    await report.save();

    // Notify assigned person
    const assignee = await User.findOne({ fullName: assignedTo });
    if (assignee) {
      await sendIncidentReportEmail.correctiveActionAssigned(
        assignee.email,
        report.reportNumber,
        action,
        dueDate,
        report.description
      ).catch(console.error);
    }

    res.json({
      success: true,
      message: 'Corrective action added successfully',
      data: report
    });

  } catch (error) {
    console.error('Add corrective action error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add corrective action',
      error: error.message
    });
  }
};

// Add preventive action (HSE only)
const addPreventiveAction = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { action, assignedTo, dueDate, notes } = req.body;

    const user = await User.findById(req.user.userId);
    
    if (user.role !== 'hse' && user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const report = await IncidentReport.findById(reportId);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Incident report not found'
      });
    }

    // Add preventive action
    if (!report.hseManagement.preventiveActions) {
      report.hseManagement.preventiveActions = [];
    }
    
    report.hseManagement.preventiveActions.push({
      action,
      assignedTo,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      status: 'pending',
      notes
    });

    await report.save();

    // Notify assigned person
    const assignee = await User.findOne({ fullName: assignedTo });
    if (assignee) {
      await sendIncidentReportEmail.correctiveActionAssigned(
        assignee.email,
        report.reportNumber,
        action,
        dueDate,
        `Preventive action for incident: ${report.description.substring(0, 100)}...`
      ).catch(console.error);
    }

    res.json({
      success: true,
      message: 'Preventive action added successfully',
      data: report
    });

  } catch (error) {
    console.error('Add preventive action error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add preventive action',
      error: error.message
    });
  }
};

// Update action status (HSE or assignee)
const updateActionStatus = async (req, res) => {
  try {
    const { reportId, actionId } = req.params;
    const { status, notes, actionType } = req.body; // actionType: 'corrective' or 'preventive'

    const user = await User.findById(req.user.userId);
    const report = await IncidentReport.findById(reportId);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Incident report not found'
      });
    }

    const actionArray = actionType === 'corrective' ? 
      report.hseManagement.correctiveActions : 
      report.hseManagement.preventiveActions;

    const actionIndex = actionArray.findIndex(a => a._id.toString() === actionId);

    if (actionIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Action not found'
      });
    }

    const action = actionArray[actionIndex];

    // Check if user can update this action
    const canUpdate = 
      user.role === 'hse' ||
      user.role === 'admin' ||
      action.assignedTo === user.fullName;

    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Update action
    actionArray[actionIndex].status = status;
    if (notes) actionArray[actionIndex].notes = notes;

    if (status === 'completed') {
      actionArray[actionIndex].completedDate = new Date();
    }

    await report.save();

    res.json({
      success: true,
      message: 'Action status updated successfully',
      data: report
    });

  } catch (error) {
    console.error('Update action status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update action status',
      error: error.message
    });
  }
};

// Resolve incident (HSE only)
const resolveIncident = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { resolutionSummary, lessonsLearned } = req.body;

    const user = await User.findById(req.user.userId);
    
    if (user.role !== 'hse' && user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const report = await IncidentReport.findById(reportId)
      .populate('employee', 'fullName email department');

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Incident report not found'
      });
    }

    // Check if all corrective actions are completed
    const pendingCorrectiveActions = report.hseManagement.correctiveActions?.filter(
      a => a.status !== 'completed'
    ) || [];

    const pendingPreventiveActions = report.hseManagement.preventiveActions?.filter(
      a => a.status !== 'completed'
    ) || [];

    if (pendingCorrectiveActions.length > 0 || pendingPreventiveActions.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot resolve incident with pending actions',
        pendingActions: {
          corrective: pendingCorrectiveActions.length,
          preventive: pendingPreventiveActions.length
        }
      });
    }

    // Update resolution
    report.status = 'resolved';
    report.hseManagement.resolutionSummary = resolutionSummary;
    report.hseManagement.resolutionDate = new Date();
    report.hseManagement.lessonsLearned = lessonsLearned;
    
    if (!report.hseManagement.updates) {
      report.hseManagement.updates = [];
    }
    report.hseManagement.updates.push({
      date: new Date(),
      comment: `Incident resolved: ${resolutionSummary}`,
      updatedBy: user.fullName
    });

    await report.save();

    // Notify employee
    await sendIncidentReportEmail.incidentResolved(
      report.employee.email,
      report.reportNumber,
      resolutionSummary,
      report.hseManagement.correctiveActions || [],
      report.hseManagement.preventiveActions || [],
      lessonsLearned
    ).catch(console.error);

    res.json({
      success: true,
      message: 'Incident resolved successfully',
      data: report
    });

  } catch (error) {
    console.error('Resolve incident error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resolve incident',
      error: error.message
    });
  }
};

// Add HSE update/comment
const addHSEUpdate = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { comment } = req.body;

    const user = await User.findById(req.user.userId);
    
    if (user.role !== 'hse' && user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const report = await IncidentReport.findById(reportId);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Incident report not found'
      });
    }

    // Add update
    if (!report.hseManagement.updates) {
      report.hseManagement.updates = [];
    }
    
    report.hseManagement.updates.push({
      date: new Date(),
      comment,
      updatedBy: user.fullName
    });

    await report.save();

    res.json({
      success: true,
      message: 'Update added successfully',
      data: report
    });

  } catch (error) {
    console.error('Add HSE update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add update',
      error: error.message
    });
  }
};

// Get HSE dashboard statistics
const getHSEDashboardStats = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    if (user.role !== 'hse' && user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const [
      totalReports,
      pendingReview,
      underInvestigation,
      actionRequired,
      resolved,
      criticalIncidents,
      injuryIncidents,
      thisMonthReports
    ] = await Promise.all([
      IncidentReport.countDocuments({}),
      IncidentReport.countDocuments({ status: { $in: ['submitted', 'under_review'] } }),
      IncidentReport.countDocuments({ status: 'under_investigation' }),
      IncidentReport.countDocuments({ status: 'action_required' }),
      IncidentReport.countDocuments({ status: 'resolved' }),
      IncidentReport.countDocuments({ 
        severity: 'critical',
        status: { $ne: 'resolved' }
      }),
      IncidentReport.countDocuments({ 
        injuriesReported: true,
        status: { $ne: 'resolved' }
      }),
      IncidentReport.countDocuments({
        createdAt: {
          $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        }
      })
    ]);

    // Get incident type breakdown
    const incidentTypeBreakdown = await IncidentReport.aggregate([
      {
        $group: {
          _id: '$incidentType',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get severity breakdown
    const severityBreakdown = await IncidentReport.aggregate([
      {
        $group: {
          _id: '$severity',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get department breakdown
    const departmentBreakdown = await IncidentReport.aggregate([
      {
        $group: {
          _id: '$department',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Get recent reports
    const recentReports = await IncidentReport.find({})
      .populate('employee', 'fullName email department')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      data: {
        summary: {
          total: totalReports,
          pendingReview,
          underInvestigation,
          actionRequired,
          resolved,
          critical: criticalIncidents,
          withInjuries: injuryIncidents,
          thisMonth: thisMonthReports
        },
        breakdown: {
          byType: incidentTypeBreakdown,
          bySeverity: severityBreakdown,
          byDepartment: departmentBreakdown
        },
        recent: recentReports
      }
    });

  } catch (error) {
    console.error('Get HSE dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics',
      error: error.message
    });
  }
};


const getIncidentReportsByRole = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const { status, page = 1, limit = 20 } = req.query;

    let query = {};

    switch (user.role) {
      case 'employee':
        // Employees see only their own reports
        query = { employee: req.user.userId };
        break;

      case 'supervisor':
        // Supervisors see reports from their department (for awareness)
        query = { department: user.department };
        break;

      case 'hr':
        // HR sees all reports (for awareness/employee matters)
        // No filter needed - can see all
        break;

      case 'hse':
        // HSE sees all reports (primary handler)
        // No filter needed - can see all
        break;

      case 'admin':
        // Admins see all reports
        // No filter needed - can see all
        break;

      default:
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    const reports = await IncidentReport.find(query)
      .populate('employee', 'fullName email department')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean(); // Use lean for better performance

    const total = await IncidentReport.countDocuments(query);

    res.json({
      success: true,
      data: reports,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: reports.length,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('❌ Get incident reports by role error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch incident reports',
      error: error.message
    });
  }
};


// Get employee's own incident reports
const getEmployeeIncidentReports = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    let query = { employee: req.user.userId };

    if (status && status !== 'all') {
      query.status = status;
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const reports = await IncidentReport.find(query)
      .populate('employee', 'fullName email department')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await IncidentReport.countDocuments(query);

    // Get status summary for employee's reports
    const statusSummary = await IncidentReport.aggregate([
      { $match: { employee: new mongoose.Types.ObjectId(req.user.userId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      data: reports,
      summary: statusSummary,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: reports.length,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('❌ Get employee incident reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch incident reports',
      error: error.message
    });
  }
};


// Get incident report details
const getIncidentReportDetails = async (req, res) => {
  try {
    const { reportId } = req.params;

    const report = await IncidentReport.findById(reportId)
      .populate('employee', 'fullName email department employeeId')
      .lean();

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Incident report not found'
      });
    }

    // Check permissions
    const user = await User.findById(req.user.userId);
    
    const canView = 
      report.employee._id.toString() === req.user.userId.toString() || // Owner
      user.role === 'admin' || // Admin
      user.role === 'hse' || // HSE (primary handler)
      user.role === 'hr' || // HR (awareness)
      (user.role === 'supervisor' && report.department === user.department); // Supervisor of same dept

    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this incident report'
      });
    }

    res.json({
      success: true,
      data: report
    });

  } catch (error) {
    console.error('❌ Get incident report details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch incident report details',
      error: error.message
    });
  }
};

// Helper function to find supervisor (from createIncidentReport)
const findSupervisor = (empName, dept) => {
  const department = DEPARTMENT_STRUCTURE[dept];
  if (!department) return null;

  if (department.head === empName) {
    const executive = DEPARTMENT_STRUCTURE['Executive'];
    return executive ? {
      name: executive.head,
      email: executive.headEmail,
      role: 'President'
    } : null;
  }

  if (department.positions) {
    for (const [pos, data] of Object.entries(department.positions)) {
      if (data.name === empName && data.supervisor) {
        if (data.supervisor.includes('Head') || data.supervisor === department.head) {
          return {
            name: department.head,
            email: department.headEmail,
            role: 'Department Head'
          };
        }
        for (const [supPos, supData] of Object.entries(department.positions)) {
          if (supPos === data.supervisor || supData.name === data.supervisor) {
            return {
              name: supData.name,
              email: supData.email,
              role: supPos
            };
          }
        }
      }
    }
  }

  return {
    name: department.head,
    email: department.headEmail,
    role: 'Department Head'
  };
};

const getIncidentDashboardStats = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;

    console.log('=== GET INCIDENT DASHBOARD STATS ===');
    console.log('User:', userId);
    console.log('Role:', userRole);

    let query = {};

    // Filter based on user role
    if (userRole === 'employee') {
      // Employees see only their own incidents
      query.employee = userId;
    } else if (userRole === 'supervisor') {
      // Supervisors see incidents from their department
      const user = await User.findById(userId);
      if (user?.department) {
        query.department = user.department;
      }
    } else if (userRole === 'hse') {
      // HSE sees all incidents (no filter)
    } else if (userRole === 'hr') {
      // HR sees all incidents (no filter)
    } else if (userRole === 'admin') {
      // Admin sees all incidents (no filter)
    }

    // Get statistics
    const [
      totalIncidents,
      pendingIncidents,
      underReviewIncidents,
      underInvestigationIncidents,
      resolvedIncidents
    ] = await Promise.all([
      IncidentReport.countDocuments(query),
      IncidentReport.countDocuments({ 
        ...query, 
        status: 'submitted' 
      }),
      IncidentReport.countDocuments({ 
        ...query, 
        status: 'under_review' 
      }),
      IncidentReport.countDocuments({ 
        ...query, 
        status: 'under_investigation' 
      }),
      IncidentReport.countDocuments({ 
        ...query, 
        status: 'resolved' 
      })
    ]);

    const stats = {
      pending: pendingIncidents,
      total: totalIncidents
    };

    console.log('Incident Stats:', stats);

    res.status(200).json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Error fetching incident dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch incident dashboard stats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  // Core CRUD operations
  createIncidentReport,
  updateIncidentReport,
  deleteIncidentReport,

  // Supervisor functions
  getSupervisorIncidentReports,
  processSupervisorDecision,

  // HR functions
  getHRIncidentReports,
  processHRDecision,
  updateInvestigationStatus,

  // Admin functions
  getAllIncidentReports,

  // Utility functions
  getApprovalChainPreview,
  getIncidentReportsByRole,

  // Analytics and reporting
  getDashboardStats,
  getIncidentReportStats,
  getUrgentIncidentReports,
  getIncidentAnalytics,

  // Follow-up actions
  addFollowUpAction,
  updateFollowUpAction,

  // HSE Management functions
  getHSEIncidentReports,
  updateIncidentStatus,
  startInvestigation,
  completeInvestigation,
  addCorrectiveAction,
  addPreventiveAction,
  updateActionStatus,
  resolveIncident,
  addHSEUpdate,
  getHSEDashboardStats,
  
  // View functions
  getIncidentReportsByRole,
  getEmployeeIncidentReports,
  getIncidentReportDetails,
  getIncidentDashboardStats
};

/**
 * sharepointEmailService.js
 * Replace `require('./emailService')` with your actual mailer (nodemailer / SendGrid etc.)
 */
const sendEmail = require('./emailService');  // ← adjust path

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

const PERM_LABELS = {
  view:     'View only',
  download: 'View & Download',
  upload:   'View, Download & Upload',
  manage:   'Full Management',
  edit:     'Edit (upload versions)'
};

const wrap = (body) => `
<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#333">
  <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:20px;border-radius:8px 8px 0 0">
    <h2 style="color:white;margin:0;font-size:20px">📁 SharePoint Portal</h2>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 8px 8px">
    ${body}
  </div>
  <p style="text-align:center;font-size:11px;color:#999;margin-top:16px">
    Automated notification — do not reply.
  </p>
</div>`;

const btn = (href, label, color = '#1890ff') => `
<div style="text-align:center;margin:24px 0">
  <a href="${href}" style="display:inline-block;background:${color};color:white;
     padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:bold;font-size:15px">
    ${label}
  </a>
</div>`;

/**
 * Notify user when folder/file access is granted.
 * Also used for file collaborator invitations.
 */
const folderAccessGranted = async (recipientEmail, recipientName, resourceName, grantedByName, permission) => {
  const label = PERM_LABELS[permission] || permission;
  return sendEmail({
    to: recipientEmail,
    subject: `📁 Access granted to "${resourceName}"`,
    html: wrap(`
      <h3 style="color:#1890ff">🎉 Access Granted</h3>
      <p>Hi ${recipientName},</p>
      <p><strong>${grantedByName}</strong> gave you access to <strong>"${resourceName}"</strong>.</p>
      <div style="background:#f0f8ff;padding:16px;border-radius:6px;margin:16px 0">
        <p style="margin:0"><strong>Your permission level:</strong></p>
        <p style="margin:8px 0 0;font-size:18px;color:#1890ff">${label}</p>
      </div>
      ${btn(`${CLIENT_URL}/sharepoint/portal`, 'Open SharePoint Portal')}
    `)
  });
};

/**
 * Notify user when access is revoked.
 */
const folderAccessRevoked = async (recipientEmail, recipientName, resourceName, revokedByName) => {
  return sendEmail({
    to: recipientEmail,
    subject: `Access removed from "${resourceName}"`,
    html: wrap(`
      <h3 style="color:#faad14">⚠️ Access Removed</h3>
      <p>Hi ${recipientName},</p>
      <p>Your access to <strong>"${resourceName}"</strong> has been removed by <strong>${revokedByName}</strong>.</p>
      <p style="color:#888">If you think this is an error, contact your manager.</p>
    `)
  });
};

/**
 * Notify a collaborator when someone uploads a new version or adds a comment.
 * @param {string} action - 'new_version' | 'comment'
 */
const notifyCollaborators = async (recipientEmail, recipientName, fileName, actorName, action, extra = {}) => {
  let subject, heading, body;

  if (action === 'new_version') {
    subject = `📄 New version of "${fileName}"`;
    heading = '📄 New Version Available';
    body = `
      <p><strong>${actorName}</strong> uploaded a new version of <strong>"${fileName}"</strong>.</p>
      ${extra.versionNumber ? `<p>Version number: <strong>${extra.versionNumber}</strong></p>` : ''}
      ${extra.changeNote ? `<div style="background:#f5f5f5;padding:12px;border-radius:4px;border-left:3px solid #722ed1">
        <p style="margin:0;font-style:italic">"${extra.changeNote}"</p></div>` : ''}
    `;
  } else if (action === 'comment') {
    subject = `💬 New comment on "${fileName}"`;
    heading = '💬 New Comment';
    body = `
      <p><strong>${actorName}</strong> commented on <strong>"${fileName}"</strong>.</p>
      ${extra.preview ? `<div style="background:#fff8e6;padding:12px;border-radius:4px;border-left:3px solid #faad14">
        <p style="margin:0">"${extra.preview}${extra.preview.length >= 100 ? '...' : ''}"</p></div>` : ''}
    `;
  } else {
    return;
  }

  return sendEmail({
    to: recipientEmail,
    subject,
    html: wrap(`
      <h3 style="color:#722ed1">${heading}</h3>
      <p>Hi ${recipientName},</p>
      ${body}
      ${btn(`${CLIENT_URL}/sharepoint/portal`, 'View File', '#722ed1')}
    `)
  });
};

module.exports = { folderAccessGranted, folderAccessRevoked, notifyCollaborators };











// const { sendEmail } = require('./emailService');

// const sharepointEmailTemplates = {
//   /**
//    * Notify when user is granted folder access
//    */
//   folderAccessGranted: async (recipientEmail, recipientName, folderName, grantedByName, permission) => {
//     try {
//       const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
//       const folderLink = `${clientUrl}/sharepoint/portal`;
      
//       const permissionLabels = {
//         view: 'View only',
//         download: 'View and Download',
//         upload: 'View, Download and Upload',
//         manage: 'Full Management'
//       };

//       const subject = `📁 You've been granted access to "${folderName}"`;
//       const html = `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//           <div style="background-color: #f0f8ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
//             <h2 style="color: #333; margin-top: 0;">🎉 Folder Access Granted</h2>
//             <p style="color: #555; line-height: 1.6;">
//               Hi ${recipientName},
//             </p>
//             <p style="color: #555; line-height: 1.6;">
//               <strong>${grantedByName}</strong> has invited you to access the folder <strong>"${folderName}"</strong>.
//             </p>

//             <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
//               <h3 style="color: #333; margin-top: 0;">Your Access Level</h3>
//               <div style="background-color: #1890ff; color: white; padding: 10px 15px; border-radius: 6px; display: inline-block; font-weight: bold;">
//                 ${permissionLabels[permission]}
//               </div>
//               <div style="margin-top: 15px; padding: 10px; background-color: #f5f5f5; border-radius: 4px;">
//                 ${permission === 'view' ? '👁️ You can view files in this folder' : ''}
//                 ${permission === 'download' ? '⬇️ You can view and download files' : ''}
//                 ${permission === 'upload' ? '⬆️ You can view, download, and upload files' : ''}
//                 ${permission === 'manage' ? '🔧 You have full management rights (invite others, delete files, etc.)' : ''}
//               </div>
//             </div>

//             <div style="text-align: center; margin: 30px 0;">
//               <a href="${folderLink}" 
//                  style="display: inline-block; background-color: #1890ff; color: white; 
//                         padding: 15px 30px; text-decoration: none; border-radius: 8px;
//                         font-weight: bold; font-size: 16px;">
//                 Access Folder Now
//               </a>
//             </div>

//             <div style="margin-top: 20px; padding: 15px; background-color: #fff7e6; border-radius: 6px; border-left: 3px solid #faad14;">
//               <p style="margin: 0; color: #856404; font-size: 14px;">
//                 💡 <strong>Tip:</strong> You can now access this folder from the SharePoint Portal under your accessible folders list.
//               </p>
//             </div>
//           </div>
//         </div>
//       `;

//       return await sendEmail({ to: recipientEmail, subject, html });

//     } catch (error) {
//       console.error('Error sending folder access granted notification:', error);
//       return { success: false, error: error.message };
//     }
//   },

//   /**
//    * Notify when user access is revoked
//    */
//   folderAccessRevoked: async (recipientEmail, recipientName, folderName, revokedByName) => {
//     try {
//       const subject = `Access removed from "${folderName}"`;
//       const html = `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//           <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
//             <h2 style="color: #856404; margin-top: 0;">⚠️ Access Removed</h2>
//             <p style="color: #856404; line-height: 1.6;">
//               Hi ${recipientName},
//             </p>
//             <p style="color: #856404; line-height: 1.6;">
//               Your access to the folder <strong>"${folderName}"</strong> has been removed by <strong>${revokedByName}</strong>.
//             </p>
//             <p style="color: #856404; line-height: 1.6;">
//               You will no longer be able to access files in this folder.
//             </p>
            
//             <div style="margin-top: 20px; padding: 15px; background-color: white; border-radius: 6px;">
//               <p style="margin: 0; color: #666; font-size: 14px;">
//                 If you believe this was done in error, please contact <strong>${revokedByName}</strong> or your administrator.
//               </p>
//             </div>
//           </div>
//         </div>
//       `;

//       return await sendEmail({ to: recipientEmail, subject, html });

//     } catch (error) {
//       console.error('Error sending folder access revoked notification:', error);
//       return { success: false, error: error.message };
//     }
//   },

//   /**
//    * Notify when file is shared with user
//    */
//   fileShared: async (recipientEmail, recipientName, fileName, folderName, sharedByName, accessType) => {
//     try {
//       const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
//       const fileLink = `${clientUrl}/sharepoint/portal`;

//       const subject = `📁 ${sharedByName} shared "${fileName}" with you`;
//       const html = `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//           <div style="background-color: #f0ebff; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea;">
//             <h2 style="color: #333; margin-top: 0;">📁 File Shared With You</h2>
//             <p style="color: #555; line-height: 1.6;">
//               Hi ${recipientName},
//             </p>
//             <p style="color: #555; line-height: 1.6;">
//               <strong>${sharedByName}</strong> has shared a file with you on the SharePoint Portal.
//             </p>

//             <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
//               <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #667eea; padding-bottom: 10px;">File Details</h3>
//               <table style="width: 100%; border-collapse: collapse;">
//                 <tr>
//                   <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>File Name:</strong></td>
//                   <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${fileName}</td>
//                 </tr>
//                 <tr>
//                   <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Folder:</strong></td>
//                   <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${folderName}</td>
//                 </tr>
//                 <tr>
//                   <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Access Type:</strong></td>
//                   <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
//                     <span style="background-color: #667eea; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
//                       ${accessType.toUpperCase()}
//                     </span>
//                   </td>
//                 </tr>
//               </table>
//             </div>

//             <div style="text-align: center; margin: 30px 0;">
//               <a href="${fileLink}" 
//                  style="display: inline-block; background-color: #667eea; color: white; 
//                         padding: 15px 30px; text-decoration: none; border-radius: 8px;
//                         font-weight: bold; font-size: 16px;">
//                 View File
//               </a>
//             </div>
//           </div>
//         </div>
//       `;

//       return await sendEmail({ to: recipientEmail, subject, html });

//     } catch (error) {
//       console.error('Error sending file shared notification:', error);
//       return { success: false, error: error.message };
//     }
//   },

//   /**
//    * Notify when file is uploaded to a folder user has access to
//    */
//   fileUploaded: async (departmentEmails, fileName, folderName, uploadedByName, fileSize) => {
//     try {
//       const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
//       const folderLink = `${clientUrl}/sharepoint/portal`;

//       const subject = `📤 New file uploaded to ${folderName}: ${fileName}`;
//       const html = `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//           <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
//             <h2 style="color: #155724; margin-top: 0;">📤 New File Uploaded</h2>
//             <p style="color: #155724; line-height: 1.6;">
//               <strong>${uploadedByName}</strong> has uploaded a new file to the <strong>${folderName}</strong> folder.
//             </p>

//             <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
//               <h3 style="color: #333; margin-top: 0;">File Information</h3>
//               <p><strong>File:</strong> ${fileName}</p>
//               <p><strong>Size:</strong> ${(fileSize / 1024).toFixed(2)} KB</p>
//               <p><strong>Uploaded by:</strong> ${uploadedByName}</p>
//             </div>

//             <div style="text-align: center; margin: 30px 0;">
//               <a href="${folderLink}" 
//                  style="display: inline-block; background-color: #28a745; color: white; 
//                         padding: 15px 30px; text-decoration: none; border-radius: 8px;
//                         font-weight: bold; font-size: 16px;">
//                 Access Folder
//               </a>
//             </div>
//           </div>
//         </div>
//       `;

//       return await sendEmail({ to: departmentEmails, subject, html });

//     } catch (error) {
//       console.error('Error sending file upload notification:', error);
//       return { success: false, error: error.message };
//     }
//   },

//   /**
//    * Notify about storage quota warning
//    */
//   storageQuotaWarning: async (folderAdminEmail, folderName, usedSpace, maxSpace) => {
//     try {
//       const percentUsed = ((usedSpace / maxSpace) * 100).toFixed(2);
//       const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';

//       const subject = `⚠️ Storage quota warning for ${folderName}`;
//       const html = `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//           <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
//             <h2 style="color: #856404; margin-top: 0;">⚠️ Storage Quota Warning</h2>
//             <p style="color: #856404; line-height: 1.6;">
//               The <strong>${folderName}</strong> folder is running low on storage space.
//             </p>

//             <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
//               <div style="margin-bottom: 15px;">
//                 <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
//                   <span>Storage Used</span>
//                   <span>${percentUsed}%</span>
//                 </div>
//                 <div style="background-color: #e9ecef; border-radius: 4px; height: 20px; overflow: hidden;">
//                   <div style="background-color: #ffc107; height: 100%; width: ${percentUsed}%;"></div>
//                 </div>
//               </div>
//               <p style="margin: 0; color: #666; font-size: 14px;">
//                 Used: ${(usedSpace / 1024 / 1024).toFixed(2)} MB / ${(maxSpace / 1024 / 1024).toFixed(2)} MB
//               </p>
//             </div>

//             <div style="background-color: #f8d7da; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #dc3545;">
//               <p style="color: #721c24; margin: 0;">
//                 <strong>Action Required:</strong> Please delete or archive old files to free up storage space.
//               </p>
//             </div>
//           </div>
//         </div>
//       `;

//       return await sendEmail({ to: folderAdminEmail, subject, html });

//     } catch (error) {
//       console.error('Error sending quota warning:', error);
//       return { success: false, error: error.message };
//     }
//   },

//   /**
//    * Notify when user is blocked from folder
//    */
//   userBlocked: async (recipientEmail, recipientName, folderName, blockedByName, reason) => {
//     try {
//       const subject = `🚫 Access blocked from "${folderName}"`;
//       const html = `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//           <div style="background-color: #f8d7da; padding: 20px; border-radius: 8px; border-left: 4px solid #dc3545;">
//             <h2 style="color: #721c24; margin-top: 0;">🚫 Access Blocked</h2>
//             <p style="color: #721c24; line-height: 1.6;">
//               Hi ${recipientName},
//             </p>
//             <p style="color: #721c24; line-height: 1.6;">
//               Your access to the folder <strong>"${folderName}"</strong> has been blocked by <strong>${blockedByName}</strong>.
//             </p>
//             ${reason ? `
//               <div style="background-color: white; padding: 15px; border-radius: 6px; margin: 20px 0;">
//                 <p style="margin: 0; color: #666;">
//                   <strong>Reason:</strong> ${reason}
//                 </p>
//               </div>
//             ` : ''}
//             <p style="color: #721c24; line-height: 1.6;">
//               If you have questions, please contact <strong>${blockedByName}</strong> or your administrator.
//             </p>
//           </div>
//         </div>
//       `;

//       return await sendEmail({ to: recipientEmail, subject, html });

//     } catch (error) {
//       console.error('Error sending user blocked notification:', error);
//       return { success: false, error: error.message };
//     }
//   }
// };

// module.exports = sharepointEmailTemplates;


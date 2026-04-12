const fs = require('fs');
const path = require('path');
const { SharePointFolder } = require('../models/SharePoint');
const User = require('../models/User');

const initializeSharePoint = async () => {
  try {
    console.log('\n=== INITIALIZING SHAREPOINT ===');
    
    // 1. Create upload directories
    const uploadDir = path.join(__dirname, '../uploads/sharepoint');
    const subDirs = ['temp', 'company-shared', 'finance', 'hr', 'it', 'supply-chain', 'technical'];
    
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true, mode: 0o755 });
      console.log('✓ Created SharePoint upload directory');
    }
    
    subDirs.forEach(dir => {
      const dirPath = path.join(uploadDir, dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 });
        console.log(`✓ Created subdirectory: ${dir}`);
      }
    });

    // 2. Create default folders if they don't exist
    const adminUser = await User.findOne({ role: 'admin' });
    if (!adminUser) {
      console.log('⚠ No admin user found. Skipping default folder creation.');
      return;
    }

    const defaultFolders = [
      {
        name: 'Company Shared',
        description: 'Organization-wide resources and announcements',
        department: 'Company',
        isPublic: true,
        createdBy: adminUser._id
      },
      {
        name: 'Finance Department',
        description: 'Financial documents and reports',
        department: 'Finance',
        isPublic: false,
        createdBy: adminUser._id,
        accessControl: {
          allowedDepartments: ['Finance'],
          allowedUsers: []
        }
      },
      {
        name: 'HR Department',
        description: 'Human Resources documents',
        department: 'HR',
        isPublic: false,
        createdBy: adminUser._id,
        accessControl: {
          allowedDepartments: ['HR'],
          allowedUsers: []
        }
      }
    ];

    for (const folderData of defaultFolders) {
      const exists = await SharePointFolder.findOne({ name: folderData.name });
      if (!exists) {
        await SharePointFolder.create(folderData);
        console.log(`✓ Created default folder: ${folderData.name}`);
      }
    }

    console.log('=== SHAREPOINT INITIALIZATION COMPLETE ===\n');
  } catch (error) {
    console.error('SharePoint initialization error:', error);
  }
};

module.exports = { initializeSharePoint };

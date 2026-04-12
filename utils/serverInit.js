const fs = require('fs');
const path = require('path');

/**
 * Initialize server directories and configurations
 */
const initializeServer = () => {
  console.log('🚀 Initializing server...\n');

  // Define all required directories
  const directories = [
    // Upload directories
    'uploads',
    'uploads/temp',
    'uploads/attachments',
    'uploads/justifications',
    'uploads/receipts',
    
    // Logs directory
    'logs',
    
    // Temp directories
    'temp',
    'temp/uploads'
  ];

  let created = 0;
  let existed = 0;

  directories.forEach(dir => {
    const fullPath = path.join(process.cwd(), dir);
    
    if (!fs.existsSync(fullPath)) {
      try {
        fs.mkdirSync(fullPath, { recursive: true, mode: 0o755 });
        console.log(`✓ Created directory: ${dir}`);
        created++;
      } catch (error) {
        console.error(`✗ Failed to create directory ${dir}:`, error.message);
      }
    } else {
      existed++;
    }
  });

  console.log(`\n📁 Directory initialization complete:`);
  console.log(`   ✓ Created: ${created}`);
  console.log(`   ✓ Already existed: ${existed}\n`);

  // Create .gitkeep files in upload directories to preserve structure
  const keepDirs = [
    'uploads/temp',
    'uploads/attachments',
    'uploads/justifications',
    'temp/uploads'
  ];

  keepDirs.forEach(dir => {
    const keepFile = path.join(process.cwd(), dir, '.gitkeep');
    if (!fs.existsSync(keepFile)) {
      try {
        fs.writeFileSync(keepFile, '# Keep this directory in git\n');
      } catch (error) {
        // Ignore errors for .gitkeep
      }
    }
  });

  // Clean old temp files (older than 24 hours)
  cleanOldTempFiles();
};

/**
 * Clean temporary files older than 24 hours
 */
const cleanOldTempFiles = () => {
  const tempDir = path.join(process.cwd(), 'uploads/temp');
  
  if (!fs.existsSync(tempDir)) return;

  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  fs.readdir(tempDir, (err, files) => {
    if (err) {
      console.error('Error reading temp directory:', err);
      return;
    }

    let cleaned = 0;

    files.forEach(file => {
      if (file === '.gitkeep') return;

      const filePath = path.join(tempDir, file);
      
      fs.stat(filePath, (err, stats) => {
        if (err) return;

        const age = now - stats.mtimeMs;
        
        if (age > maxAge) {
          fs.unlink(filePath, (err) => {
            if (!err) {
              cleaned++;
              console.log(`🗑️  Cleaned old temp file: ${file}`);
            }
          });
        }
      });
    });

    if (cleaned > 0) {
      console.log(`\n🧹 Cleaned ${cleaned} old temporary file(s)\n`);
    }
  });
};

/**
 * Verify server configuration
 */
const verifyConfiguration = () => {
  const required = [
    'MONGODB_URI',
    'JWT_SECRET',
    'EMAIL_USER',
    'EMAIL_PASSWORD'
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.warn('\n⚠️  WARNING: Missing environment variables:');
    missing.forEach(key => console.warn(`   - ${key}`));
    console.warn('');
  }

  // Check upload limits
  const maxSize = process.env.MAX_FILE_SIZE || '25MB';
  const allowedTypes = process.env.ALLOWED_FILE_TYPES || 'pdf,doc,docx,jpg,jpeg,png';
  
  console.log('📋 Server Configuration:');
  console.log(`   Max file size: ${maxSize}`);
  console.log(`   Allowed file types: ${allowedTypes}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
};

module.exports = {
  initializeServer,
  cleanOldTempFiles,
  verifyConfiguration
};
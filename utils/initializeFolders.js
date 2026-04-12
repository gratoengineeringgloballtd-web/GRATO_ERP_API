const fs = require('fs');
const path = require('path');

const initializeSharePointFolders = () => {
  const basePath = path.join(__dirname, '../uploads/sharepoint');
  const subDirs = [
    'company-shared',
    'finance',
    'hr',
    'it',
    'supply-chain',
    'technical',
    'temp'
  ];

  // Create base directory
  if (!fs.existsSync(basePath)) {
    fs.mkdirSync(basePath, { recursive: true, mode: 0o755 });
    console.log(`✓ Created SharePoint upload directory: ${basePath}`);
  }

  // Create subdirectories
  subDirs.forEach(dir => {
    const dirPath = path.join(basePath, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 });
      console.log(`✓ Created subdirectory: ${dir}`);
    }
  });
};

module.exports = initializeSharePointFolders;
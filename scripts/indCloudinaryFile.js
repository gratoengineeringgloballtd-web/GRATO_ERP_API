// Run as: node scripts/findCloudinaryFile.js
require('dotenv').config();
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const search = async () => {
  // Search for the file by filename fragment
  const result = await cloudinary.search
    .expression('filename:1jl44r')
    .with_field('resource_type')
    .execute();
  
  console.log(JSON.stringify(result.resources, null, 2));
};

search().catch(console.error);
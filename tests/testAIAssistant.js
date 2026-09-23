// Test script for AI Assistant functionality
// Run this in your backend console or as a standalone script

const AIAssistantService = require('./services/AIAssistantService');
const mongoose = require('mongoose');

// Test data
const testMessages = [
  "Show my pending tasks",
  "What parts do I need?",
  "Show my assigned sites",
  "Help with generator maintenance",
  "How do I troubleshoot a fuel issue?",
  "Show completed tasks this month",
  "Tell me about task 123",
];

async function testAIAssistant() {
  console.log('🤖 AI Assistant Test Suite\n');
  console.log('=' .repeat(50));

  try {
    // Connect to database (adjust connection string as needed)
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/grato');
    console.log('✅ Connected to database\n');

    // Test 1: Intent Parsing
    console.log('Test 1: Intent Parsing');
    console.log('-'.repeat(50));
    
    for (const message of testMessages.slice(0, 3)) {
      console.log(`\nMessage: "${message}"`);
      const intent = await AIAssistantService.parseIntent(message, 'test-user-id');
      console.log('Intent:', intent.intent);
      console.log('Confidence:', intent.confidence);
      console.log('Entities:', JSON.stringify(intent.entities, null, 2));
    }

    // Test 2: Full Chat Flow
    console.log('\n\n' + '='.repeat(50));
    console.log('Test 2: Full Chat Flow');
    console.log('-'.repeat(50));

    const testUserId = 'test-user-id'; // Replace with actual technician ID from your DB
    
    for (const message of testMessages) {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`👤 User: "${message}"`);
      console.log('-'.repeat(50));
      
      try {
        const response = await AIAssistantService.chat(message, testUserId);
        
        console.log('🤖 Assistant:', response.text);
        console.log('Action:', response.action);
        console.log('Intent:', response.intent);
        
        if (response.data) {
          if (Array.isArray(response.data)) {
            console.log('Data Count:', response.data.length, 'items');
          } else {
            console.log('Data:', JSON.stringify(response.data, null, 2).substring(0, 200) + '...');
          }
        }
      } catch (error) {
        console.error('❌ Error:', error.message);
      }

      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Test 3: Suggestions Endpoint
    console.log('\n\n' + '='.repeat(50));
    console.log('Test 3: Suggestions');
    console.log('-'.repeat(50));
    
    const suggestions = [
      { id: 1, text: "Show my pending tasks", icon: "tasks", category: "tasks" },
      { id: 2, text: "What parts do I need?", icon: "tools", category: "parts" },
      { id: 3, text: "Show my assigned sites", icon: "map-marker-alt", category: "sites" },
    ];
    
    console.log('\nAvailable suggestions:');
    suggestions.forEach(s => {
      console.log(`  [${s.icon}] ${s.text}`);
    });

    console.log('\n\n✅ All tests completed!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error(error.stack);
  } finally {
    // Close database connection
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from database');
  }
}

// Run tests
if (require.main === module) {
  testAIAssistant()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { testAIAssistant };

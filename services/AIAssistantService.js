const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require('../utils/logger');
const Maintenance = require('../models/Maintenance');
const Site = require('../models/Site');
const Part = require('../models/Part');
const User = require('../models/User');

class AIAssistantService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    if (!this.apiKey) {
      logger.warn('GEMINI_API_KEY is not set in environment variables');
    }
    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-flash-latest" });
  }

  /**
   * Extract intent and entities from user message
   * @param {string} message - User's natural language request
   * @param {string} userId - User ID for context
   * @returns {Promise<Object>} - Parsed intent and entities
   */
  async parseIntent(message, userId) {
    try {
      const prompt = `
You are an AI assistant for Grato technicians. Analyze this message and extract:
1. The intent (what the user wants to do)
2. Any entities (specific values mentioned)

Available intents:
- view_tasks: User wants to see their tasks/maintenance records
- view_task_details: User wants details about a specific task
- view_parts: User wants to see parts inventory
- request_part: User wants to request a part
- view_sites: User wants to see their assigned sites
- update_task_status: User wants to update a task status
- create_maintenance_report: User wants to create/submit a report
- get_maintenance_advice: User needs help with a maintenance issue
- general_chat: General question or greeting

Message: "${message}"

Respond ONLY with valid JSON in this exact format:
{
  "intent": "intent_name",
  "entities": {
    "status": "pending|in_progress|completed",
    "site_name": "site name if mentioned",
    "part_name": "part name if mentioned",
    "task_id": "task ID if mentioned",
    "date": "date if mentioned"
  },
  "confidence": 0.0-1.0
}
`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim();
      
      // Extract JSON from response (handle markdown code blocks)
      let jsonText = text;
      if (text.includes('```json')) {
        jsonText = text.split('```json')[1].split('```')[0].trim();
      } else if (text.includes('```')) {
        jsonText = text.split('```')[1].split('```')[0].trim();
      }
      
      return JSON.parse(jsonText);
    } catch (error) {
      logger.error('Intent parsing error:', error);
      return {
        intent: 'general_chat',
        entities: {},
        confidence: 0.5
      };
    }
  }

  /**
   * Execute the parsed intent and fetch relevant data
   * @param {Object} intent - Parsed intent object
   * @param {string} userId - User ID
   * @returns {Promise<Object>} - Action result with data
   */
  async executeIntent(intent, userId) {
    try {
      switch (intent.intent) {
        case 'view_tasks':
          return await this.fetchUserTasks(userId, intent.entities);
        
        case 'view_task_details':
          return await this.fetchTaskDetails(intent.entities.task_id, userId);
        
        case 'view_parts':
          return await this.fetchParts(intent.entities);
        
        case 'view_sites':
          return await this.fetchUserSites(userId);
        
        case 'get_maintenance_advice':
          return await this.getMaintenanceAdvice(intent.entities);
        
        default:
          return { 
            action: 'none',
            data: null,
            message: 'I understood your request but need more information to help.'
          };
      }
    } catch (error) {
      logger.error('Intent execution error:', error);
      return {
        action: 'error',
        data: null,
        message: 'Sorry, I encountered an error processing your request.'
      };
    }
  }

  /**
   * Fetch user tasks based on criteria
   */
  async fetchUserTasks(userId, entities) {
    const query = { technician: userId };
    
    if (entities.status) {
      query.status = entities.status;
    } else {
      // Default to active tasks
      query.status = { $in: ['draft', 'approved', 'pending_approval', 'scheduled', 'in_progress'] };
    }

    const tasks = await Maintenance.find(query)
      .populate('supervisor', 'fullName phone')
      .sort({ visit_date: -1 })
      .limit(10)
      .lean();

    return {
      action: 'show_tasks',
      data: tasks,
      count: tasks.length,
      message: null
    };
  }

  /**
   * Fetch specific task details
   */
  async fetchTaskDetails(taskId, userId) {
    if (!taskId) {
      return {
        action: 'error',
        data: null,
        message: 'Please specify which task you want to see. You can say "show task 123" or "details of my latest task".'
      };
    }

    const task = await Maintenance.findOne({ _id: taskId, technician: userId })
      .populate('supervisor', 'fullName phone email')
      .populate('parts_used.part_id', 'name part_number')
      .lean();

    if (!task) {
      return {
        action: 'error',
        data: null,
        message: 'I couldn\'t find that task. Please make sure you have access to it.'
      };
    }

    return {
      action: 'show_task_detail',
      data: task,
      message: null
    };
  }

  /**
   * Fetch parts inventory
   */
  async fetchParts(entities) {
    const query = {};
    
    if (entities.part_name) {
      query.name = { $regex: entities.part_name, $options: 'i' };
    }

    const parts = await Part.find(query)
      .sort({ name: 1 })
      .limit(20)
      .lean();

    return {
      action: 'show_parts',
      data: parts,
      count: parts.length,
      message: null
    };
  }

  /**
   * Fetch user's assigned sites
   */
  async fetchUserSites(userId) {
    const user = await User.findById(userId).select('fullName');
    if (!user) {
      return { action: 'error', data: null, message: 'User not found' };
    }

    const sites = await Site.find({ 
      Technician_Name: user.fullName 
    }).limit(20).lean();

    return {
      action: 'show_sites',
      data: sites,
      count: sites.length,
      message: null
    };
  }

  /**
   * Get maintenance advice
   */
  async getMaintenanceAdvice(entities) {
    const issue = entities.issue || entities.part_name || 'general maintenance';
    
    const prompt = `
You are an expert generator maintenance technician. Provide concise, practical advice for this issue:

Issue: ${issue}

Provide:
1. Quick safety check (1-2 items)
2. Most likely causes (2-3 items)
3. Recommended actions (2-3 steps)

Keep it brief and actionable. Use bullet points.
`;

    const result = await this.model.generateContent(prompt);
    const response = await result.response;
    const advice = response.text();

    return {
      action: 'show_advice',
      data: { advice },
      message: null
    };
  }

  /**
   * Generate a natural language response based on action results
   * @param {Object} actionResult - Result from executeIntent
   * @param {string} originalMessage - User's original message
   * @returns {Promise<string>} - Natural language response
   */
  async generateResponse(actionResult, originalMessage) {
    try {
      let contextInfo = '';
      
      if (actionResult.action === 'show_tasks' && actionResult.data) {
        const taskSummaries = actionResult.data.map(t => 
          `- ${t.visit_type} at ${t.site_name || t.site_id} (Status: ${t.status})`
        ).join('\n');
        contextInfo = `\nTasks found:\n${taskSummaries}`;
      } else if (actionResult.action === 'show_task_detail' && actionResult.data) {
        const task = actionResult.data;
        contextInfo = `\nTask: ${task.visit_type} at ${task.site_name || task.site_id}\nStatus: ${task.status}\nDate: ${task.visit_date}`;
      } else if (actionResult.action === 'show_parts' && actionResult.data) {
        const partsList = actionResult.data.slice(0, 5).map(p => 
          `- ${p.name} (Stock: ${p.stock_quantity})`
        ).join('\n');
        contextInfo = `\nParts available:\n${partsList}`;
      } else if (actionResult.action === 'show_advice' && actionResult.data) {
        return actionResult.data.advice;
      }

      const prompt = `
You are a helpful AI assistant for Grato technicians. The user asked: "${originalMessage}"

${contextInfo ? `Context/Data retrieved:${contextInfo}` : 'No specific data was retrieved.'}

${actionResult.message ? `System message: ${actionResult.message}` : ''}

Provide a friendly, concise response (2-3 sentences) that:
1. Acknowledges what they asked
2. Summarizes the key findings or next steps
3. Offers to help further if needed

Keep it conversational and helpful.
`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      logger.error('Response generation error:', error);
      return 'I found some information for you. How else can I help?';
    }
  }

  /**
   * Main chat handler - orchestrates the full conversation flow
   * @param {string} message - User's message
   * @param {string} userId - User ID
   * @returns {Promise<Object>} - Response with text and action data
   */
  async chat(message, userId) {
    try {
      // 1. Parse intent
      const intent = await this.parseIntent(message, userId);
      logger.info('Parsed intent:', intent);

      // 2. Execute intent and get data
      const actionResult = await this.executeIntent(intent, userId);
      logger.info('Action result:', { action: actionResult.action, count: actionResult.count });

      // 3. Generate natural language response
      const responseText = await this.generateResponse(actionResult, message);

      // 4. Return both the response text and action data
      return {
        text: responseText,
        action: actionResult.action,
        data: actionResult.data,
        intent: intent.intent
      };
    } catch (error) {
      logger.error('AI Assistant chat error:', error);
      return {
        text: 'I apologize, but I encountered an error. Please try rephrasing your question or contact support if the issue persists.',
        action: 'error',
        data: null,
        intent: 'unknown'
      };
    }
  }
}

module.exports = new AIAssistantService();

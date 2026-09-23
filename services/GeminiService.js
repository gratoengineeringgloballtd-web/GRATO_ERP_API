const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require('../utils/logger');

class GeminiService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    if (!this.apiKey) {
      logger.warn('GEMINI_API_KEY is not set in environment variables');
    }
    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-flash-latest" });
  }

  /**
   * Generate maintenance advice based on task details
   * @param {Object} taskDetails - Details of the maintenance task
   * @returns {Promise<string>} - Advice text
   */
  async generateMaintenanceAdvice(taskDetails) {
    try {
      const prompt = `
        You are an expert industrial generator technician. 
        Provide specific, safe, and professional maintenance advice for the following task:
        
        Equipment: ${taskDetails.equipmentName || 'Generator'}
        Issue/Task: ${taskDetails.description || 'General Maintenance'}
        Error Codes (if any): ${taskDetails.errorCodes || 'None'}
        
        Please provide:
        1. Safety precautions first.
        2. Step-by-step troubleshooting or maintenance guide.
        3. Tools likely needed.
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      logger.error('Gemini generateMaintenanceAdvice error:', error);
      throw new Error('Failed to generate maintenance advice');
    }
  }

  /**
   * Enhance technician notes into a professional report
   * @param {string} rawNotes - Rough notes from technician
   * @returns {Promise<string>} - Polished report text
   */
  async enhanceReport(rawNotes) {
    try {
      const prompt = `
        Transform the following rough technician notes into a clear, professional technical report paragraph.
        Fix grammar, expand abbreviations, and ensure a professional tone. Keep it factual.
        
        Technician Notes:
        "${rawNotes}"
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      logger.error('Gemini enhanceReport error:', error);
      throw new Error('Failed to enhance report');
    }
  }

  /**
   * Analyze cluster performance and provide insights for Supervisor
   * @param {Object} clusterStats - Statistics about the cluster
   * @returns {Promise<string>} - Analysis text
   */
  async analyzeClusterPerformance(clusterStats) {
    try {
      // safe stringify
      const statsStr = JSON.stringify(clusterStats, null, 2);

      const prompt = `
        Analyze the following cluster performance data for a Grato supervisor.
        Highlight any anomalies, efficiency issues, or areas needing attention.
        
        Data:
        ${statsStr}
        
        Provide 3 key insights or action items.
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      logger.error('Gemini analyzeClusterPerformance error:', error);
      throw new Error('Failed to analyze cluster performance');
    }
  }

  /**
   * General chat for assistance
   * @param {string} message - User query
   * @param {string} role - User role (technician/supervisor)
   * @returns {Promise<string>}
   */
  async chat(message, role) {
    try {
      const prompt = `
        You are an AI assistant for the Grato Monitoring System.
        The user is a ${role}.
        Answer their question regarding generator maintenance, system usage, or safety.
        
        User Question: "${message}"
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      logger.error('Gemini chat error:', error);
      throw new Error('Failed to process chat message');
    }
  }
}

module.exports = new GeminiService();

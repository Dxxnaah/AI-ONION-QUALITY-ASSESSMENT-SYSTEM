/**
 * AI Quality Assessment Service Provider Abstraction
 * 
 * Supports seamless switching between DemoAIService and RealYOLOAIService
 * via process.env.AI_MODE ('demo' | 'real').
 */

const demoAIService = require('./demoAIService');
const realYOLOAIService = require('./realYOLOAIService');

class AIQualityService {
  /**
   * Determine active AI mode
   */
  getMode() {
    return (process.env.AI_MODE || 'demo').toLowerCase().trim();
  }

  /**
   * Get active provider instance
   */
  getProvider() {
    const mode = this.getMode();
    if (mode === 'real') {
      return realYOLOAIService;
    }
    return demoAIService;
  }

  /**
   * Run image analysis using the configured AI provider
   * @param {Object} params
   * @param {string} params.imagePath
   * @param {string} params.imageUrl
   * @param {number} params.sampleWeight
   */
  async analyze(params) {
    const provider = this.getProvider();
    console.log(`[AIQualityService] Running onion assessment using ${provider.name} (mode: ${this.getMode()})`);
    return await provider.analyze(params);
  }
}

module.exports = new AIQualityService();

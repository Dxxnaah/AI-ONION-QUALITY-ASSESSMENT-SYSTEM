/**
 * Real YOLO AI Service for Onion Quality Assessment
 * 
 * Communicates with an external Python FastAPI / YOLO computer vision service
 * via AI_SERVICE_URL environment variable.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { calculateQualityMetrics } = require('../utils/gradingRules');

class RealYOLOAIService {
  constructor() {
    this.name = 'RealYOLOAIService';
    this.mode = 'real';
    this.serviceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
  }

  /**
   * Run real YOLO AI prediction via external microservice
   * @param {Object} params
   * @param {string} params.imagePath - Path to local image file
   * @param {string} params.imageUrl - Accessible URL for the image
   * @param {number} params.sampleWeight - Sample weight in kg
   * @returns {Promise<Object>}
   */
  async analyze({ imagePath, imageUrl, sampleWeight = 2.0 }) {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Sample image not found on disk at: ${imagePath}`);
    }

    const endpoint = `${this.serviceUrl.replace(/\/$/, '')}/predict`;

    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const boundary = '----AgriQueueFormBoundary' + Math.random().toString(36).substring(2);

      const postDataHeader = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${path.basename(imagePath)}"\r\n` +
        `Content-Type: image/jpeg\r\n\r\n`
      );
      const postDataFooter = Buffer.from(`\r\n--${boundary}--\r\n`);
      const payload = Buffer.concat([postDataHeader, imageBuffer, postDataFooter]);

      const urlObj = new URL(endpoint);
      const transport = urlObj.protocol === 'https:' ? https : http;

      const responseBody = await new Promise((resolve, reject) => {
        const req = transport.request(
          {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              'Content-Length': payload.length
            },
            timeout: 15000
          },
          res => {
            let data = '';
            res.on('data', chunk => (data += chunk));
            res.on('end', () => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                try {
                  resolve(JSON.parse(data));
                } catch (e) {
                  reject(new Error(`Failed to parse AI service response JSON: ${data}`));
                }
              } else {
                reject(new Error(`AI Service returned HTTP ${res.statusCode}: ${data}`));
              }
            });
          }
        );

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('AI Service request timed out after 15 seconds'));
        });

        req.on('error', err => {
          reject(new Error(`AI Service connection error (${this.serviceUrl}): ${err.message}`));
        });

        req.write(payload);
        req.end();
      });

      // Parse YOLO response detections
      const rawDetections = (responseBody.detections || []).map((d, index) => {
        // Standardize bbox format (handle either [x, y, w, h] array or object)
        let bbox = { x: 10, y: 10, width: 20, height: 20 };
        if (Array.isArray(d.bbox)) {
          bbox = { x: d.bbox[0], y: d.bbox[1], width: d.bbox[2], height: d.bbox[3] };
        } else if (d.bbox && typeof d.bbox === 'object') {
          bbox = d.bbox;
        }

        const confidence = typeof d.confidence === 'number' ? Number(d.confidence.toFixed(2)) : 0.85;

        return {
          id: d.id || index + 1,
          class: (d.class || 'GOOD').toUpperCase(),
          confidence,
          bbox,
          notes: d.notes || '',
          needsReview: confidence < 0.70,
          humanVerified: false,
          humanVerifiedClass: null
        };
      });

      const metrics = calculateQualityMetrics(rawDetections);

      return {
        success: true,
        mode: this.mode,
        modeLabel: 'REAL YOLO AI MODEL',
        demoMode: false,
        modelVersion: responseBody.modelVersion || 'onion-yolo-v8-production',
        imageUrl,
        sampleWeight: Number(sampleWeight),
        analyzedAt: new Date(),
        totalDetected: rawDetections.length,
        detections: rawDetections,
        counts: metrics.counts,
        percentages: metrics.percentages,
        needsReviewCount: metrics.needsReviewCount,
        gradingRuleVersion: metrics.gradingRuleVersion,
        ruleNotice: metrics.ruleNotice,
        recommendedStatus: metrics.recommendedStatus
      };
    } catch (err) {
      console.error('[RealYOLOAIService] Failed to communicate with AI Service:', err.message);
      throw new Error(
        `Real AI Service error: ${err.message}. To run without external AI service, set AI_MODE=demo in .env`
      );
    }
  }
}

module.exports = new RealYOLOAIService();

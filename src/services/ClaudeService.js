import Anthropic from '@anthropic-ai/sdk';
import tokenizerPkg from '@anthropic-ai/tokenizer';
const { getTokenCount } = tokenizerPkg;
import crypto from 'crypto';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import dbManager from '../database/Database.js';

class ClaudeService {
  constructor() {
    this.client = new Anthropic({
      apiKey: config.anthropic.apiKey,
    });
    this.rateLimiter = new Map(); // Simple rate limiter
  }

  // Generate cache key for requests
  generateCacheKey(messages, systemPrompt, cacheType = 'conversation') {
    const content = JSON.stringify({ messages, systemPrompt, cacheType });
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  // Generate hash for prompt content
  generatePromptHash(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  // Calculate tokens using Anthropic tokenizer
  calculateTokens(text) {
    // Handle null/undefined text
    if (!text || typeof text !== 'string') {
      return 0;
    }
    
    try {
      // Try to use tokenizer if available
      if (typeof getTokenCount === 'function') {
        return getTokenCount(text);
      }
    } catch (error) {
      logger.warn('Token calculation fallback', { error: error.message });
    }
    // Fallback to character-based estimation (1 token ≈ 4 characters)
    return Math.ceil(text.length / 4);
  }

  // Determine optimal cache points for conversation
  findCachePoints(messages, systemPrompt) {
    // Validate messages parameter
    if (!messages || !Array.isArray(messages)) {
      logger.warn('Invalid messages in findCachePoints', { messages });
      return [];
    }
    
    const systemTokens = this.calculateTokens(systemPrompt);
    const minTokensForCache = 1024; // For Claude Sonnet
    
    let accumulatedTokens = systemTokens;
    let cachePoints = [];
    
    logger.info('Analyzing cache points', {
      systemTokens,
      messageCount: messages.length,
      minRequired: minTokensForCache
    });

    for (let i = 0; i < messages.length; i++) {
      const messageTokens = this.calculateTokens(messages[i].content);
      accumulatedTokens += messageTokens;
      
      // If we've accumulated enough tokens, this could be a cache point
      if (accumulatedTokens >= minTokensForCache) {
        cachePoints.push({
          messageIndex: i,
          totalTokens: accumulatedTokens,
          messageTokens
        });
        
        logger.info('Cache point found', {
          messageIndex: i,
          totalTokens: accumulatedTokens,
          messageContent: messages[i].content.substring(0, 50) + '...'
        });
      }
    }
    
    return cachePoints;
  }

  // Build messages with smart caching strategy
  buildMessagesWithCache(messages, systemPrompt, options = {}) {
    const systemTokens = this.calculateTokens(systemPrompt);
    const messageCount = messages.length;
    
    logger.info('Building optimized request', { 
      messageCount, 
      systemTokens,
      strategy: this.determineStrategy(messageCount, systemTokens),
      isNewWeek: options.isNewWeek || false
    });
    
    // Strategy 1: Short conversations (1-10 messages) - cache system prompt only
    if (messageCount <= 10) {
      return this.buildSimpleSystemCache(messages, systemPrompt, systemTokens);
    }
    
    // Strategy 2: Long conversations (11+ messages) - use sliding window
    return this.buildSlidingWindowCache(messages, systemPrompt, options);
  }
  
  // Determine caching strategy
  determineStrategy(messageCount, systemTokens) {
    if (messageCount <= 10) {
      return systemTokens >= 800 ? 'system_cache' : 'no_cache';
    }
    return 'sliding_window';
  }
  
  // Simple system prompt caching for short conversations
  buildSimpleSystemCache(messages, systemPrompt, systemTokens) {
    const result = {
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }))
    };
    
    // Only cache system prompt if it's large enough (800+ tokens for testing)
    if (systemPrompt && systemTokens >= 800) {
      result.system = [{
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' }
      }];
      
      logger.info('Using system prompt cache', { systemTokens });
    } else if (systemPrompt) {
      result.system = [{
        type: 'text',
        text: systemPrompt
        // No cache_control for small prompts
      }];
      logger.info('System prompt too small for caching', { systemTokens });
    }
    
    return result;
  }
  
  // Sliding window caching for long conversations
  buildSlidingWindowCache(messages, systemPrompt, options = {}) {
    const recentCount = 6; // Keep last 6 messages in messages array
    const recentMessages = messages.slice(-recentCount);
    const oldMessages = messages.slice(0, -recentCount);
    
    let conversationHistory;
    
    // Strategy: if very long conversation (30+ messages), use summarization
    if (messages.length >= 30) {
      conversationHistory = this.summarizeConversationHistory(oldMessages);
      logger.info('Using conversation summarization', { 
        originalMessages: oldMessages.length,
        summaryLength: conversationHistory.length 
      });
    } else {
      // Regular sliding window for moderately long conversations
      conversationHistory = oldMessages.map(msg => 
        `${msg.role === 'user' ? 'Терапевт' : 'Пациент'}: ${msg.content}`
      ).join('\n');
    }
    
    // Determine session context based on continuation type
    let sessionContext;
    if (options.isNewWeek) {
      sessionContext = `ПРОШЛАЯ СЕССИЯ (неделю назад):
${conversationHistory}

НОВАЯ ВСТРЕЧА:
Прошла неделя после предыдущей сессии. Начинайте как если бы пришли на новую встречу, помня что произошло на прошлой сессии. Можете упомянуть как прошла неделя, что изменилось, какие мысли были после прошлой встречи.`;
    } else {
      sessionContext = `ПРЕДЫДУЩИЙ КОНТЕКСТ СЕССИИ:
${conversationHistory}

ТЕКУЩИЙ ДИАЛОГ ПРОДОЛЖАЕТСЯ:`;
    }
    
    const enhancedSystemPrompt = `${systemPrompt}

${sessionContext}`;
    
    const result = {
      system: [{
        type: 'text',
        text: enhancedSystemPrompt,
        cache_control: { type: 'ephemeral' }
      }],
      messages: recentMessages.map(msg => ({
        role: msg.role,
        content: msg.content
      }))
    };
    
    logger.info('Using sliding window cache', {
      totalMessages: messages.length,
      oldMessages: oldMessages.length,
      recentMessages: recentMessages.length,
      enhancedSystemTokens: this.calculateTokens(enhancedSystemPrompt),
      usedSummarization: messages.length >= 30,
      isNewWeek: options.isNewWeek || false
    });
    
    return result;
  }
  
  // Summarize conversation history for very long sessions
  summarizeConversationHistory(messages) {
    if (!messages || messages.length === 0) {
      return 'Сессия только началась.';
    }
    
    // Group messages into conversation segments
    const segments = [];
    let currentSegment = [];
    
    for (let i = 0; i < messages.length; i++) {
      currentSegment.push(messages[i]);
      
      // Create segment every 8-10 messages or at natural breaks
      if (currentSegment.length >= 8 || i === messages.length - 1) {
        segments.push([...currentSegment]);
        currentSegment = [];
      }
    }
    
    // Summarize each segment
    const summaries = segments.map((segment, index) => {
      const therapistMessages = segment.filter(m => m.role === 'user');
      const patientMessages = segment.filter(m => m.role === 'assistant');
      
      // Extract key themes and topics
      const themes = this.extractKeyThemes(segment);
      const emotions = this.extractEmotions(patientMessages);
      
      return `Сегмент ${index + 1}: ${themes}. Эмоциональное состояние: ${emotions}.`;
    });
    
    // Combine all summaries
    const fullSummary = summaries.join(' ');
    
    logger.info('Conversation summarized', { 
      originalMessages: messages.length,
      segments: segments.length,
      summaryLength: fullSummary.length 
    });
    
    return fullSummary;
  }
  
  // Extract key themes from conversation segment
  extractKeyThemes(messages) {
    const content = messages.map(m => m.content).join(' ').toLowerCase();
    
    // Common therapy themes and keywords
    const themes = {
      'работа и стресс': ['работа', 'стресс', 'коллеги', 'начальник', 'проект', 'дедлайн'],
      'отношения': ['семья', 'партнер', 'друзья', 'отношения', 'любовь', 'конфликт'],
      'эмоции': ['тревога', 'депрессия', 'злость', 'страх', 'радость', 'грусть'],
      'здоровье': ['сон', 'усталость', 'болезнь', 'лечение', 'врач'],
      'личностное развитие': ['цели', 'мечты', 'планы', 'развитие', 'успех', 'неудача']
    };
    
    const foundThemes = [];
    for (const [theme, keywords] of Object.entries(themes)) {
      if (keywords.some(keyword => content.includes(keyword))) {
        foundThemes.push(theme);
      }
    }
    
    return foundThemes.length > 0 ? 
      `обсуждались темы: ${foundThemes.join(', ')}` : 
      'обсуждались различные личные вопросы';
  }
  
  // Extract emotional state from patient messages
  extractEmotions(patientMessages) {
    if (!patientMessages || patientMessages.length === 0) {
      return 'нейтральное';
    }
    
    const content = patientMessages.map(m => m.content).join(' ').toLowerCase();
    
    const emotions = {
      'тревожное': ['беспокоюсь', 'тревожно', 'страшно', 'волнуюсь', 'нервничаю'],
      'грустное': ['грустно', 'печально', 'расстроен', 'депрессия', 'плохо'],
      'злое': ['злюсь', 'бесит', 'раздражает', 'ненавижу', 'гнев'],
      'позитивное': ['хорошо', 'радуюсь', 'счастлив', 'отлично', 'здорово'],
      'усталое': ['устал', 'выматывает', 'измотан', 'нет сил']
    };
    
    for (const [emotion, keywords] of Object.entries(emotions)) {
      if (keywords.some(keyword => content.includes(keyword))) {
        return emotion;
      }
    }
    
    return 'смешанное';
  }

  // Save conversation to database (separate from caching)
  async saveConversationToDB(sessionId, messages, response, metadata = {}) {
    try {
      const conversationData = {
        session_id: sessionId,
        messages: JSON.stringify(messages),
        response_content: response.content,
        model_used: response.model,
        tokens_input: response.usage?.input_tokens || 0,
        tokens_output: response.usage?.output_tokens || 0,
        cache_read_tokens: response.usage?.cache_read_input_tokens || 0,
        cache_creation_tokens: response.usage?.cache_creation_input_tokens || 0,
        response_time: metadata.responseTime || 0,
        created_at: new Date().toISOString()
      };
      
      await dbManager.run(`
        INSERT INTO conversation_history 
        (session_id, messages, response_content, model_used, tokens_input, tokens_output, 
         cache_read_tokens, cache_creation_tokens, response_time, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [conversationData.session_id, conversationData.messages, conversationData.response_content,
         conversationData.model_used, conversationData.tokens_input, conversationData.tokens_output,
         conversationData.cache_read_tokens, conversationData.cache_creation_tokens, 
         conversationData.response_time, conversationData.created_at]);
      
      logger.info('Conversation saved to database', { 
        sessionId, 
        messageCount: messages.length,
        tokens: conversationData.tokens_input + conversationData.tokens_output
      });
      
    } catch (error) {
      logger.error('Error saving conversation to database', { 
        error: error.message, 
        sessionId 
      });
    }
  }
  
  // Load conversation history from database
  async loadConversationFromDB(sessionId, limit = 50) {
    try {
      const conversations = await dbManager.all(`
        SELECT messages, response_content, created_at
        FROM conversation_history 
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `, [sessionId, limit]);
      
      const fullHistory = [];
      conversations.reverse().forEach(conv => {
        const messages = JSON.parse(conv.messages);
        fullHistory.push(...messages);
        fullHistory.push({
          role: 'assistant',
          content: conv.response_content
        });
      });
      
      logger.info('Conversation loaded from database', { 
        sessionId, 
        totalMessages: fullHistory.length 
      });
      
      return fullHistory;
      
    } catch (error) {
      logger.error('Error loading conversation from database', { 
        error: error.message, 
        sessionId 
      });
      return [];
    }
  }

  // Check if we can use cached response (DEPRECATED - keep for compatibility)
  getCachedResponse(cacheKey) {
    // NOTE: Local caching disabled in favor of Anthropic prompt caching
    // This method kept for compatibility but always returns null
    logger.info('Local cache check skipped - using Anthropic caching only');
    return null;
  }

  // Store response in cache (DEPRECATED - kept for compatibility)
  cacheResponse(cacheKey, promptHash, response, cacheType = 'conversation') {
    // NOTE: Local response caching disabled in favor of Anthropic prompt caching
    // Data persistence handled by saveConversationToDB() method
    logger.info('Local response caching skipped - using database persistence only');
  }

  // Rate limiting check
  checkRateLimit(userId) {
    const now = Date.now();
    const userRequests = this.rateLimiter.get(userId) || [];
    
    // Clean old requests (older than window)
    const validRequests = userRequests.filter(
      timestamp => now - timestamp < config.security.rateLimit.windowMs
    );
    
    if (validRequests.length >= config.security.rateLimit.maxRequests) {
      return false;
    }
    
    validRequests.push(now);
    this.rateLimiter.set(userId, validRequests);
    return true;
  }

  // Main method to send message to Claude
  async sendMessage(messages, systemPrompt = null, options = {}) {
    const startTime = Date.now();
    const {
      userId = null,
      cacheType = 'conversation',
      enableCache = true,
      maxTokens = config.anthropic.maxTokens,
      temperature = config.anthropic.temperature
    } = options;

    try {
      // Rate limiting check
      if (userId && !this.checkRateLimit(userId)) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }

      // Skip local cache check - using only Anthropic caching now
      // Database saving for persistence will happen after API call

      // Build request with smart caching
      const { system, messages: processedMessages } = this.buildMessagesWithCache(messages, systemPrompt, options);

      // Build request parameters
      const requestParams = {
        model: config.anthropic.model,
        max_tokens: maxTokens,
        temperature: temperature,
        messages: processedMessages
      };

      // Add system prompt with caching
      if (system) {
        requestParams.system = system;
      }

      // Send request to Claude API with prompt caching header
      logger.info('Sending request to Claude API', {
        model: config.anthropic.model,
        messageCount: (processedMessages || []).length,
        hasSystemPrompt: !!system,
        userId,
        hasCacheControl: system?.[0]?.cache_control || (processedMessages || []).some(m => m.cache_control),
        systemPromptPreview: system?.[0]?.text ? system[0].text.substring(0, 100) + '...' : 'none',
        requestStructure: {
          systemHasCacheControl: !!system?.[0]?.cache_control,
          messagesWithCache: (processedMessages || []).filter(m => m.cache_control).length
        }
      });

      // DEBUG: Log full request structure (for debugging)
      if (config.app.isDevelopment) {
        logger.info('Full request structure', {
          system: system?.map(s => ({ 
            type: s?.type || 'unknown', 
            hasCache: !!(s?.cache_control),
            textLength: s?.text?.length || 0
          })) || [],
          messages: (processedMessages || []).map((m, i) => ({ 
            index: i, 
            role: m?.role || 'unknown', 
            hasCache: !!(m?.cache_control),
            contentLength: m?.content?.length || 0
          }))
        });
      }

      const response = await this.client.messages.create(requestParams, {
        headers: {
          'anthropic-beta': 'prompt-caching-2024-07-31'
        }
      });
      
      const responseTime = Date.now() - startTime;
      
      logger.info('Claude API response received', {
        responseTime,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
        cacheCreationTokens: response.usage?.cache_creation_input_tokens || 0,
        cacheReadTokens: response.usage?.cache_read_input_tokens || 0,
        model: response.model,
        cacheHit: (response.usage?.cache_read_input_tokens || 0) > 0,
        cacheCreated: (response.usage?.cache_creation_input_tokens || 0) > 0
      });

      // Save conversation to database for persistence and research
      if (options.sessionId) {
        await this.saveConversationToDB(options.sessionId, messages, {
          content: response.content?.[0]?.text || '',
          model: response.model,
          usage: response.usage
        }, { responseTime });
      }

      // Record performance metrics
      await this.recordMetrics(response, responseTime);

      return {
        content: response.content?.[0]?.text || '',
        usage: response.usage,
        model: response.model,
        fromCache: false,
        responseTime,
        cacheEfficiency: {
          cacheHit: (response.usage?.cache_read_input_tokens || 0) > 0,
          cacheCreated: (response.usage?.cache_creation_input_tokens || 0) > 0,
          tokensFromCache: response.usage?.cache_read_input_tokens || 0,
          tokensToCache: response.usage?.cache_creation_input_tokens || 0
        }
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      logger.error('Claude API error', {
        error: error.message,
        responseTime,
        userId,
        messageCount: messages.length
      });

      // Handle specific error types
      if (error.status === 429) {
        throw new Error('API rate limit exceeded. Please try again in a moment.');
      } else if (error.status === 401) {
        throw new Error('API authentication failed. Please check configuration.');
      } else if (error.status >= 500) {
        throw new Error('Claude API service temporarily unavailable. Please try again.');
      }

      throw new Error(`Claude API error: ${error.message}`);
    }
  }

  // Record performance metrics
  async recordMetrics(response, responseTime) {
    try {
      const metrics = [
        { name: 'claude_api_response_time', value: responseTime, unit: 'ms' },
        { name: 'claude_api_input_tokens', value: response.usage?.input_tokens || 0, unit: 'tokens' },
        { name: 'claude_api_output_tokens', value: response.usage?.output_tokens || 0, unit: 'tokens' },
        { name: 'claude_api_total_tokens', value: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0), unit: 'tokens' },
        { name: 'claude_cache_creation_tokens', value: response.usage?.cache_creation_input_tokens || 0, unit: 'tokens' },
        { name: 'claude_cache_read_tokens', value: response.usage?.cache_read_input_tokens || 0, unit: 'tokens' },
        { name: 'claude_cache_hits', value: (response.usage?.cache_read_input_tokens || 0) > 0 ? 1 : 0, unit: 'count' }
      ];

      // Insert metrics one by one since we don't have transaction support yet
      for (const metric of metrics) {
        await dbManager.run(`
          INSERT INTO performance_metrics (metric_name, metric_value, metric_unit, recorded_at)
          VALUES (?, ?, ?, datetime('now'))
        `, [metric.name, metric.value, metric.unit]);
      }
    } catch (error) {
      logger.error('Error recording metrics', { error: error.message });
    }
  }

  // Get cache statistics
  async getCacheStats() {
    try {
      const stats = await dbManager.all(`
        SELECT 
          cache_type,
          COUNT(*) as total_entries,
          SUM(hit_count) as total_hits,
          AVG(tokens_input + tokens_output) as avg_tokens,
          COUNT(CASE WHEN expires_at > datetime('now') THEN 1 END) as active_entries
        FROM claude_cache
        GROUP BY cache_type
      `);

      const totalStats = await dbManager.get(`
        SELECT 
          COUNT(*) as total_cache_entries,
          SUM(hit_count) as total_cache_hits,
          SUM(tokens_input + tokens_output) as total_tokens_saved
        FROM claude_cache
        WHERE expires_at > datetime('now')
      `);

      return {
        byType: stats,
        total: totalStats
      };
    } catch (error) {
      logger.error('Error getting cache stats', { error: error.message });
      return null;
    }
  }

  // Preload cache with common patient patterns and system prompts
  async preloadCache(systemPrompts = [], commonPatterns = []) {
    try {
      logger.info('Starting cache preload', { 
        systemPromptCount: systemPrompts.length,
        patternCount: commonPatterns.length 
      });

      const preloadResults = {
        systemPrompts: 0,
        patterns: 0,
        errors: 0
      };

      // Preload system prompts
      for (const prompt of systemPrompts) {
        try {
          const messages = [{ role: 'user', content: 'Ready to begin session.' }];
          const cacheKey = this.generateCacheKey(messages, prompt, 'preload_system');
          
          // Check if already cached
          if (!this.getCachedResponse(cacheKey)) {
            await this.sendMessage(messages, prompt, {
              userId: 'system',
              cacheType: 'preload_system',
              enableCache: true
            });
            preloadResults.systemPrompts++;
          }
        } catch (error) {
          logger.error('Error preloading system prompt', { error: error.message });
          preloadResults.errors++;
        }
      }

      // Preload common interaction patterns
      for (const pattern of commonPatterns) {
        try {
          const messages = [
            { role: 'user', content: pattern.therapistMessage || 'Hello, how are you feeling today?' },
            { role: 'assistant', content: pattern.expectedResponse || 'I appreciate you asking...' }
          ];
          const cacheKey = this.generateCacheKey(messages, pattern.systemPrompt, 'preload_pattern');
          
          // Check if already cached
          if (!this.getCachedResponse(cacheKey)) {
            await this.sendMessage(messages, pattern.systemPrompt, {
              userId: 'system',
              cacheType: 'preload_pattern',
              enableCache: true
            });
            preloadResults.patterns++;
          }
        } catch (error) {
          logger.error('Error preloading pattern', { error: error.message });
          preloadResults.errors++;
        }
      }

      logger.info('Cache preload completed', preloadResults);
      return preloadResults;

    } catch (error) {
      logger.error('Error during cache preload', { error: error.message });
      throw error;
    }
  }

  // Preload cache with patient-specific content for anticipated responses
  async preloadPatientCache(patientProfile, commonScenarios = []) {
    try {
      logger.info('Preloading patient-specific cache', { 
        patientId: patientProfile.id,
        scenarioCount: commonScenarios.length 
      });

      const results = { scenarios: 0, errors: 0 };

      for (const scenario of commonScenarios) {
        try {
          const messages = [
            { role: 'user', content: scenario.trigger || 'How are you doing today?' }
          ];
          
          const cacheKey = this.generateCacheKey(
            messages, 
            patientProfile.system_prompt, 
            'preload_patient'
          );
          
          if (!this.getCachedResponse(cacheKey)) {
            await this.sendMessage(messages, patientProfile.system_prompt, {
              userId: 'system',
              cacheType: 'preload_patient',
              enableCache: true
            });
            results.scenarios++;
          }
        } catch (error) {
          logger.error('Error preloading patient scenario', { 
            error: error.message,
            patientId: patientProfile.id 
          });
          results.errors++;
        }
      }

      logger.info('Patient cache preload completed', { 
        patientId: patientProfile.id,
        ...results 
      });
      return results;

    } catch (error) {
      logger.error('Error during patient cache preload', { error: error.message });
      throw error;
    }
  }

  // Get cache preload recommendations based on usage patterns
  async getCachePreloadRecommendations() {
    try {
      // Get most frequently used system prompts
      const frequentPrompts = await dbManager.all(`
        SELECT prompt_hash, COUNT(*) as usage_count
        FROM claude_cache 
        WHERE cache_type IN ('conversation', 'analysis')
        AND created_at > datetime('now', '-7 days')
        GROUP BY prompt_hash
        ORDER BY usage_count DESC
        LIMIT 10
      `);

      // Get most common interaction patterns
      const commonPatterns = await dbManager.all(`
        SELECT cache_key, response_content, hit_count
        FROM claude_cache 
        WHERE cache_type = 'conversation'
        AND hit_count > 1
        ORDER BY hit_count DESC
        LIMIT 20
      `);

      return {
        frequentPrompts,
        commonPatterns,
        recommendation: {
          shouldPreload: frequentPrompts.length > 0 || commonPatterns.length > 0,
          priority: frequentPrompts.length > 5 ? 'high' : 'medium'
        }
      };

    } catch (error) {
      logger.error('Error getting preload recommendations', { error: error.message });
      return { frequentPrompts: [], commonPatterns: [], recommendation: { shouldPreload: false } };
    }
  }

  // Clean up rate limiter periodically
  cleanupRateLimiter() {
    const now = Date.now();
    for (const [userId, requests] of this.rateLimiter.entries()) {
      const validRequests = requests.filter(
        timestamp => now - timestamp < config.security.rateLimit.windowMs
      );
      
      if (validRequests.length === 0) {
        this.rateLimiter.delete(userId);
      } else {
        this.rateLimiter.set(userId, validRequests);
      }
    }
  }
}

// Export class for creating instances
export { ClaudeService };

// Setup singleton instance
const claudeService = new ClaudeService();

// Clean up rate limiter every 5 minutes
setInterval(() => {
  claudeService.cleanupRateLimiter();
}, 5 * 60 * 1000);

export default claudeService;
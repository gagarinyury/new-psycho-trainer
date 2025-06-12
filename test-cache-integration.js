#!/usr/bin/env node

/**
 * 🧪 Тестирование интеграции кеширования
 * Проверяет работу всех уровней кеша: Anthropic + наш + БД
 */

import claudeService from './src/services/ClaudeService.js';
import dbManager from './src/database/Database.js';
import dotenv from 'dotenv';

dotenv.config();

class CacheIntegrationTest {
  constructor() {
    this.claudeService = claudeService;
    this.testResults = [];
  }

  async init() {
    console.log('🔄 Инициализация базы данных...');
    await dbManager.initialize();
    console.log('✅ База данных готова');
  }

  log(message, data = {}) {
    console.log(`🔍 ${message}`, data);
    this.testResults.push({ message, data, timestamp: new Date() });
  }

  async runAllTests() {
    console.log('\n🚀 ТЕСТИРОВАНИЕ ИНТЕГРАЦИИ КЕШИРОВАНИЯ\n');

    await this.init();

    // Тест 1: Первый запрос (создание всех кешей)
    await this.testFirstRequest();
    
    // Тест 2: Повторный запрос (использование нашего кеша)
    await this.testOurCacheHit();
    
    // Тест 3: Новая сессия с тем же пациентом
    await this.testNewSessionSamePatient();
    
    // Тест 4: Статистика кеша
    await this.testCacheStats();
    
    // Тест 5: Производительность
    await this.testPerformance();
    
    this.printSummary();
  }

  async testFirstRequest() {
    this.log('\n=== ТЕСТ 1: Первый запрос (создание кешей) ===');
    
    const systemPrompt = `Ты играешь роль пациента Анны, 28 лет, с паническими атаками.
    
ЛИЧНОСТЬ: тревожная, перфекционистка, работает в IT.
ПРОБЛЕМА: панические атаки начались 3 месяца назад после развода.
СИМПТОМЫ: учащенное сердцебиение, потливость, страх потери контроля.
ЦЕЛЬ: научиться справляться с тревогой.

Отвечай как живой человек, не раскрывай сразу все проблемы.`;

    const messages = [
      { role: 'user', content: 'Здравствуйте, расскажите что вас беспокоит?' }
    ];

    const startTime = Date.now();
    
    try {
      const response = await this.claudeService.sendMessage(
        messages, 
        systemPrompt,
        { 
          userId: 1001, 
          cacheType: 'conversation',
          enableCache: true 
        }
      );
      
      const responseTime = Date.now() - startTime;
      
      this.log('✅ Первый запрос выполнен', {
        responseTime: `${responseTime}ms`,
        fromCache: response.fromCache,
        usage: response.usage,
        responseLength: response.content.length,
        responsePreview: response.content.substring(0, 100) + '...'
      });

      // Проверяем что создался кеш в нашей БД
      const cacheStats = this.claudeService.getCacheStats();
      this.log('📊 Статистика кеша после первого запроса', cacheStats);
      
      return response;
      
    } catch (error) {
      this.log('❌ Ошибка первого запроса', { error: error.message });
      throw error;
    }
  }

  async testOurCacheHit() {
    this.log('\n=== ТЕСТ 2: Использование нашего кеша ===');
    
    // Повторяем точно такой же запрос
    const systemPrompt = `Ты играешь роль пациента Анны, 28 лет, с паническими атаками.
    
ЛИЧНОСТЬ: тревожная, перфекционистка, работает в IT.
ПРОБЛЕМА: панические атаки начались 3 месяца назад после развода.
СИМПТОМЫ: учащенное сердцебиение, потливость, страх потери контроля.
ЦЕЛЬ: научиться справляться с тревогой.

Отвечай как живой человек, не раскрывай сразу все проблемы.`;

    const messages = [
      { role: 'user', content: 'Здравствуйте, расскажите что вас беспокоит?' }
    ];

    const startTime = Date.now();
    
    try {
      const response = await this.claudeService.sendMessage(
        messages, 
        systemPrompt,
        { 
          userId: 1001, 
          cacheType: 'conversation',
          enableCache: true 
        }
      );
      
      const responseTime = Date.now() - startTime;
      
      this.log('✅ Повторный запрос выполнен', {
        responseTime: `${responseTime}ms`,
        fromCache: response.fromCache,
        cacheHit: response.fromCache === true,
        responseLength: response.content.length
      });

      if (response.fromCache) {
        this.log('🎉 НАШ КЕШ РАБОТАЕТ!', { 
          speedup: 'Мгновенный ответ',
          apiCallsSaved: 1
        });
      } else {
        this.log('⚠️ Кеш не сработал', { reason: 'Возможно другой cache key' });
      }
      
    } catch (error) {
      this.log('❌ Ошибка повторного запроса', { error: error.message });
    }
  }

  async testNewSessionSamePatient() {
    this.log('\n=== ТЕСТ 3: Новая сессия с тем же пациентом ===');
    
    const systemPrompt = `Ты играешь роль пациента Анны, 28 лет, с паническими атаками.
    
ЛИЧНОСТЬ: тревожная, перфекционистка, работает в IT.
ПРОБЛЕМА: панические атаки начались 3 месяца назад после развода.
СИМПТОМЫ: учащенное сердцебиение, потливость, страх потери контроля.
ЦЕЛЬ: научиться справляться с тревогой.

Отвечай как живой человек, не раскрывай сразу все проблемы.`;

    const messages = [
      { role: 'user', content: 'Здравствуйте, расскажите что вас беспокоит?' },
      { role: 'assistant', content: 'Здравствуйте... *нервно* У меня последнее время такие странные приступы случаются на работе.' },
      { role: 'user', content: 'Расскажите подробнее об этих приступах.' }
    ];

    const startTime = Date.now();
    
    try {
      const response = await this.claudeService.sendMessage(
        messages, 
        systemPrompt,
        { 
          userId: 1001, 
          cacheType: 'conversation',
          enableCache: true 
        }
      );
      
      const responseTime = Date.now() - startTime;
      
      this.log('✅ Продолжение сессии выполнено', {
        responseTime: `${responseTime}ms`,
        fromCache: response.fromCache,
        messageCount: messages.length,
        responsePreview: response.content.substring(0, 100) + '...'
      });
      
    } catch (error) {
      this.log('❌ Ошибка продолжения сессии', { error: error.message });
    }
  }

  async testCacheStats() {
    this.log('\n=== ТЕСТ 4: Статистика кеша ===');
    
    try {
      const stats = this.claudeService.getCacheStats();
      
      this.log('📊 Полная статистика кеша', stats);
      
      // Проверяем статистику БД
      const dbStats = dbManager.getStats();
      this.log('💾 Статистика базы данных', dbStats);
      
    } catch (error) {
      this.log('❌ Ошибка получения статистики', { error: error.message });
    }
  }

  async testPerformance() {
    this.log('\n=== ТЕСТ 5: Тест производительности ===');
    
    const systemPrompt = 'Ты психотерапевт. Отвечай профессионально и кратко.';
    const testMessages = [
      'Как дела?',
      'Что беспокоит?',
      'Расскажите больше.',
      'Понятно.',
      'Что дальше?'
    ];

    const results = [];
    
    for (let i = 0; i < testMessages.length; i++) {
      const startTime = Date.now();
      
      try {
        const response = await this.claudeService.sendMessage(
          [{ role: 'user', content: testMessages[i] }],
          systemPrompt,
          { 
            userId: 1002 + i, // разные пользователи
            cacheType: 'conversation',
            enableCache: true 
          }
        );
        
        const responseTime = Date.now() - startTime;
        
        results.push({
          message: testMessages[i],
          responseTime,
          fromCache: response.fromCache,
          responseLength: response.content.length
        });
        
        this.log(`⚡ Запрос ${i+1}/${testMessages.length}`, {
          message: testMessages[i],
          responseTime: `${responseTime}ms`,
          cached: response.fromCache
        });
        
        // Небольшая пауза между запросами
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        this.log(`❌ Ошибка в запросе ${i+1}`, { error: error.message });
      }
    }
    
    // Анализ производительности
    const avgTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;
    const cacheHits = results.filter(r => r.fromCache).length;
    
    this.log('📈 Результаты производительности', {
      totalRequests: results.length,
      averageTime: `${Math.round(avgTime)}ms`,
      cacheHitRate: `${Math.round(cacheHits / results.length * 100)}%`,
      fastestRequest: `${Math.min(...results.map(r => r.responseTime))}ms`,
      slowestRequest: `${Math.max(...results.map(r => r.responseTime))}ms`
    });
  }

  printSummary() {
    console.log('\n📊 ИТОГОВЫЙ ОТЧЕТ ИНТЕГРАЦИОННОГО ТЕСТИРОВАНИЯ:\n');
    
    const totalTests = this.testResults.length;
    const errors = this.testResults.filter(r => r.message.includes('❌')).length;
    const successes = totalTests - errors;
    
    console.log(`✅ Успешных тестов: ${successes}/${totalTests}`);
    console.log(`❌ Ошибок: ${errors}`);
    console.log(`📈 Процент успеха: ${Math.round(successes/totalTests*100)}%`);
    
    // Статистика по кешированию
    const cacheTests = this.testResults.filter(r => r.data.fromCache !== undefined);
    const cacheHits = cacheTests.filter(r => r.data.fromCache === true).length;
    
    if (cacheTests.length > 0) {
      console.log(`🎯 Попаданий в кеш: ${cacheHits}/${cacheTests.length}`);
      console.log(`📊 Эффективность кеша: ${Math.round(cacheHits/cacheTests.length*100)}%`);
    }
    
    // Статистика по времени ответа
    const timeTests = this.testResults.filter(r => r.data.responseTime);
    if (timeTests.length > 0) {
      const times = timeTests.map(r => parseInt(r.data.responseTime));
      console.log(`⚡ Среднее время ответа: ${Math.round(times.reduce((a,b) => a+b, 0)/times.length)}ms`);
    }
    
    console.log('\n🎉 Интеграционное тестирование завершено!');
  }
}

// Запуск тестов
async function runIntegrationTests() {
  const tester = new CacheIntegrationTest();
  
  try {
    await tester.runAllTests();
  } catch (error) {
    console.error('💥 Критическая ошибка интеграционного тестирования:', error);
    process.exit(1);
  } finally {
    await dbManager.close();
  }
}

// Запускаем если файл вызван напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
  runIntegrationTests();
}

export default CacheIntegrationTest;
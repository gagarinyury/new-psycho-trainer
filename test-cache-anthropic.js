#!/usr/bin/env node

/**
 * 🧪 Тестирование Anthropic Prompt Caching
 * Проверяет работу официального кеширования Claude API
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

class AnthropicCacheTest {
  constructor() {
    this.testResults = [];
  }

  log(message, data = {}) {
    console.log(`🔍 ${message}`, data);
    this.testResults.push({ message, data, timestamp: new Date() });
  }

  async testPromptCaching() {
    console.log('\n🚀 ТЕСТИРОВАНИЕ ANTHROPIC PROMPT CACHING\n');

    // Создаем длинный system prompt (>1024 токенов)
    const longSystemPrompt = this.createLongSystemPrompt();
    
    this.log('Создан system prompt', { 
      length: longSystemPrompt.length,
      estimatedTokens: Math.ceil(longSystemPrompt.length / 4)
    });

    // Тест 1: Первый запрос (создание кеша)
    await this.testCacheCreation(longSystemPrompt);
    
    // Тест 2: Второй запрос сразу (использование кеша)
    await this.testCacheHit(longSystemPrompt);
    
    // Тест 3: Ждем 6 минут и проверяем expiry
    // await this.testCacheExpiry(longSystemPrompt);
    
    // Тест 4: Разные сообщения с одним system prompt
    await this.testMultipleMessages(longSystemPrompt);
    
    this.printSummary();
  }

  createLongSystemPrompt() {
    return `Ты играешь роль клиента на психотерапевтической сессии. Вот твоя детальная личность и ситуация:

ОСНОВНАЯ ИНФОРМАЦИЯ:
- Имя: Мария Владимировна Петрова
- Возраст: 32 года
- Пол: женский
- Профессия: менеджер по продажам в IT компании
- Семейное положение: в разводе, есть дочь 8 лет

БИОГРАФИЯ И КОНТЕКСТ:
Выросла в полной семье среднего класса в Москве. Отец - инженер, строгий и требовательный. Мать - учительница, эмоционально холодная. С детства была отличницей, стремилась соответствовать высоким ожиданиям родителей. В университете изучала экономику, работала с первого курса. Вышла замуж в 24 года за однокурсника, родила дочь в 25. Развелась год назад из-за измены мужа.

ЛИЧНОСТНЫЕ ОСОБЕННОСТИ:
- Основные черты: перфекционистка, тревожная, ответственная, склонная к самокритике
- Стиль общения: вежливый, но сдержанный, избегает конфликтов
- Защитные механизмы: рационализация, интеллектуализация, подавление эмоций
- Триггеры: критика, конфликты, неопределенность, финансовые проблемы
- Сильные стороны: организованность, целеустремленность, забота о других

ПСИХОЛОГИЧЕСКИЙ ПРОФИЛЬ:
- Основная проблема: панические атаки на работе и проблемы со сном
- Симптомы: учащенное сердцебиение, потливость, чувство нехватки воздуха, бессонница
- Длительность проблемы: 6 месяцев (началось после развода)
- Тяжесть: умеренная, влияет на работоспособность
- Предыдущая терапия: нет опыта, скептически относится к психологии
- Мотивация: высокая, хочет "взять себя в руки" ради дочери

ЦЕЛИ ТЕРАПИИ:
- Основная цель: научиться справляться с паническими атаками
- Вторичные цели: улучшить сон, повысить уверенность в себе, наладить отношения с дочерью
- Ожидания от терапии: получить практические техники, "не копаться в прошлом"

ПАТТЕРНЫ ВЗАИМОДЕЙСТВИЯ:
- Типичные ответы: подробные, структурированные, с примерами из жизни
- Паттерны сопротивления: интеллектуализация проблем, избегание эмоциональных тем
- Стиль вовлечения: активный, но осторожный, задает много уточняющих вопросов

ПРАВИЛА ПОВЕДЕНИЯ В РОЛИ:
1. Отвечай как живой человек с этой конкретной историей и характером
2. Будь естественной и непредсказуемой в рамках описанной личности
3. Используй защитные механизмы когда чувствуешь эмоциональное напряжение
4. Показывай эмоции и реакции соответственно ситуации
5. Не давай готовые психологические инсайты - исследуй тему постепенно
6. Иногда сопротивляйся или отвлекайся на другие темы
7. Будь человечной с противоречиями и сложностями
8. Говори на русском языке естественно
9. Не раскрывай сразу всю информацию о себе - делай это постепенно
10. Реагируй на стиль терапевта и подстраивайся под его подход

Начинай каждую сессию с того места, где закончилась предыдущая. Если это первая встреча, можешь быть немного настороженной, но любопытной к процессу терапии.`;
  }

  async testCacheCreation(systemPrompt) {
    this.log('\n=== ТЕСТ 1: Создание кеша ===');
    
    const startTime = Date.now();
    
    try {
      const response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 500,
        system: [{
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' }
        }],
        messages: [{
          role: 'user',
          content: 'Здравствуйте, меня зовут Анна. Я ваш терапевт. Расскажите, что вас привело ко мне?'
        }]
      });
      
      const responseTime = Date.now() - startTime;
      
      this.log('✅ Первый запрос успешен', {
        responseTime: `${responseTime}ms`,
        usage: response.usage,
        cacheCreated: response.usage?.cache_creation_input_tokens > 0,
        cacheRead: response.usage?.cache_read_input_tokens > 0,
        responsePreview: response.content[0]?.text?.substring(0, 100) + '...'
      });
      
      return response;
      
    } catch (error) {
      this.log('❌ Ошибка при создании кеша', { error: error.message });
      throw error;
    }
  }

  async testCacheHit(systemPrompt) {
    this.log('\n=== ТЕСТ 2: Использование кеша (сразу) ===');
    
    // Ждем 1 секунду чтобы симулировать реальное использование
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const startTime = Date.now();
    
    try {
      const response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 500,
        system: [{
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' }
        }],
        messages: [
          {
            role: 'user',
            content: 'Здравствуйте, меня зовут Анна. Я ваш терапевт. Расскажите, что вас привело ко мне?'
          },
          {
            role: 'assistant', 
            content: 'Здравствуйте, Анна... *немного напряженно* Честно говоря, я не очень понимаю, как это работает. У меня последнее время... ну, проблемы какие-то начались на работе. Панические атаки называются, как мне сказали.',
            cache_control: { type: 'ephemeral' }
          },
          {
            role: 'user',
            content: 'Понимаю. Расскажите подробнее о этих панических атаках - когда они начались?'
          }
        ]
      });
      
      const responseTime = Date.now() - startTime;
      
      this.log('✅ Второй запрос успешен', {
        responseTime: `${responseTime}ms`,
        usage: response.usage,
        cacheCreated: response.usage?.cache_creation_input_tokens > 0,
        cacheRead: response.usage?.cache_read_input_tokens > 0,
        tokensSaved: response.usage?.cache_read_input_tokens || 0,
        responsePreview: response.content[0]?.text?.substring(0, 100) + '...'
      });
      
      // Проверяем что кеш действительно использовался
      if (response.usage?.cache_read_input_tokens > 0) {
        this.log('🎉 КЕШИРОВАНИЕ РАБОТАЕТ!', {
          savedTokens: response.usage.cache_read_input_tokens,
          estimatedSavings: `$${(response.usage.cache_read_input_tokens * 0.003 * 0.9 / 1000).toFixed(4)}`
        });
      } else {
        this.log('⚠️ Кеш не использовался', { reason: 'Возможно промпт слишком короткий' });
      }
      
      return response;
      
    } catch (error) {
      this.log('❌ Ошибка при использовании кеша', { error: error.message });
      throw error;
    }
  }

  async testCacheExpiry(systemPrompt) {
    this.log('\n=== ТЕСТ 3: Проверка истечения кеша (6 минут) ===');
    this.log('⏰ Ждем 6 минут для истечения кеша...');
    
    // Ждем 6 минут (360 секунд)
    for (let i = 360; i > 0; i -= 30) {
      process.stdout.write(`\r⏱️  Осталось: ${Math.floor(i/60)}:${(i%60).toString().padStart(2, '0')}`);
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
    console.log('\n');
    
    const startTime = Date.now();
    
    try {
      const response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 500,
        system: [{
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' }
        }],
        messages: [{
          role: 'user',
          content: 'Как дела сейчас? (тест после 6 минут)'
        }]
      });
      
      const responseTime = Date.now() - startTime;
      
      this.log('✅ Запрос после 6 минут успешен', {
        responseTime: `${responseTime}ms`,
        usage: response.usage,
        cacheRecreated: response.usage?.cache_creation_input_tokens > 0,
        cacheExpired: response.usage?.cache_read_input_tokens === 0
      });
      
      if (response.usage?.cache_creation_input_tokens > 0) {
        this.log('✅ Кеш истек и пересоздался (как и ожидалось)');
      }
      
    } catch (error) {
      this.log('❌ Ошибка при тесте истечения', { error: error.message });
    }
  }

  async testMultipleMessages(systemPrompt) {
    this.log('\n=== ТЕСТ 4: Несколько сообщений с одним промптом ===');
    
    const messages = [
      'Что вас больше всего беспокоит?',
      'Как долго это продолжается?', 
      'Есть ли что-то, что помогает справиться?'
    ];
    
    for (let i = 0; i < messages.length; i++) {
      const startTime = Date.now();
      
      try {
        const response = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 300,
          system: [{
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' }
          }],
          messages: [{
            role: 'user',
            content: messages[i]
          }]
        });
        
        const responseTime = Date.now() - startTime;
        
        this.log(`✅ Сообщение ${i+1} обработано`, {
          message: messages[i],
          responseTime: `${responseTime}ms`,
          cacheHit: response.usage?.cache_read_input_tokens > 0,
          tokensFromCache: response.usage?.cache_read_input_tokens || 0
        });
        
        // Небольшая пауза между запросами
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        this.log(`❌ Ошибка в сообщении ${i+1}`, { error: error.message });
      }
    }
  }

  printSummary() {
    console.log('\n📊 ИТОГОВЫЙ ОТЧЕТ:\n');
    
    const cacheHits = this.testResults.filter(r => r.data.cacheRead > 0).length;
    const totalTests = this.testResults.filter(r => r.data.usage).length;
    
    console.log(`✅ Успешных запросов: ${totalTests}`);
    console.log(`🎯 Попаданий в кеш: ${cacheHits}`);
    console.log(`📈 Эффективность кеша: ${totalTests > 0 ? Math.round(cacheHits/totalTests*100) : 0}%`);
    
    const totalSavedTokens = this.testResults
      .filter(r => r.data.tokensFromCache)
      .reduce((sum, r) => sum + r.data.tokensFromCache, 0);
    
    if (totalSavedTokens > 0) {
      console.log(`💰 Сэкономлено токенов: ${totalSavedTokens}`);
      console.log(`💵 Примерная экономия: $${(totalSavedTokens * 0.003 * 0.9 / 1000).toFixed(4)}`);
    }
    
    console.log('\n📝 Детальные результаты сохранены в testResults массиве');
  }
}

// Запуск тестов
async function runTests() {
  const tester = new AnthropicCacheTest();
  
  try {
    await tester.testPromptCaching();
  } catch (error) {
    console.error('💥 Критическая ошибка тестирования:', error);
    process.exit(1);
  }
}

// Запускаем если файл вызван напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests();
}

export default AnthropicCacheTest;
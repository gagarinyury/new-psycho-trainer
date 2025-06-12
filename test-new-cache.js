#!/usr/bin/env node

/**
 * 🧪 Тест нового умного кеширования
 */

import claudeService from './src/services/ClaudeService.js';
import dbManager from './src/database/Database.js';
import dotenv from 'dotenv';

dotenv.config();

async function testNewCaching() {
  console.log('🚀 ТЕСТИРОВАНИЕ НОВОГО УМНОГО КЕШИРОВАНИЯ\n');

  try {
    // Инициализация
    await dbManager.initialize();

    // Создаем длинный system prompt
    const systemPrompt = `Ты играешь роль пациента Марии Петровой, 32 года, менеджера по продажам.

БИОГРАФИЯ:
Мария работает в крупной IT компании уже 8 лет. Выросла в семье перфекционистов - отец инженер, мать учительница. С детства привыкла быть лучшей во всем. Вышла замуж в 24, родила дочь в 25. Год назад развелась из-за измены мужа.

ЛИЧНОСТЬ:
- Перфекционистка и трудоголик
- Очень ответственная и организованная  
- Склонна к самокритике и тревожности
- Сдержанная в проявлении эмоций
- Боится показаться слабой или некомпетентной

ТЕКУЩИЕ ПРОБЛЕМЫ:
- Панические атаки на работе (начались 6 месяцев назад)
- Бессонница и постоянное чувство усталости
- Трудности в общении с дочерью (8 лет)
- Страх новых отношений
- Перфекционизм мешает делегировать задачи

СИМПТОМЫ ПАНИЧЕСКИХ АТАК:
- Учащенное сердцебиение
- Потливость и дрожь
- Чувство нехватки воздуха
- Страх потери контроля
- Головокружение

ПОВЕДЕНИЕ В ТЕРАПИИ:
- Говорит структурированно и детально
- Часто рационализирует свои проблемы
- Избегает говорить об эмоциях
- Склонна давать "правильные" ответы
- Нуждается в постепенном раскрытии

Отвечай как живой человек с этой историей. Не раскрывай сразу все проблемы.`;

    console.log(`📝 System prompt: ${systemPrompt.length} символов`);

    // Тест 1: Первый запрос (создание кеша)
    console.log('\n1️⃣ Первый запрос (создание кеша)...');
    const start1 = Date.now();

    const response1 = await claudeService.sendMessage(
      [{ role: 'user', content: 'Здравствуйте, меня зовут Анна. Расскажите, что вас беспокоит?' }],
      systemPrompt,
      { 
        userId: 1001, 
        cacheType: 'conversation',
        enableCache: false // Отключаем наш кеш, используем только Anthropic
      }
    );

    const time1 = Date.now() - start1;
    console.log(`✅ Время: ${time1}ms`);
    console.log(`💬 Ответ: ${response1.content.substring(0, 150)}...`);

    // Небольшая пауза
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Тест 2: Продолжение диалога (должен использовать кеш)
    console.log('\n2️⃣ Продолжение диалога (использование кеша)...');
    const start2 = Date.now();

    const response2 = await claudeService.sendMessage(
      [
        { role: 'user', content: 'Здравствуйте, меня зовут Анна. Расскажите, что вас беспокоит?' },
        { role: 'assistant', content: response1.content },
        { role: 'user', content: 'Расскажите подробнее об этих проблемах на работе.' }
      ],
      systemPrompt,
      { 
        userId: 1001, 
        cacheType: 'conversation',
        enableCache: false
      }
    );

    const time2 = Date.now() - start2;
    console.log(`✅ Время: ${time2}ms`);
    console.log(`💬 Ответ: ${response2.content.substring(0, 150)}...`);

    // Тест 3: Еще больше сообщений
    console.log('\n3️⃣ Длинный диалог (максимальное кеширование)...');
    const start3 = Date.now();

    const response3 = await claudeService.sendMessage(
      [
        { role: 'user', content: 'Здравствуйте, меня зовут Анна. Расскажите, что вас беспокоит?' },
        { role: 'assistant', content: response1.content },
        { role: 'user', content: 'Расскажите подробнее об этих проблемах на работе.' },
        { role: 'assistant', content: response2.content },
        { role: 'user', content: 'Когда эти панические атаки начались? Есть ли что-то, что их провоцирует?' }
      ],
      systemPrompt,
      { 
        userId: 1001, 
        cacheType: 'conversation',
        enableCache: false
      }
    );

    const time3 = Date.now() - start3;
    console.log(`✅ Время: ${time3}ms`);
    console.log(`💬 Ответ: ${response3.content.substring(0, 150)}...`);

    // Анализ результатов
    console.log('\n📊 АНАЛИЗ РЕЗУЛЬТАТОВ:');
    console.log(`⚡ Время ответов: ${time1}ms → ${time2}ms → ${time3}ms`);
    
    if (time2 < time1 * 0.8) {
      console.log('🎉 КЕШИРОВАНИЕ РАБОТАЕТ! Ответы стали быстрее');
    }

    // Проверяем метрики
    console.log('\n📈 Проверяем метрики кеширования в БД...');
    
    const cacheMetrics = dbManager.prepare(`
      SELECT metric_name, metric_value, recorded_at
      FROM performance_metrics 
      WHERE metric_name LIKE '%cache%' 
      ORDER BY recorded_at DESC 
      LIMIT 10
    `).all();

    if (cacheMetrics.length > 0) {
      console.log('💾 Метрики кеша:');
      cacheMetrics.forEach(metric => {
        console.log(`  • ${metric.metric_name}: ${metric.metric_value}`);
      });
    } else {
      console.log('⚠️ Метрики кеша не найдены');
    }

  } catch (error) {
    console.error('❌ Ошибка тестирования:', error.message);
    
    if (error.message.includes('anthropic-beta')) {
      console.log('💡 Проблема с beta header для prompt caching');
    }
    if (error.message.includes('cache_control')) {
      console.log('💡 Проблема с параметром cache_control');
    }
  } finally {
    await dbManager.close();
  }
}

// Запуск теста
if (import.meta.url === `file://${process.argv[1]}`) {
  testNewCaching();
}
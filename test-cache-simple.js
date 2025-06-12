#!/usr/bin/env node

/**
 * 🧪 Простой тест кеширования
 * Быстрая проверка работы Anthropic API и кеша
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function simpleTest() {
  console.log('🚀 ПРОСТОЙ ТЕСТ ANTHROPIC API\n');

  // Создаем промпт длиннее 1024 токенов
  const longPrompt = `Ты опытный психотерапевт со стажем 15 лет. Ты специализируешься на когнитивно-поведенческой терапии и работе с тревожными расстройствами. Твоя задача - помочь клиенту понять причины его тревоги и научить практическим техникам справления.

ТВОЙ ПОДХОД:
- Задавай открытые вопросы для исследования проблемы
- Отражай эмоции клиента 
- Предлагай конкретные техники и упражнения
- Будь теплым но профессиональным
- Фокусируйся на настоящем моменте и практических решениях

ТЕХНИКИ КОТОРЫЕ ТЫ ИСПОЛЬЗУЕШЬ:
- Когнитивная реструктуризация (работа с негативными мыслями)
- Техники дыхания и релаксации
- Градуированная экспозиция для фобий
- Майндфулнес и техники заземления
- Поведенческие эксперименты
- Дневники мыслей и эмоций

Отвечай на русском языке, профессионально но доступно.`.repeat(3); // Повторяем 3 раза чтобы точно >1024 токенов

  console.log(`📝 Длина промпта: ${longPrompt.length} символов (~${Math.ceil(longPrompt.length/4)} токенов)`);

  try {
    // Тест 1: Первый запрос
    console.log('\n1️⃣ Первый запрос (создание кеша)...');
    const start1 = Date.now();
    
    const response1 = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 300,
      system: [{
        type: 'text',
        text: longPrompt,
        cache_control: { type: 'ephemeral' }
      }],
      messages: [{
        role: 'user',
        content: 'Здравствуйте, у меня панические атаки на работе. Что делать?'
      }]
    });

    const time1 = Date.now() - start1;
    
    console.log(`✅ Время: ${time1}ms`);
    console.log(`📊 Токены:`, response1.usage);
    console.log(`🆕 Кеш создан:`, response1.usage?.cache_creation_input_tokens > 0);
    console.log(`📖 Кеш прочитан:`, response1.usage?.cache_read_input_tokens > 0);
    console.log(`💬 Ответ: ${response1.content[0]?.text?.substring(0, 150)}...`);

    // Ждем 2 секунды
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Тест 2: Второй запрос (должен использовать кеш)
    console.log('\n2️⃣ Второй запрос (использование кеша)...');
    const start2 = Date.now();
    
    const response2 = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 300,
      system: [{
        type: 'text',
        text: longPrompt, // Тот же промпт
        cache_control: { type: 'ephemeral' }
      }],
      messages: [{
        role: 'user',
        content: 'А как часто такое случается у людей?'
      }]
    });

    const time2 = Date.now() - start2;
    
    console.log(`✅ Время: ${time2}ms`);
    console.log(`📊 Токены:`, response2.usage);
    console.log(`🆕 Кеш создан:`, response2.usage?.cache_creation_input_tokens > 0);
    console.log(`📖 Кеш прочитан:`, response2.usage?.cache_read_input_tokens > 0);
    console.log(`💬 Ответ: ${response2.content[0]?.text?.substring(0, 150)}...`);

    // Анализ результатов
    console.log('\n📊 АНАЛИЗ РЕЗУЛЬТАТОВ:');
    
    if (response2.usage?.cache_read_input_tokens > 0) {
      console.log('🎉 КЕШИРОВАНИЕ РАБОТАЕТ!');
      console.log(`💰 Сэкономлено токенов: ${response2.usage.cache_read_input_tokens}`);
      console.log(`⚡ Ускорение: ${Math.round((time1/time2)*100)}%`);
      
      const savedCost = response2.usage.cache_read_input_tokens * 0.003 * 0.9 / 1000;
      console.log(`💵 Экономия: $${savedCost.toFixed(6)}`);
    } else {
      console.log('❌ Кеш не сработал');
      if (response2.usage?.cache_creation_input_tokens > 0) {
        console.log('⚠️ Кеш пересоздался (возможно истек)');
      }
    }

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    
    if (error.message.includes('cache_control')) {
      console.log('💡 Возможно Prompt Caching недоступен для вашего API ключа');
    }
  }
}

// Запуск теста
if (import.meta.url === `file://${process.argv[1]}`) {
  simpleTest();
}
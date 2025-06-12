#!/usr/bin/env node

/**
 * 🧪 Test the inactivity warning system
 * Tests that inactivity monitoring and warnings work correctly
 */

import sessionService from './src/services/SessionService.js';
import patientService from './src/services/PatientService.js';
import userService from './src/services/UserService.js';
import dbManager from './src/database/Database.js';
import dotenv from 'dotenv';

dotenv.config();

class InactivitySystemTest {
  constructor() {
    this.testResults = [];
    this.mockCallbacks = {
      warnings: [],
      ends: []
    };
  }

  async init() {
    console.log('🔄 Initializing test environment...');
    await dbManager.initialize();
    
    // Set up mock callbacks
    sessionService.setInactivityWarningCallback(async (sessionUuid, userId, session) => {
      this.mockCallbacks.warnings.push({ sessionUuid, userId, session, timestamp: Date.now() });
      console.log(`⚠️ Mock warning callback triggered for session ${sessionUuid}`);
    });

    sessionService.setInactivityEndCallback(async (sessionUuid, userId, session) => {
      this.mockCallbacks.ends.push({ sessionUuid, userId, session, timestamp: Date.now() });
      console.log(`🛑 Mock end callback triggered for session ${sessionUuid}`);
    });

    console.log('✅ Test environment ready');
  }

  async testQuickInactivity() {
    console.log('\n🧪 Testing quick inactivity (5 second warning)...');

    // Temporarily reduce timers for testing
    const originalWarningTime = sessionService.INACTIVITY_WARNING_TIME;
    const originalEndTime = sessionService.INACTIVITY_END_TIME;
    
    sessionService.INACTIVITY_WARNING_TIME = 3000; // 3 seconds
    sessionService.INACTIVITY_END_TIME = 6000; // 6 seconds

    try {
      // Create test user and patient
      const testUser = await userService.registerUser({
        id: 999999,
        first_name: 'Test',
        username: 'test_user'
      });

      console.log('📝 Test user created:', testUser);

      // Create a test patient
      const patient = await patientService.createRandomPatient(testUser.id);
      
      // Create session
      const session = await sessionService.createSession(testUser.id, patient.id);
      console.log(`📝 Created test session: ${session.uuid}`);

      // Wait for warning (should trigger after 3 seconds)
      console.log('⏳ Waiting for inactivity warning...');
      await new Promise(resolve => setTimeout(resolve, 4000));

      // Check if warning was triggered
      const warningTriggered = this.mockCallbacks.warnings.some(w => w.sessionUuid === session.uuid);
      console.log(`⚠️ Warning triggered: ${warningTriggered ? '✅' : '❌'}`);

      // Test continue session
      if (warningTriggered) {
        console.log('🔄 Testing continue session...');
        const continued = await sessionService.handleContinueSession(session.uuid);
        console.log(`✅ Continue session: ${continued ? '✅' : '❌'}`);
      }

      // Wait for end (should not trigger if continued)
      console.log('⏳ Waiting to see if session ends...');
      await new Promise(resolve => setTimeout(resolve, 4000));

      const endTriggered = this.mockCallbacks.ends.some(e => e.sessionUuid === session.uuid);
      console.log(`🛑 End triggered: ${endTriggered ? 'Yes (unexpected)' : 'No (expected)'}`);

      // Clean up
      if (sessionService.activeSessions.has(session.uuid)) {
        await sessionService.endSession(session.uuid, 'Test cleanup');
      }

      return { warningTriggered, endTriggered: !endTriggered }; // Success if end was NOT triggered

    } finally {
      // Restore original timers
      sessionService.INACTIVITY_WARNING_TIME = originalWarningTime;
      sessionService.INACTIVITY_END_TIME = originalEndTime;
    }
  }

  async testPauseSession() {
    console.log('\n🧪 Testing pause session functionality...');

    try {
      const testUser = await userService.registerUser({
        id: 999998,
        first_name: 'Test2',
        username: 'test_user2'
      });

      const patient = await patientService.createRandomPatient(testUser.id);
      const session = await sessionService.createSession(testUser.id, patient.id);

      console.log(`📝 Created test session: ${session.uuid}`);

      // Test pause
      const paused = await sessionService.handlePauseSession(session.uuid, 5000); // 5 second pause
      console.log(`⏸️ Pause session: ${paused ? '✅' : '❌'}`);

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Clean up
      if (sessionService.activeSessions.has(session.uuid)) {
        await sessionService.endSession(session.uuid, 'Test cleanup');
      }

      return { paused };

    } catch (error) {
      console.error('❌ Error in pause test:', error.message);
      return { paused: false, error: error.message };
    }
  }

  async testCachePreloading() {
    console.log('\n🧪 Testing cache preloading...');

    try {
      // Import claudeService
      const { default: claudeService } = await import('./src/services/ClaudeService.js');

      // Test preload recommendations
      const recommendations = claudeService.getCachePreloadRecommendations();
      console.log('📊 Preload recommendations:', recommendations);

      // Test basic preload
      const systemPrompts = [
        'You are a helpful assistant.',
        'You are a therapist helping patients.'
      ];

      const commonPatterns = [
        {
          therapistMessage: 'How are you feeling today?',
          expectedResponse: 'I am feeling okay.',
          systemPrompt: 'You are a helpful patient.'
        }
      ];

      const preloadResult = await claudeService.preloadCache(systemPrompts, commonPatterns);
      console.log('🔄 Preload result:', preloadResult);

      return { 
        preloadWorking: true, 
        recommendationsFound: recommendations.recommendation.shouldPreload,
        preloadResult 
      };

    } catch (error) {
      console.error('❌ Error in cache preload test:', error.message);
      return { preloadWorking: false, error: error.message };
    }
  }

  async runAllTests() {
    console.log('🚀 INACTIVITY SYSTEM INTEGRATION TEST\n');

    await this.init();

    // Test 1: Quick inactivity
    const inactivityResult = await this.testQuickInactivity();

    // Test 2: Pause functionality
    const pauseResult = await this.testPauseSession();

    // Test 3: Cache preloading
    const cacheResult = await this.testCachePreloading();

    // Summary
    console.log('\n📊 TEST SUMMARY:');
    console.log('================');
    console.log(`Inactivity Warning: ${inactivityResult.warningTriggered ? '✅' : '❌'}`);
    console.log(`Continue Session: ${inactivityResult.endTriggered ? '✅' : '❌'}`);
    console.log(`Pause Session: ${pauseResult.paused ? '✅' : '❌'}`);
    console.log(`Cache Preload: ${cacheResult.preloadWorking ? '✅' : '❌'}`);

    const totalTests = 4;
    const passedTests = [
      inactivityResult.warningTriggered,
      inactivityResult.endTriggered,
      pauseResult.paused,
      cacheResult.preloadWorking
    ].filter(Boolean).length;

    console.log(`\n🎯 Overall: ${passedTests}/${totalTests} tests passed (${Math.round(passedTests/totalTests*100)}%)`);

    if (passedTests === totalTests) {
      console.log('🎉 All inactivity system features working correctly!');
    } else {
      console.log('⚠️ Some features need attention.');
    }

    return {
      totalTests,
      passedTests,
      successRate: passedTests / totalTests,
      details: {
        inactivity: inactivityResult,
        pause: pauseResult,
        cache: cacheResult
      }
    };
  }
}

// Run test if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const test = new InactivitySystemTest();
  
  test.runAllTests()
    .then(results => {
      console.log('\n✅ Test completed successfully');
      process.exit(results.successRate === 1 ? 0 : 1);
    })
    .catch(error => {
      console.error('\n❌ Test failed:', error.message);
      process.exit(1);
    });
}

export default InactivitySystemTest;
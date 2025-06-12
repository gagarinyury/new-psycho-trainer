#!/usr/bin/env node

/**
 * Migration script to add voice_enabled setting to existing users
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/psycho_trainer.db');

console.log('🔄 Starting migration: Add voice_enabled setting...');

try {
  const db = new Database(dbPath);
  
  // Check if column already exists
  const tableInfo = db.prepare("PRAGMA table_info(users)").all();
  const hasColumn = tableInfo.some(col => col.name === 'voice_enabled');
  
  if (hasColumn) {
    console.log('✅ Column voice_enabled already exists');
  } else {
    // Add the column
    db.exec('ALTER TABLE users ADD COLUMN voice_enabled BOOLEAN DEFAULT 0');
    console.log('✅ Added voice_enabled column to users table');
    
    // Update existing users to have voice disabled by default
    const result = db.prepare('UPDATE users SET voice_enabled = 0 WHERE voice_enabled IS NULL').run();
    console.log(`✅ Updated ${result.changes} existing users with default voice setting`);
  }
  
  // Verify the change
  const sampleUser = db.prepare('SELECT voice_enabled FROM users LIMIT 1').get();
  if (sampleUser) {
    console.log(`✅ Verification: Sample user voice_enabled = ${sampleUser.voice_enabled}`);
  }
  
  db.close();
  console.log('🎉 Migration completed successfully!');
  
} catch (error) {
  console.error('❌ Migration failed:', error.message);
  process.exit(1);
}
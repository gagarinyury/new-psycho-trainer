#!/usr/bin/env node

/**
 * Migration script to add show_nonverbal setting to existing users
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/psycho_trainer.db');

console.log('🔄 Starting migration: Add show_nonverbal setting...');

try {
  const db = new Database(dbPath);
  
  // Check if column already exists
  const tableInfo = db.prepare("PRAGMA table_info(users)").all();
  const hasColumn = tableInfo.some(col => col.name === 'show_nonverbal');
  
  if (hasColumn) {
    console.log('✅ Column show_nonverbal already exists');
  } else {
    // Add the column
    db.exec('ALTER TABLE users ADD COLUMN show_nonverbal BOOLEAN DEFAULT 1');
    console.log('✅ Added show_nonverbal column to users table');
    
    // Update existing users to have nonverbal enabled by default
    const result = db.prepare('UPDATE users SET show_nonverbal = 1 WHERE show_nonverbal IS NULL').run();
    console.log(`✅ Updated ${result.changes} existing users with default nonverbal setting`);
  }
  
  // Verify the change
  const sampleUser = db.prepare('SELECT show_nonverbal FROM users LIMIT 1').get();
  if (sampleUser) {
    console.log(`✅ Verification: Sample user show_nonverbal = ${sampleUser.show_nonverbal}`);
  }
  
  db.close();
  console.log('🎉 Migration completed successfully!');
  
} catch (error) {
  console.error('❌ Migration failed:', error.message);
  process.exit(1);
}
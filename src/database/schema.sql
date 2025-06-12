-- Modern Psycho Trainer Database Schema
-- Version: 3.0.0
-- Created: 2025-01-06

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- Users table with secure data storage
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  language_code TEXT DEFAULT 'ru',
  show_nonverbal BOOLEAN DEFAULT 1,
  voice_enabled BOOLEAN DEFAULT 0,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- AI Patients with enhanced personality data
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT UNIQUE NOT NULL,
  created_by INTEGER NOT NULL,
  name TEXT NOT NULL,
  age INTEGER NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female', 'other')),
  background TEXT NOT NULL,
  personality_traits TEXT NOT NULL, -- JSON
  psychological_profile TEXT NOT NULL, -- JSON
  presenting_problem TEXT NOT NULL,
  therapy_goals TEXT, -- JSON
  system_prompt TEXT NOT NULL,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Therapy sessions with full lifecycle tracking
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME,
  duration_minutes INTEGER,
  message_count INTEGER DEFAULT 0,
  therapist_notes TEXT,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);

-- Messages within sessions
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  sender TEXT NOT NULL CHECK (sender IN ('therapist', 'patient')),
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'voice', 'image')),
  tokens_used INTEGER DEFAULT 0,
  response_time_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Claude API Cache for intelligent token management
CREATE TABLE IF NOT EXISTS claude_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key TEXT UNIQUE NOT NULL,
  prompt_hash TEXT NOT NULL,
  response_content TEXT NOT NULL,
  model_used TEXT NOT NULL,
  tokens_input INTEGER NOT NULL,
  tokens_output INTEGER NOT NULL,
  cache_type TEXT NOT NULL CHECK (cache_type IN ('system', 'conversation', 'analysis')),
  hit_count INTEGER DEFAULT 1,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Session analyses from AI supervisor
CREATE TABLE IF NOT EXISTS session_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  analysis_type TEXT NOT NULL CHECK (analysis_type IN ('interim', 'final', 'supervisor')),
  content TEXT NOT NULL, -- JSON with structured analysis
  recommendations TEXT, -- JSON with specific recommendations
  rating REAL CHECK (rating >= 1 AND rating <= 10),
  strengths TEXT, -- JSON array
  areas_for_improvement TEXT, -- JSON array
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- User statistics and progress tracking
CREATE TABLE IF NOT EXISTS user_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  total_sessions INTEGER DEFAULT 0,
  completed_sessions INTEGER DEFAULT 0,
  total_session_time_minutes INTEGER DEFAULT 0,
  average_session_rating REAL DEFAULT 0,
  favorite_patient_types TEXT, -- JSON array
  skill_areas TEXT, -- JSON with skill assessments
  achievements TEXT, -- JSON array
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id)
);

-- Performance metrics for monitoring
CREATE TABLE IF NOT EXISTS performance_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL,
  metric_unit TEXT,
  tags TEXT, -- JSON for additional metadata
  recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Conversation history for persistence and research
CREATE TABLE IF NOT EXISTS conversation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  messages TEXT NOT NULL, -- JSON array of conversation messages
  response_content TEXT NOT NULL,
  model_used TEXT NOT NULL,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_creation_tokens INTEGER DEFAULT 0,
  response_time INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for optimal query performance
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_last_activity ON users(last_activity);

CREATE INDEX IF NOT EXISTS idx_patients_created_by ON patients(created_by);
CREATE INDEX IF NOT EXISTS idx_patients_uuid ON patients(uuid);
CREATE INDEX IF NOT EXISTS idx_patients_is_active ON patients(is_active);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_patient_id ON sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_uuid ON sessions(uuid);

CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);

CREATE INDEX IF NOT EXISTS idx_claude_cache_key ON claude_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_claude_cache_expires_at ON claude_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_claude_cache_type ON claude_cache(cache_type);
CREATE INDEX IF NOT EXISTS idx_claude_cache_last_accessed ON claude_cache(last_accessed);

CREATE INDEX IF NOT EXISTS idx_session_analyses_session_id ON session_analyses(session_id);
CREATE INDEX IF NOT EXISTS idx_session_analyses_type ON session_analyses(analysis_type);

CREATE INDEX IF NOT EXISTS idx_performance_metrics_name ON performance_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_recorded_at ON performance_metrics(recorded_at);

CREATE INDEX IF NOT EXISTS idx_conversation_history_session_id ON conversation_history(session_id);
CREATE INDEX IF NOT EXISTS idx_conversation_history_created_at ON conversation_history(created_at);

-- Triggers for automatic timestamp updates
CREATE TRIGGER IF NOT EXISTS update_users_timestamp 
  AFTER UPDATE ON users
BEGIN
  UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_user_last_activity
  AFTER INSERT ON sessions
BEGIN
  UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE id = NEW.user_id;
END;

CREATE TRIGGER IF NOT EXISTS update_session_message_count
  AFTER INSERT ON messages
BEGIN
  UPDATE sessions 
  SET message_count = message_count + 1 
  WHERE id = NEW.session_id;
END;

CREATE TRIGGER IF NOT EXISTS update_cache_hit_count
  AFTER UPDATE ON claude_cache
  WHEN NEW.last_accessed > OLD.last_accessed
BEGIN
  UPDATE claude_cache 
  SET hit_count = hit_count + 1 
  WHERE id = NEW.id;
END;
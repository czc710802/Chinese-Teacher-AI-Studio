-- AI 辅导老师对话记录
CREATE TABLE IF NOT EXISTS ai_tutor_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  essay_id INTEGER,
  role TEXT NOT NULL DEFAULT 'student',
  message TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY(essay_id) REFERENCES essays(id) ON DELETE SET NULL
);

-- AI 仿写训练记录
CREATE TABLE IF NOT EXISTS ai_writing_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_text TEXT NOT NULL,
  exercise_type TEXT NOT NULL,
  exercise_prompt TEXT NOT NULL,
  student_answer TEXT,
  ai_feedback TEXT,
  score INTEGER,
  completed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
);

-- AI 升格训练记录
CREATE TABLE IF NOT EXISTS ai_upgrade_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  essay_id INTEGER,
  original_text TEXT NOT NULL,
  original_score REAL NOT NULL,
  upgraded_text TEXT NOT NULL,
  upgraded_score REAL NOT NULL,
  upgrade_report TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY(essay_id) REFERENCES essays(id) ON DELETE SET NULL
);

-- 高考阅卷模拟记录
CREATE TABLE IF NOT EXISTS mock_marking_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  essay_id INTEGER NOT NULL,
  marker_1_score REAL,
  marker_1_detail TEXT,
  marker_2_score REAL,
  marker_2_detail TEXT,
  marker_3_score REAL,
  marker_3_detail TEXT,
  final_score REAL,
  final_level TEXT,
  arbitration_json TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(essay_id) REFERENCES essays(id) ON DELETE CASCADE
);

-- 教师报告
CREATE TABLE IF NOT EXISTS teacher_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL,
  report_type TEXT NOT NULL,
  report_data TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
);

-- 素材库
CREATE TABLE IF NOT EXISTS material_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  sub_category TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT,
  tags TEXT,
  usage_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 学生周报
CREATE TABLE IF NOT EXISTS student_weekly_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  essays_count INTEGER DEFAULT 0,
  avg_score REAL,
  problems_summary TEXT,
  improvement_suggestions TEXT,
  report_text TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
);

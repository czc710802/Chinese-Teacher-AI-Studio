export const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student','teacher')),
  name TEXT NOT NULL,
  phone TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  student_no TEXT,
  grade TEXT,
  school TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  title TEXT,
  subject TEXT DEFAULT '高中语文',
  school TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  grade TEXT,
  teacher_id INTEGER NOT NULL,
  invite_code TEXT UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS class_students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(class_id, student_id),
  FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  essay_type TEXT NOT NULL,
  full_score INTEGER NOT NULL DEFAULT 60,
  deadline TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS essays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  title TEXT,
  original_text TEXT NOT NULL,
  revised_text TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  submit_round INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS essay_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  essay_id INTEGER,
  file_path TEXT NOT NULL,
  ocr_text TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(essay_id) REFERENCES essays(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  essay_id INTEGER NOT NULL,
  total_score REAL NOT NULL,
  level TEXT NOT NULL,
  dimension_scores TEXT NOT NULL,
  strengths TEXT NOT NULL,
  problems TEXT NOT NULL,
  paragraph_comments TEXT NOT NULL,
  editable_sentences TEXT NOT NULL,
  suggestions TEXT NOT NULL,
  upgraded_paragraph TEXT NOT NULL,
  good_sentences TEXT NOT NULL,
  next_training TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(essay_id) REFERENCES essays(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS teacher_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  essay_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL,
  comment TEXT NOT NULL,
  score_adjustment REAL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(essay_id) REFERENCES essays(id) ON DELETE CASCADE,
  FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS student_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL UNIQUE,
  score_trend TEXT DEFAULT '[]',
  common_problems TEXT DEFAULT '[]',
  growth_report TEXT DEFAULT '',
  personalized_suggestions TEXT DEFAULT '[]',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS export_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  export_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

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
`;

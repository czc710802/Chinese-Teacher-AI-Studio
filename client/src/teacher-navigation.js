export const teacherNavigationEntries = [
  { id: 'dashboard', title: '首页', route: '/teacher', iconKey: 'home' },
  { id: 'classes', title: '我的班级', route: '/teacher/classes', iconKey: 'users' },
  { id: 'students', title: '学生管理', route: '/teacher/students', iconKey: 'userPlus' },
  { id: 'joinRequests', title: '入班申请', route: '/teacher/join-requests', iconKey: 'userPlus' },
  { id: 'assignments', title: '作文任务', route: '/teacher/assignments', iconKey: 'bookOpen' },
  { id: 'submissions', title: '学生提交', route: '/teacher/submissions', iconKey: 'fileText' },
  { id: 'grading', title: 'AI 批改中心', route: '/teacher/grading', iconKey: 'rotate' },
  { id: 'reviews', title: '教师审核', route: '/teacher/reviews', iconKey: 'check' },
  { id: 'growth', title: '成长档案', route: '/teacher/growth', iconKey: 'trending' },
  { id: 'benchmark', title: 'Benchmark', route: '/teacher/benchmark', iconKey: 'benchmark' },
  { id: 'testCenter', title: '系统测试中心', route: '/teacher/test-center', iconKey: 'testTube' },
  { id: 'settings', title: '系统设置', route: '/teacher/settings', iconKey: 'settings' }
];

export const teacherHomeHighlights = [
  { id: 'classes', title: '查看我的班级', route: '/teacher/classes', iconKey: 'users', intro: '查看班级、成员与班级详情。' },
  { id: 'students', title: '学生管理', route: '/teacher/students', iconKey: 'userPlus', intro: '创建学生账号、导入学生名单、维护成员。' },
  { id: 'joinRequests', title: '查看待审核', route: '/teacher/join-requests', iconKey: 'userPlus', intro: '集中查看班级入班申请。' },
  { id: 'assignments', title: '新建作文任务', route: '/teacher/assignments', iconKey: 'bookOpen', intro: '发布任务、管理作业与提交链接。' },
  { id: 'submissions', title: '查看学生提交', route: '/teacher/submissions', iconKey: 'fileText', intro: '查看提交记录与批改进度。' },
  { id: 'grading', title: '打开 AI 批改中心', route: '/teacher/grading', iconKey: 'rotate', intro: '查看批改队列和重新批改任务。' },
  { id: 'testCenter', title: '打开系统测试中心', route: '/teacher/test-center', iconKey: 'testTube', intro: '仅用于 system_test 的验证闭环。' }
];

export const teacherLegacyRedirects = [
  { from: '/teacher/home', to: '/teacher' },
  { from: '/teacher/class-management', to: '/teacher/classes' },
  { from: '/teacher/student-list', to: '/teacher/students' },
  { from: '/teacher/essay-management', to: '/teacher/submissions' },
  { from: '/teacher/essay-tasks', to: '/teacher/assignments' },
  { from: '/teacher/ai-grading', to: '/teacher/grading' },
  { from: '/teacher/teacher-review', to: '/teacher/reviews' },
  { from: '/teacher/feishu', to: '/admin/integrations' },
  { from: '/teacher/feishu/classes', to: '/admin/integrations' },
  { from: '/classes', to: '/teacher/classes' },
  { from: '/assignments/new', to: '/teacher/assignments' },
  { from: '/archive', to: '/teacher/growth' },
  { from: '/student-profiles', to: '/teacher/growth' },
  { from: '/student/:studentId/profile', to: '/teacher/growth' },
  { from: '/class/:classId/essays', to: '/teacher/submissions' },
  { from: '/class/:classId/analytics', to: '/teacher/growth' },
  { from: '/essay/:essayId', to: '/teacher/submissions' }
];

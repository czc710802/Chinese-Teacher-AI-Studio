import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mainSource = readFileSync(path.join(rootDir, 'client/src/main.jsx'), 'utf8');
const essayRoutesSource = readFileSync(path.join(rootDir, 'server/src/routes/essays.js'), 'utf8');
const assignmentRoutesSource = readFileSync(path.join(rootDir, 'server/src/routes/assignments.js'), 'utf8');
const reviewPromptSource = readFileSync(path.join(rootDir, 'server/src/services/prompt.js'), 'utf8');
const aiTutorSource = readFileSync(path.join(rootDir, 'server/src/services/ai-tutor.js'), 'utf8');
const exporterSource = readFileSync(path.join(rootDir, 'server/src/services/exporter.js'), 'utf8');
const classRoutesSource = readFileSync(path.join(rootDir, 'server/src/routes/classes.js'), 'utf8');
const profileSource = readFileSync(path.join(rootDir, 'server/src/services/profile.js'), 'utf8');
const analyticsSource = readFileSync(path.join(rootDir, 'server/src/routes/analytics.js'), 'utf8');
const teacherNavigationSource = readFileSync(path.join(rootDir, 'client/src/teacher-navigation.js'), 'utf8');

function functionBody(name) {
  const start = mainSource.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = mainSource.indexOf('\nfunction ', start + 1);
  return mainSource.slice(start, next === -1 ? mainSource.length : next);
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

test('student legacy entrypoints now redirect into the mobile student home', () => {
  assert.match(mainSource, /homeByRole = \{ student: '\/student-mobile\/home'/);
  assert.match(mainSource, /function StudentHome\(\) \{/);
  assert.match(mainSource, /return <Navigate to="\/student-mobile\/home" replace \/>;/);
  assert.match(mainSource, /function StudentWorkspacePage\(\) \{/);
  assert.match(mainSource, /<Route path="\/student" element=\{<RoleRoute roles=\{\['student'\]\}><StudentLegacyRedirect to="\/student-mobile\/home" \/><\/RoleRoute>\} \/>/);
  assert.match(mainSource, /<Route path="\/student\/workspace\/:studentId" element=\{<RoleRoute roles=\{\['student'\]\}><StudentLegacyRedirect to="\/student-mobile\/home" \/><\/RoleRoute>\} \/>/);
});

test('student mobile home becomes the canonical student entry with class, task and report links', () => {
  const mobileHome = functionBody('StudentMobileHomePage');
  assert.match(mobileHome, /我的任务/);
  assert.match(mobileHome, /提交作文/);
  assert.match(mobileHome, /批改进度/);
  assert.match(mobileHome, /我的报告/);
  assert.match(mobileHome, /升格与修改/);
  assert.match(mobileHome, /成长档案/);
  assert.match(mobileHome, /加入班级/);
  assert.doesNotMatch(mobileHome, /自由作文 AI 批改/);
});

test('teacher class homework summarizes each assignment and keeps review export actions', () => {
  const teacherReviewCenter = functionBody('TeacherReviewCenter');
  assert.match(teacherReviewCenter, /班级作业/);
  assert.match(teacherReviewCenter, /submittedCount/);
  assert.match(teacherReviewCenter, /missingCount/);
  assert.match(teacherReviewCenter, /reviewedCount/);
  assert.match(teacherReviewCenter, /已提交/);
  assert.match(teacherReviewCenter, /未提交/);
  assert.match(teacherReviewCenter, /已批改/);
  assert.match(teacherReviewCenter, /前往批改/);
  assert.match(teacherReviewCenter, /exportAssignment/);
  assert.match(teacherReviewCenter, /\/reports\/assignment\/\$\{assignment\.id\}\/docx/);
  assert.doesNotMatch(teacherReviewCenter, /一键批阅/);
});

test('teacher class homework export includes student result full upgraded essay', () => {
  assert.match(exporterSource, /ai_upgrade_records/);
  assert.match(exporterSource, /latest_upgrade/);
  assert.match(exporterSource, /upgraded_text/);
  assert.match(exporterSource, /学生端批改结果升格文/);
});

test('single essay export used by teacher and student includes full AI upgraded essay', () => {
  const essayReportStart = exporterSource.indexOf('function essayReportData');
  const managedRowsStart = exporterSource.indexOf('function managedEssayRows');
  const singleEssayExportSource = exporterSource.slice(essayReportStart, managedRowsStart);
  assert.match(singleEssayExportSource, /ai_upgrade_records/);
  assert.match(singleEssayExportSource, /latestUpgrade/);
  assert.match(singleEssayExportSource, /upgraded_text/);
  assert.match(singleEssayExportSource, /polished_full_text/);
  assert.match(singleEssayExportSource, /AI批改后的升格文章全文/);
});

test('teacher review records list reviewed essays with view and batch export actions', () => {
  const teacherReviewCenter = functionBody('TeacherReviewCenter');
  assert.match(teacherReviewCenter, /批改记录/);
  assert.match(teacherReviewCenter, /批量导出/);
  assert.match(teacherReviewCenter, /exportReviewed/);
  assert.match(teacherReviewCenter, /\/reports\/reviewed\/docx/);
  assert.match(teacherReviewCenter, /reviewMode === 'records'/);
  assert.match(teacherReviewCenter, /essay\.total_score != null/);
  assert.match(teacherReviewCenter, /href=\{`\/teacher\/essays\/\$\{essay\.id\}`\}/);
  assert.match(teacherReviewCenter, /点击查看/);
  assert.match(mainSource, /已自动批阅/);
  assert.doesNotMatch(teacherReviewCenter, /调阅批阅结果/);
});

test('teacher one click review processes every submitted essay in the selected class', () => {
  const teacherReviewCenter = functionBody('TeacherReviewCenter');
  assert.match(teacherReviewCenter, /const reviewTargets = essays/);
  assert.match(teacherReviewCenter, /reviewTargets\.length/);
  assert.match(teacherReviewCenter, /for \(const essay of reviewTargets\)/);
  assert.doesNotMatch(teacherReviewCenter, /const pending = essays\.filter/);
});

test('teacher review results mode lets teacher click into each student AI review', () => {
  const teacherReviewCenter = functionBody('TeacherReviewCenter');
  assert.match(teacherReviewCenter, /reviewMode/);
  assert.match(teacherReviewCenter, /setReviewMode\('records'\)/);
  assert.match(teacherReviewCenter, /onlyReviewed/);
  assert.match(teacherReviewCenter, /reviewMode === 'records'/);
  assert.match(teacherReviewCenter, /essay\.total_score != null/);
  assert.match(teacherReviewCenter, /href=\{`\/teacher\/essays\/\$\{essay\.id\}`\}/);
  assert.match(teacherReviewCenter, /点击查看/);
});

test('student submit page uses the mobile upload route and keeps the full submission flow', () => {
  const submitPage = functionBody('SubmitPage');
  assert.match(submitPage, /buildStudentMobileUploadUrl\(assignmentId\)/);
  assert.match(submitPage, /请输入或粘贴\/黏贴作文正文/);
  assert.match(submitPage, /当前提交状态/);
  assert.match(submitPage, /OCR 后人工确认/);
  assert.doesNotMatch(submitPage, /\/upload\?assignmentId=/);
  assert.doesNotMatch(submitPage, /保存草稿|上传文件并批改/);
  assert.match(submitPage, /正式提交并批改/);
});

test('student legacy essay result route redirects to the mobile report page', () => {
  assert.match(mainSource, /<Route path="\/student\/essays\/:essayId\/report" element=\{<RoleRoute roles=\{\['student'\]\}><StudentLegacyEssayReportRedirect \/><\/RoleRoute>\} \/>/);
  assert.match(mainSource, /function StudentLegacyEssayReportRedirect\(\)/);
  assert.match(mainSource, /Navigate to=\{`\/student-mobile\/reports\/\$\{encodeURIComponent\(essayId\)\}\$\{location\.search \|\| ''\}`\} replace/);
});

test('teacher assignment management keeps task reminders and removes paused Feishu publish widgets', () => {
  const assignmentManagement = functionBody('AssignmentManagement');
  assert.match(assignmentManagement, /提醒未提交学生/);
  assert.match(assignmentManagement, /查看报告/);
  assert.match(assignmentManagement, /删除任务/);
  assert.doesNotMatch(assignmentManagement, /飞书作业发布|选择飞书班级群 chatId|绑定班级群|预览消息卡片|发送到飞书|撤回或重新发布/);
  assert.match(assignmentRoutesSource, /remind-missing/);
});

test('teacher essay workspace exposes version rail, report actions, scoring panel and collapsed rerun area', () => {
  const teacherWorkspace = functionBody('TeacherEssayDetailPage');
  assert.match(teacherWorkspace, /作文版本/);
  assert.match(teacherWorkspace, /作文详情/);
  assert.match(teacherWorkspace, /作文全文/);
  assert.match(teacherWorkspace, /AI 批改结果/);
  assert.match(teacherWorkspace, /教师评分/);
  assert.match(teacherWorkspace, /保存草稿/);
  assert.match(teacherWorkspace, /提交评分/);
  assert.match(teacherWorkspace, /查看归档报告/);
  assert.match(teacherWorkspace, /下载 PDF/);
  assert.match(teacherWorkspace, /下载 Word/);
  assert.match(teacherWorkspace, /重新批改/);
  assert.match(teacherWorkspace, /details className="rerun-accordion"/);
  assert.doesNotMatch(teacherWorkspace, /网页报告：\{links\.reportUrl/);
  assert.doesNotMatch(teacherWorkspace, /PDF：\{links\.pdfUrl/);
  assert.doesNotMatch(teacherWorkspace, /Word：\{links\.docxUrl/);
});

test('mobile student join flow and teacher class workbench expose code join, join requests and member operations', () => {
  assert.match(mainSource, /function StudentMobileJoinCodePage/);
  assert.match(mainSource, /\/student-mobile\/join\/code/);
  assert.match(mainSource, /function TeacherLifecycleClassPage/);
  assert.match(mainSource, /function buildTeacherJoinRequestsUrl/);
  assert.match(mainSource, /\/teacher\/join-requests\?classId=/);
  assert.match(mainSource, /\/teacher\/classes\/\$\{encodeURIComponent\(classKey\)\}\/members/);
  assert.match(mainSource, /joinRequestsUrl = buildTeacherJoinRequestsUrl\(classKey\)/);
  assert.match(mainSource, /className="kpi-link"/);
  assert.match(mainSource, /\/student-mobile\/join\/requests\/\$\{encodeURIComponent\(requestId\)\}/);
  assert.match(mainSource, /入班申请/);
  assert.match(mainSource, /成员管理/);
  assert.match(mainSource, /移出班级/);
  assert.match(mainSource, /转班/);
});

test('teacher assignment management exposes task detail and class-scoped task filters', () => {
  assert.match(mainSource, /function buildTeacherAssignmentsUrl/);
  assert.match(mainSource, /function buildTeacherAssignmentDetailUrl/);
  assert.match(mainSource, /function TeacherAssignmentDetailPage/);
  assert.match(mainSource, /buildTeacherAssignmentDetailUrl\(assignment\.id\)/);
  assert.match(mainSource, /\/teacher\/assignments\/:assignmentId/);
  assert.match(mainSource, /classIdFilter/);
  assert.match(mainSource, /dataScopeFilter/);
  assert.match(mainSource, /查看详情/);
  assert.match(mainSource, /写作材料/);
  assert.match(mainSource, /写作要求/);
});

test('system test center displays live assignment count and not legacy task totals', () => {
  const testCenter = functionBody('TeacherTestCenterPage');
  assert.match(testCenter, /stepCounts\.tasks/);
  assert.match(testCenter, /刷新任务/);
  assert.match(testCenter, /任务数据加载失败，请重试。/);
  assert.doesNotMatch(testCenter, /teacherManagement\?\.totals\?\.tasks/);
});

test('student mobile task pages show loading failures instead of fake zero states', () => {
  const home = functionBody('StudentMobileHomePage');
  const tasks = functionBody('StudentMobileTasksPage');
  assert.match(home, /任务数据加载失败，请重试。/);
  assert.match(tasks, /任务数据加载失败，请重试。/);
  assert.match(tasks, /刷新任务/);
  assert.match(tasks, /开始写作|提交作文/);
});

test('student mobile home exposes the canonical six core entries plus class entry', () => {
  const studentMobileHome = functionBody('StudentMobileHomePage');
  assert.match(studentMobileHome, /我的任务/);
  assert.match(studentMobileHome, /提交作文/);
  assert.match(studentMobileHome, /批改进度/);
  assert.match(studentMobileHome, /我的报告/);
  assert.match(studentMobileHome, /升格与修改/);
  assert.match(studentMobileHome, /成长档案/);
  assert.match(studentMobileHome, /加入班级/);
  assert.doesNotMatch(studentMobileHome, /自由作文 AI 批改/);
  assert.match(mainSource, /mobile-quick-links/);
});

test('admin integrations page reports feishu pause state and mobile entry points', () => {
  assert.match(mainSource, /function AdminIntegrationsPage/);
  assert.match(mainSource, /\/admin\/integrations/);
  assert.match(mainSource, /飞书业务已暂停/);
  assert.match(mainSource, /微信生态入口已启用/);
});

test('pwa manifest is exposed for the mobile web shell', () => {
  const indexHtml = readFileSync(path.join(rootDir, 'client/index.html'), 'utf8');
  const manifest = readFileSync(path.join(rootDir, 'client/public/manifest.webmanifest'), 'utf8');
  assert.match(indexHtml, /manifest\.webmanifest/);
  assert.match(indexHtml, /theme-color/);
  assert.match(manifest, /"start_url": "\/student-mobile\/home"/);
  assert.match(manifest, /"display": "standalone"/);
});

test('student photo upload sends images directly for AI recognition and review', () => {
  const uploadPage = functionBody('UploadPage');
  assert.match(uploadPage, /api\('\/essays\/images'/);
  assert.match(uploadPage, /FormData/);
  assert.match(uploadPage, /fd\.append\('assignment_id', assignmentId\)/);
  assert.match(uploadPage, /fd\.append\('images', file\)/);
  assert.match(uploadPage, /nav\(buildStudentMobileReportUrl\(data\.essayId\)\)/);
  assert.match(uploadPage, /capture="environment"/);
  assert.match(uploadPage, /accept="image\/\*,\.heic"/);
  assert.match(uploadPage, /核对文字内容/);
  assert.doesNotMatch(uploadPage, /pendingEssayImages/);
  assert.doesNotMatch(mainSource, /function ConfirmPage|Route path="\/confirm"/);
});

test('backend image upload route recognizes photos and creates a reviewed essay', () => {
  assert.match(essayRoutesSource, /essayRouter\.post\('\/images'/);
  assert.match(essayRoutesSource, /upload\.array\('images', 8\)/);
  assert.match(essayRoutesSource, /recognizeImages\(req\.files \|\| \[\]\)/);
  assert.match(essayRoutesSource, /createReviewedEssay/);
  assert.match(essayRoutesSource, /gradeEssay\(buildReviewInput\(\), \{ timeoutMs: 120000 \}\)/);
  assert.match(essayRoutesSource, /deferReview: true/);
  assert.match(essayRoutesSource, /setImmediate\(\(\) => \{/);
  assert.match(essayRoutesSource, /请先选择照片或图片/);
});

test('student review page polls pending image submissions instead of showing a fake completed report', () => {
  const reviewPage = functionBody('ReviewPage');
  assert.match(reviewPage, /作文已上传，AI正在识别并批改，请稍候/);
  assert.match(reviewPage, /gradingStatus/);
  assert.match(reviewPage, /setInterval\(load, 2000\)/);
});

test('student submit page shows upload and review errors instead of failing silently', () => {
  const submitPage = functionBody('SubmitPage');
  assert.match(submitPage, /busy/);
  assert.match(submitPage, /setError/);
  assert.match(submitPage, /catch \(err\)/);
  assert.match(submitPage, /提交失败/);
  assert.match(submitPage, /请先粘贴或输入作文正文/);
  assert.doesNotMatch(submitPage, /tooShort/);
  assert.doesNotMatch(submitPage, /tooLong/);
  assert.doesNotMatch(submitPage, /最低字数：不少于/);
  assert.match(submitPage, /AI 会根据篇幅自动分档批改/);
  assert.match(submitPage, /disabled=\{busy \|\| !text\.trim\(\)\}/);
});

test('student profile shows score changes with chart and summary metrics', () => {
  const studentProfile = functionBody('StudentProfile');
  assert.match(studentProfile, /trendStats/);
  assert.match(studentProfile, /latestScore/);
  assert.match(studentProfile, /scoreDelta/);
  assert.match(studentProfile, /成绩变化/);
  assert.match(studentProfile, /CartesianGrid/);
  assert.match(studentProfile, /LineChart data=\{trend\}/);
  assert.match(studentProfile, /成绩趋势图/);
});

test('student mobile reports page replaces the old student workspace result list', () => {
  const mobileReports = functionBody('StudentMobileReportsPage');
  assert.match(mobileReports, /我的报告/);
  assert.match(mobileReports, /查看报告/);
  assert.match(mobileReports, /去任务列表/);
  assert.doesNotMatch(mobileReports, /自由作文 AI 批改/);
});

test('teacher home keeps only the canonical high-frequency entry cards', () => {
  const teacherHome = functionBody('TeacherHome');
  assert.match(teacherHome, /TeacherDashboardCard/);
  assert.match(teacherHome, /teacherHomeHighlights/);
  assert.match(teacherHome, /teacher-banner/);
  assert.match(teacherHome, /GraduationCap/);
  assert.doesNotMatch(teacherHome, /学生管理|打开 AI 批改中心|打开系统测试中心/);
  assert.doesNotMatch(teacherHome, /PublicAccessPanel|TeacherRerunTaskCard|ClassManagement|TeacherInsightPanel|AssignmentPublish|AssignmentManagement|TeacherReviewCenter/);
  assert.match(mainSource, /teacherHomeHighlights/);
  assert.match(mainSource, /teacherNavigationEntries/);
  assert.match(teacherNavigationSource, /title: '查看我的班级'/);
  assert.match(teacherNavigationSource, /title: '查看待审核'/);
  assert.match(teacherNavigationSource, /title: '新建作文任务'/);
  assert.match(teacherNavigationSource, /title: '查看学生提交'/);
  assert.doesNotMatch(teacherNavigationSource, /学生管理|打开 AI 批改中心|打开系统测试中心/);
});

test('login page exposes public demo entry for mobile and external presentation', () => {
  const loginPage = functionBody('LoginPage');
  assert.match(loginPage, /login-stage/);
  assert.match(loginPage, /PublicAccessPanel/);
  assert.match(loginPage, /公网演示入口/);
  assert.match(loginPage, /手机浏览器打开这个地址/);
});

test('teacher and student class flows no longer expose invitation code entry or display', () => {
  const studentHome = functionBody('StudentHome');
  const classManagement = functionBody('ClassManagement');
  const classRosterPanel = functionBody('ClassRosterPanel');

  assert.match(studentHome, /Navigate to="\/student-mobile\/home"/);
  assert.doesNotMatch(studentHome, /invite|邀请码|\/classes\/join/);
  assert.match(classManagement, /TeacherLegacyRedirect/);
  assert.match(classManagement, /\/teacher\/classes/);
  assert.doesNotMatch(classRosterPanel, /invite|邀请码/);
  assert.match(classRoutesSource, /student-mobile\/join/);
  assert.match(classRoutesSource, /join-requests/);
  assert.doesNotMatch(classRoutesSource, /\/classes\/join/);
});

test('student home shows a dedicated student marker banner above the workspace cards', () => {
  const mobileHome = functionBody('StudentMobileHomePage');
  assert.match(mobileHome, /手机学生端/);
  assert.match(mobileHome, /我的班级/);
  assert.match(mobileHome, /我的任务/);
  assert.match(mobileHome, /还没有班级，请先通过邀请码加入。/);
});

test('polished comparison renders inline original added and deleted edits without separate rewrite paragraphs', () => {
  assert.match(mainSource, /function buildInlineDiff/);
  assert.match(mainSource, /diff-fragment original-text/);
  assert.match(mainSource, /diff-fragment added-text/);
  assert.match(mainSource, /diff-fragment deleted-text/);
  const polishedComparison = functionBody('PolishedComparison');
  assert.match(polishedComparison, /buildInlineDiff\(original, polished\)/);
  assert.match(polishedComparison, /diffParts\.map/);
  assert.match(polishedComparison, /part\.type === 'added'/);
  assert.match(polishedComparison, /part\.type === 'deleted'/);
  assert.doesNotMatch(polishedComparison, /original\.slice\(start|polished\.slice\(start|changed \|\| polished/);
});

test('ai review and upgrade prompts require deep full-essay revision', () => {
  assert.match(reviewPromptSource, /深度润色提升版/);
  assert.match(reviewPromptSource, /多处实质改写/);
  assert.doesNotMatch(reviewPromptSource, /保守润色/);
  assert.match(aiTutorSource, /深度重写/);
  assert.match(aiTutorSource, /不得只做同义词替换/);
  assert.match(aiTutorSource, /重构薄弱段落/);
  assert.doesNotMatch(aiTutorSource, /保持相近篇幅/);
});

test('review suggestions render detailed diagnosis logic and action guidance', () => {
  const reviewPage = functionBody('ReviewPage');
  assert.match(mainSource, /function AdviceGuidanceList/);
  assert.match(mainSource, /问题诊断/);
  assert.match(mainSource, /逻辑分析/);
  assert.match(mainSource, /修改步骤/);
  assert.match(mainSource, /示例方向/);
  assert.match(reviewPage, /<AdviceGuidanceList items=\{suggestionItems\}/);
  assert.doesNotMatch(reviewPage, /suggestionItems\.map\(\(item, index\) => <p/);
});

test('review page no longer exposes paragraph annotation and original image controls', () => {
  const reviewPage = functionBody('ReviewPage');
  assert.doesNotMatch(reviewPage, /自然段旁批/);
  assert.doesNotMatch(reviewPage, /自然段详细旁批/);
  assert.doesNotMatch(reviewPage, /查看原图/);
  assert.doesNotMatch(reviewPage, /annotationMode/);
  assert.doesNotMatch(reviewPage, /essay-image-gallery/);
  assert.doesNotMatch(reviewPromptSource, /每一自然段后面做详细旁批/);
  assert.doesNotMatch(reviewPromptSource, /不要逐句逐行评点/);
  assert.doesNotMatch(reviewPage, /<MarkedOriginal text=\{text\} changes=\{corrections\}/);
});

test('review page removes five-item multi dimension analysis from student result', () => {
  const reviewPage = functionBody('ReviewPage');
  assert.doesNotMatch(reviewPage, /多维分析/);
  assert.doesNotMatch(reviewPage, /DimensionAnalysis/);
  assert.doesNotMatch(reviewPage, /const dimensions =/);
  assert.doesNotMatch(reviewPromptSource, /"multi_dimension"/);
  assert.doesNotMatch(reviewPromptSource, /五个项目|内容.*结构.*语言.*技巧.*情感/s);
});

test('review page renders all logic-problem paragraph rewrite examples', () => {
  const reviewPage = functionBody('ReviewPage');
  assert.match(reviewPage, /paragraphRewrites/);
  assert.match(reviewPage, /逻辑薄弱段落改写示范/);
  assert.match(reviewPromptSource, /paragraph_rewrites/);
  assert.match(reviewPromptSource, /所有不符合文章逻辑要求的段落/);
});

test('teacher overall and strengths require text-specific deep guidance', () => {
  assert.match(reviewPromptSource, /教师总评必须结合学生作文原文/);
  assert.match(reviewPromptSource, /详细深度指导/);
  assert.match(reviewPromptSource, /文章亮点必须结合原文具体段落或句子/);
  assert.doesNotMatch(reviewPromptSource, /教师总评（100字以内/);
});

test('practice consolidation no longer renders numbered practice tabs', () => {
  const reviewPage = functionBody('ReviewPage');
  assert.match(reviewPage, /巩固练习/);
  assert.doesNotMatch(reviewPage, /练习一|练习二/);
  assert.doesNotMatch(reviewPage, /segment-tabs/);
  assert.doesNotMatch(reviewPage, /exerciseTab/);
});

test('student home no longer renders high school marking simulation', () => {
  const mobileHome = functionBody('StudentMobileHomePage');
  assert.doesNotMatch(mobileHome, /高考阅卷模拟/);
  assert.doesNotMatch(mainSource, /MockMarkingSystem/);
  assert.doesNotMatch(mainSource, /\/ai\/mock-mark\//);
});

test('ai review prompt asks for structured deep suggestions without multi dimension output', () => {
  assert.match(reviewPromptSource, /建议必须按“问题诊断-逻辑分析-修改步骤-示例方向”展开/);
  assert.match(reviewPromptSource, /每条建议至少 120 字/);
  assert.match(reviewPromptSource, /"diagnosis"/);
  assert.match(reviewPromptSource, /"logic_analysis"/);
  assert.match(reviewPromptSource, /"action_steps"/);
  assert.match(reviewPromptSource, /"example_direction"/);
  assert.doesNotMatch(reviewPromptSource, /"current_state"/);
  assert.doesNotMatch(reviewPromptSource, /"root_cause"/);
  assert.doesNotMatch(reviewPromptSource, /"improvement_path"/);
});

test('ai review prompt defines logic thinking score and thinking coach output', () => {
  assert.match(reviewPromptSource, /逻辑思维能力（30分）/);
  assert.match(reviewPromptSource, /观点漂移|偷换概念|以偏概全|循环论证|错误类比/);
  assert.match(reviewPromptSource, /提问 → 引导 → 思考 → 修改 → 提升/);
  assert.match(reviewPromptSource, /"logic_thinking_score"/);
  assert.match(reviewPromptSource, /"thinking_depth"/);
  assert.match(reviewPromptSource, /"thinking_improvement"/);
  assert.match(reviewPromptSource, /"socratic_questions"/);
  assert.match(reviewPromptSource, /"thinking_coach"/);
});

test('student review page renders thinking coach diagnosis questions and revision loop', () => {
  const reviewPage = functionBody('ReviewPage');
  assert.match(mainSource, /function ThinkingCoachPanel/);
  assert.match(mainSource, /逻辑思维能力/);
  assert.match(mainSource, /思维深度/);
  assert.match(mainSource, /思维提升建议/);
  assert.match(mainSource, /苏格拉底式追问/);
  assert.match(mainSource, /深度修改闭环/);
  assert.match(reviewPage, /<ThinkingCoachPanel report=\{thinkingReport\}/);
});

test('student profile renders thinking growth archive across six abilities', () => {
  const studentProfile = functionBody('StudentProfile');
  assert.match(studentProfile, /思维成长档案/);
  assert.match(studentProfile, /结合已批改作文的详细分析/);
  assert.match(studentProfile, /thinkingAnalyses/);
  assert.match(studentProfile, /essay_title/);
  assert.match(studentProfile, /evidence/);
  assert.match(mainSource, /逻辑能力/);
  assert.match(mainSource, /思辨能力/);
  assert.match(mainSource, /论证能力/);
  assert.match(mainSource, /材料分析能力/);
  assert.match(mainSource, /语言表达能力/);
  assert.match(mainSource, /修改能力/);
  assert.match(profileSource, /thinking_growth/);
  assert.match(profileSource, /thinking_analyses/);
  assert.match(profileSource, /essay_title/);
  assert.match(profileSource, /detailed_analysis/);
});

test('teacher analytics exposes class thinking weaknesses and teaching suggestions', () => {
  assert.match(analyticsSource, /thinkingWeaknesses/);
  assert.match(analyticsSource, /thinkingAbilityAverages/);
  assert.match(analyticsSource, /thinkingTeachingSuggestions/);
  assert.match(mainSource, /班级思维分析/);
  assert.match(mainSource, /最薄弱能力/);
  assert.match(mainSource, /不会分析原因/);
});

test('teacher assignment management summarizes published tasks and deletes them', () => {
  const assignmentPublish = functionBody('AssignmentPublish');
  const assignmentManagement = functionBody('AssignmentManagement');
  assert.match(assignmentPublish, /publishing/);
  assert.match(assignmentPublish, /disabled=\{publishing/);
  assert.match(assignmentPublish, /发布中/);
  assert.match(assignmentPublish, /年级/);
  assert.match(assignmentPublish, /作文训练类型/);
  assert.match(assignmentPublish, /发布按钮/);
  assert.doesNotMatch(assignmentPublish, /最低字数|最高字数|评分标准|允许学生重新提交/);
  assert.match(assignmentManagement, /发布任务管理/);
  assert.match(assignmentManagement, /publishedAssignments/);
  assert.match(assignmentManagement, /created_at/);
  assert.match(assignmentManagement, /deleteAssignment/);
  assert.match(assignmentManagement, /method: 'DELETE'/);
  assert.match(assignmentManagement, /删除任务/);
});

test('teacher roster import panel lets teacher edit each student name', () => {
  const classRosterPanel = functionBody('ClassRosterPanel');
  assert.match(classRosterPanel, /editingStudentId/);
  assert.match(classRosterPanel, /修改姓名/);
  assert.match(classRosterPanel, /保存姓名/);
  assert.match(classRosterPanel, /method: 'PATCH'/);
  assert.match(classRosterPanel, /`\/classes\/\$\{klass\.id\}\/students\/\$\{editingStudentId\}`/);
});

test('teacher class management now points to safe management and test center entries', () => {
  const classManagement = functionBody('ClassManagement');
  assert.match(classManagement, /TeacherLegacyRedirect/);
  assert.match(classManagement, /\/teacher\/classes/);
  assert.doesNotMatch(classManagement, /删除班级|打开班级管理|打开学生管理|进入系统测试中心/);
});

test('teacher class management exposes live create and cascade delete controls while student management redirects to classes', () => {
  const teacherClassesPage = functionBody('TeacherClassesPage');
  const teacherStudentsPage = functionBody('TeacherStudentsPage');
  const classManagement = functionBody('ClassManagement');
  assert.match(teacherClassesPage, /新增班级/);
  assert.match(teacherClassesPage, /删除班级/);
  assert.match(teacherClassesPage, /级联删除/);
  assert.match(teacherClassesPage, /点击展开当前班级/);
  assert.match(teacherClassesPage, /点击展开历史班级/);
  assert.match(teacherClassesPage, /createClass/);
  assert.match(teacherClassesPage, /deleteClass/);
  assert.match(teacherStudentsPage, /TeacherLegacyRedirect/);
  assert.match(teacherStudentsPage, /\/teacher\/classes/);
  assert.doesNotMatch(classManagement, /deleteClass/);
  assert.doesNotMatch(classManagement, /rosterText/);
});

test('teacher classroom workbench exposes student account creation and batch import controls', () => {
  const classWorkBench = functionBody('TeacherLifecycleClassPage');
  const enrollmentPanel = functionBody('StudentEnrollmentPanel');
  assert.match(classWorkBench, /StudentEnrollmentPanel/);
  assert.match(mainSource, /function StudentEnrollmentPanel/);
  assert.match(enrollmentPanel, /学生账号管理/);
  assert.match(enrollmentPanel, /创建学生账号/);
  assert.match(enrollmentPanel, /批量导入学生/);
  assert.match(enrollmentPanel, /创建中\.\.\./);
  assert.match(enrollmentPanel, /导入中\.\.\./);
  assert.match(classWorkBench, /dataScope=\{klass\.data_scope \|\| 'production'\}/);
  assert.match(classWorkBench, /删除班级/);
  assert.match(classWorkBench, /点击展开学生名单/);
  assert.match(classWorkBench, /未提交作文/);
  assert.match(classWorkBench, /查看批改/);
});

test('teacher test center exposes reset and legacy cleanup dry-run actions', () => {
  const testCenter = functionBody('TeacherTestCenterPage');
  assert.match(testCenter, /系统测试中心/);
  assert.match(testCenter, /重置测试环境/);
  assert.match(testCenter, /重新生成 dry-run/);
  assert.match(testCenter, /拟物理删除/);
  assert.match(testCenter, /assignments-changed/);
  assert.match(testCenter, /查看测试任务/);
});

test('student legacy roster and workspace now redirect to the mobile home', () => {
  const studentHome = functionBody('StudentHome');
  const workspace = functionBody('StudentWorkspacePage');
  assert.match(studentHome, /Navigate to="\/student-mobile\/home"/);
  assert.match(workspace, /Navigate to="\/student-mobile\/home"/);
  assert.doesNotMatch(studentHome, /uniqueStudents|我的作文入口|学生名单/);
  assert.doesNotMatch(workspace, /uniqueStudents|activeAssignmentId|作文任务/);
});

test('student legacy workspace no longer renders named class cards or local task panels', () => {
  const studentHome = functionBody('StudentHome');
  const workspace = functionBody('StudentWorkspacePage');
  assert.doesNotMatch(studentHome, /pickDefaultClassId\(rows\)/);
  assert.doesNotMatch(workspace, /pickDefaultClassId\(rows\)/);
  assert.doesNotMatch(studentHome, /getClassDisplayName\(selectedClass\)/);
  assert.doesNotMatch(workspace, /getClassDisplayName\(selectedClass\)/);
});

test('frontend exposes separated teacher, student and administrator entrances', () => {
  const adminHome = functionBody('AdminHome');
  assert.match(mainSource, /path="\/teacher"/);
  assert.match(mainSource, /path="\/teacher\/students"/);
  assert.match(mainSource, /path="\/teacher\/test-center" element={<RoleRoute roles=\{\['admin'\]\}><TeacherTestCenterPage \/>/);
  assert.match(mainSource, /path="\/student-mobile\/home"/);
  assert.match(mainSource, /path="\/student" element=\{<RoleRoute roles=\{\['student'\]\}><StudentLegacyRedirect to="\/student-mobile\/home" \/><\/RoleRoute>\} \/>/);
  assert.match(mainSource, /path="\/submit\/:assignmentId" element=\{<RoleRoute roles=\{\['student'\]\}><StudentLegacySubmitRedirect \/><\/RoleRoute>\} \/>/);
  assert.match(mainSource, /path="\/admin"/);
  assert.match(mainSource, /roles=\{\['admin'\]\}/);
  assert.match(adminHome, /系统配置/);
  assert.match(adminHome, /模型配置/);
  assert.match(adminHome, /WebDAV 状态/);
  assert.doesNotMatch(adminHome, /发布作业|创建作文作业|批量启动 AI 批改/);
});

test('student mobile entry exposes login join home task detail and profile routes', () => {
  const mobileLogin = functionBody('StudentMobileLoginPage');
  const mobileHome = functionBody('StudentMobileHomePage');
  const mobileTasks = functionBody('StudentMobileTasksPage');
  const mobileReports = functionBody('StudentMobileReportsPage');
  assert.match(mainSource, /path="\/student-mobile"/);
  assert.match(mainSource, /path="\/student-mobile\/login"/);
  assert.match(mainSource, /path="\/student-mobile\/join"/);
  assert.match(mainSource, /path="\/student-mobile\/join\/status"/);
  assert.match(mainSource, /path="\/student-mobile\/home"/);
  assert.match(mainSource, /path="\/student-mobile\/tasks"/);
  assert.match(mainSource, /path="\/student-mobile\/tasks\/:assignmentId"/);
  assert.match(mainSource, /path="\/student-mobile\/tasks\/:assignmentId\/submit"/);
  assert.match(mainSource, /path="\/student-mobile\/tasks\/:assignmentId\/upload"/);
  assert.match(mainSource, /path="\/student-mobile\/reports"/);
  assert.match(mainSource, /path="\/student-mobile\/reports\/:essayId"/);
  assert.match(mainSource, /path="\/student-mobile\/profile"/);
  assert.match(mobileLogin, /学号/);
  assert.match(mobileLogin, /修改密码/);
  assert.match(mobileLogin, /登录/);
  assert.match(mobileHome, /我的任务/);
  assert.match(mobileHome, /加入班级/);
  assert.match(mobileTasks, /任务详情/);
  assert.match(mobileTasks, /提交作文/);
  assert.match(mobileTasks, /拍照上传/);
  assert.match(mobileReports, /我的报告/);
  assert.match(mobileReports, /查看报告/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mainSource = readFileSync(path.join(rootDir, 'client/src/main.jsx'), 'utf8');
const essayRoutesSource = readFileSync(path.join(rootDir, 'server/src/routes/essays.js'), 'utf8');
const reviewPromptSource = readFileSync(path.join(rootDir, 'server/src/services/prompt.js'), 'utf8');
const aiTutorSource = readFileSync(path.join(rootDir, 'server/src/services/ai-tutor.js'), 'utf8');
const exporterSource = readFileSync(path.join(rootDir, 'server/src/services/exporter.js'), 'utf8');
const classRoutesSource = readFileSync(path.join(rootDir, 'server/src/routes/classes.js'), 'utf8');
const profileSource = readFileSync(path.join(rootDir, 'server/src/services/profile.js'), 'utf8');
const analyticsSource = readFileSync(path.join(rootDir, 'server/src/routes/analytics.js'), 'utf8');

function functionBody(name) {
  const start = mainSource.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = mainSource.indexOf('\nfunction ', start + 1);
  return mainSource.slice(start, next === -1 ? mainSource.length : next);
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

test('student roster lets the current student enter their own submission and review area', () => {
  assert.match(mainSource, /我的作文入口/);
  assert.match(mainSource, /href=\{`\/student\/workspace\/\$\{student\.id\}`\}/);
  assert.match(mainSource, /进入拍照、提交、查看结果/);
});

test('student personal workspace is scoped to the logged-in student and includes password plus essay actions', () => {
  assert.match(mainSource, /function StudentWorkspacePage/);
  assert.match(mainSource, /String\(session\?\.studentId\) !== String\(studentId\)/);
  assert.match(mainSource, /只能进入自己的独立界面/);
  assert.match(mainSource, /<PasswordCard \/>/);
  assert.match(mainSource, /我的作文与结果/);
  assert.match(mainSource, /拍照上传/);
  assert.match(mainSource, /文字提交/);
  assert.match(mainSource, /查看结果/);
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
  assert.match(teacherReviewCenter, /href=\{`\/review\/\$\{essay\.id\}`\}/);
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
  assert.match(teacherReviewCenter, /href=\{`\/review\/\$\{essay\.id\}`\}/);
  assert.match(teacherReviewCenter, /点击查看/);
});

test('student workspace exposes assignment upload review and upgraded-essay copy path', () => {
  const workspace = functionBody('StudentWorkspacePage');
  assert.match(workspace, /作文任务/);
  assert.match(workspace, /href=\{`\/upload\?assignmentId=\$\{a\.id\}`\}/);
  assert.match(workspace, /查看AI批改情况/);
  assert.match(workspace, /复制升格文章/);
  assert.match(mainSource, /FullEssayUpgradePanel/);
  assert.match(mainSource, /复制升格文章/);
});

test('student submit page keeps the selected assignment when switching to photo upload', () => {
  const submitPage = functionBody('SubmitPage');
  assert.match(submitPage, /href=\{`\/upload\?assignmentId=\$\{assignmentId\}`\}/);
  assert.match(submitPage, /请输入或粘贴\/黏贴作文正文/);
});

test('student photo upload sends images directly for AI recognition and review', () => {
  const uploadPage = functionBody('UploadPage');
  assert.match(uploadPage, /api\('\/essays\/images'/);
  assert.match(uploadPage, /FormData/);
  assert.match(uploadPage, /fd\.append\('assignment_id', assignmentId\)/);
  assert.match(uploadPage, /fd\.append\('images', file\)/);
  assert.match(uploadPage, /nav\(`\/review\/\$\{data\.essayId\}`\)/);
  assert.match(uploadPage, /capture="environment"/);
  assert.match(uploadPage, /accept="image\/\*"/);
  assert.doesNotMatch(uploadPage, /\/essays\/ocr|\/confirm|pendingEssayImages|确认文字/);
  assert.doesNotMatch(mainSource, /function ConfirmPage|Route path="\/confirm"/);
});

test('backend image upload route recognizes photos and creates a reviewed essay', () => {
  assert.match(essayRoutesSource, /essayRouter\.post\('\/images'/);
  assert.match(essayRoutesSource, /upload\.array\('images', 8\)/);
  assert.match(essayRoutesSource, /recognizeImages\(req\.files \|\| \[\]\)/);
  assert.match(essayRoutesSource, /createReviewedEssay/);
  assert.match(essayRoutesSource, /请先选择照片或图片/);
});

test('student submit page shows upload and review errors instead of failing silently', () => {
  const submitPage = functionBody('SubmitPage');
  assert.match(submitPage, /busy/);
  assert.match(submitPage, /setError/);
  assert.match(submitPage, /catch \(err\)/);
  assert.match(submitPage, /提交失败/);
  assert.match(submitPage, /请先粘贴或输入作文正文/);
  assert.match(submitPage, /tooShort/);
  assert.match(submitPage, /tooLong/);
  assert.match(submitPage, /disabled=\{busy \|\| !text\.trim\(\) \|\| tooShort \|\| tooLong\}/);
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

test('student workspace essay result records render as one-line rows', () => {
  const workspace = functionBody('StudentWorkspacePage');
  assert.match(workspace, /className="item essay-result-line"/);
  assert.match(workspace, /className="essay-result-title"/);
  assert.match(workspace, /className="essay-result-meta"/);
  assert.doesNotMatch(workspace, /<Card title="我的作文与结果"[\s\S]*?<p>\{essay\.assignment_title\}/);
});

test('student workspace merges duplicate essay results and repeated assignment title text', () => {
  const workspace = functionBody('StudentWorkspacePage');
  assert.match(workspace, /uniqueEssays/);
  assert.match(workspace, /new Map\(\)/);
  assert.match(workspace, /essay\.assignment_id \|\| essay\.assignment_title \|\| essay\.title/);
  assert.match(workspace, /uniqueEssays\.map/);
  assert.match(workspace, /assignmentLabel !== displayTitle/);
  assert.doesNotMatch(workspace, /essays\.map\(\(essay\) => <article className="item essay-result-line"/);
});

test('student home merges duplicate essay result records into one unit', () => {
  const studentHome = functionBody('StudentHome');
  assert.match(studentHome, /uniqueEssays/);
  assert.match(studentHome, /uniqueEssays\.map/);
  assert.match(studentHome, /assignmentLabel !== displayTitle/);
  assert.doesNotMatch(studentHome, /essays\.map\(\(essay\) => <article className="item"/);
});

test('student workspace assignment items expand to show teacher prompt and assignment time', () => {
  const workspace = functionBody('StudentWorkspacePage');
  assert.match(workspace, /activeAssignmentId/);
  assert.match(workspace, /onClick=\{\(\) => setActiveAssignmentId/);
  assert.match(workspace, /教师布置/);
  assert.match(workspace, /布置时间/);
  assert.match(workspace, /formatDateTime\(a\.created_at\)/);
  assert.match(workspace, /a\.prompt/);
});

test('student home no longer renders the writing resource library module', () => {
  const studentHome = functionBody('StudentHome');
  assert.doesNotMatch(studentHome, /WritingResourceLibrary/);
  assert.doesNotMatch(studentHome, /写作训练库/);
});

test('teacher home only keeps assignment publishing class setup roster import review and results', () => {
  const teacherHome = functionBody('TeacherHome');
  assert.match(teacherHome, /AssignmentPublish/);
  assert.match(teacherHome, /AssignmentManagement/);
  assert.match(teacherHome, /ClassManagement/);
  assert.match(teacherHome, /TeacherReviewCenter/);
  assert.match(teacherHome, /TeacherInsightPanel/);
  assert.match(teacherHome, /PublicAccessPanel/);
  assert.match(teacherHome, /PasswordCard/);
  assert.match(teacherHome, /teacher-banner/);
  assert.match(teacherHome, /GraduationCap/);
  assert.doesNotMatch(teacherHome, /QuickLinks|TeacherReportsPanel|MaterialLibrary/);
  assert.match(mainSource, /班级作业/);
  assert.match(mainSource, /批改记录/);
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

  assert.doesNotMatch(studentHome, /invite|邀请码|\/classes\/join/);
  assert.doesNotMatch(classManagement, /invite|邀请码/);
  assert.doesNotMatch(classRosterPanel, /invite|邀请码/);
  assert.doesNotMatch(classRoutesSource, /\/join|invite_code|邀请码/);
});

test('student home shows a dedicated student marker banner above the workspace cards', () => {
  const studentHome = functionBody('StudentHome');
  assert.match(studentHome, /student-banner/);
  assert.match(studentHome, /Users/);
  assert.match(studentHome, /学生端/);
  assert.match(studentHome, /作文提交、批改结果与个人成长/);
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
  const studentHome = functionBody('StudentHome');
  assert.doesNotMatch(studentHome, /高考阅卷模拟/);
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

test('teacher class management merges repeated roster import controls into one entry', () => {
  const classManagement = functionBody('ClassManagement');
  const classRosterPanel = functionBody('ClassRosterPanel');
  assert.equal(countMatches(classManagement, /批量导入学生名单/g), 1);
  assert.match(classManagement, /importClassId/);
  assert.match(classManagement, /rosterText/);
  assert.doesNotMatch(classRosterPanel, /批量导入学生名单|rosterText|addStudents/);
});

test('teacher class management exposes add and delete controls for classes and roster students', () => {
  const classManagement = functionBody('ClassManagement');
  const classRosterPanel = functionBody('ClassRosterPanel');
  assert.match(classManagement, /新增班级/);
  assert.match(classManagement, /deleteClass/);
  assert.match(classManagement, /`\/classes\/\$\{deleteClassId\}`/);
  assert.match(classManagement, /新增学生/);
  assert.match(classManagement, /addSingleStudent/);
  assert.match(classRosterPanel, /删除学生/);
  assert.match(classRosterPanel, /removeStudent\(student\.id\)/);
});

test('student roster displays a deduplicated list while preserving workspace links', () => {
  const studentHome = functionBody('StudentHome');
  const workspace = functionBody('StudentWorkspacePage');
  assert.match(studentHome, /uniqueStudents/);
  assert.match(studentHome, /uniqueStudents\.map/);
  assert.match(studentHome, /href=\{`\/student\/workspace\/\$\{student\.id\}`\}/);
  assert.match(workspace, /uniqueStudents/);
  assert.match(workspace, /uniqueStudents\.find\(\(student\) => student\.is_current_user\)/);
});

test('student home and workspace prefer named classes and safely label blank ones', () => {
  const studentHome = functionBody('StudentHome');
  const workspace = functionBody('StudentWorkspacePage');
  assert.match(mainSource, /function pickDefaultClassId/);
  assert.match(mainSource, /function getClassDisplayName/);
  assert.match(mainSource, /未命名班级/);
  assert.match(studentHome, /pickDefaultClassId\(rows\)/);
  assert.match(workspace, /pickDefaultClassId\(rows\)/);
  assert.match(studentHome, /getClassDisplayName\(selectedClass\)/);
  assert.match(workspace, /getClassDisplayName\(selectedClass\)/);
});

test('frontend exposes separated teacher, student and administrator entrances', () => {
  const adminHome = functionBody('AdminHome');
  assert.match(mainSource, /path="\/teacher"/);
  assert.match(mainSource, /path="\/student"/);
  assert.match(mainSource, /path="\/submit\/:assignmentId"/);
  assert.match(mainSource, /path="\/admin"/);
  assert.match(mainSource, /roles=\{\['admin'\]\}/);
  assert.match(adminHome, /系统配置/);
  assert.match(adminHome, /模型配置/);
  assert.match(adminHome, /WebDAV 状态/);
  assert.doesNotMatch(adminHome, /发布作业|创建作文作业|批量启动 AI 批改/);
});

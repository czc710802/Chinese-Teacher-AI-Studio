import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, setSession, getSession } from './api/client.js';
import './styles/app.css';
import { ArrowLeft, BookOpen, Camera, ChartNoAxesCombined, Check, ChevronUp, Copy, Download, FileText, Filter, GraduationCap, Home, LockKeyhole, LogOut, MoreHorizontal, PackageOpen, PenLine, Plus, Search, School, Send, Share2, Star, TestTube2, Trash2, UserPlus, Users } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Sparkles, MessageCircle, Trophy, Newspaper, Bookmark, RotateCcw, TrendingUp, BrainCircuit, Scale, FileSpreadsheet } from 'lucide-react';

const homeByRole = { student: '/student', teacher: '/teacher', admin: '/admin' };
const roleLabel = { student: '学生端', teacher: '教师端', admin: '管理员端' };

function pickDefaultClassId(rows = []) {
  const namedClass = rows.find((item) => String(item?.name || '').trim());
  return String((namedClass || rows[0])?.id || '');
}

function getClassDisplayName(klass) {
  const trimmed = String(klass?.name || '').trim();
  if (trimmed) return trimmed;
  if (klass?.id) return `未命名班级 #${klass.id}`;
  return '未命名班级';
}

function formatDateTime(value) {
  if (!value) return '未设置';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function Layout({ children }) {
  const nav = useNavigate();
  const session = getSession();
  function logout() {
    localStorage.removeItem('session');
    nav('/login');
  }
  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">高中作文 AI 批改 · {roleLabel[session?.role] || '登录'}</p>
          <h1>{session?.name || '写作成长中心'}</h1>
        </div>
        {session && <button className="icon-btn" onClick={logout} title="退出"><LogOut size={18} /></button>}
      </header>
      <main>{children}</main>
    </div>
  );
}

function Card({ title, icon, children, action, className = '' }) {
  return <section className={`card ${className}`.trim()}><div className="card-head"><h2>{title}</h2>{icon}{action}</div>{children}</section>;
}

function LoginPage() {
  const location = useLocation();
  const [form, setForm] = useState(() => (location.state?.role === 'student'
    ? { username: 'student', password: '123456' }
    : { username: 'teacher', password: '123456' }));
  const [error, setError] = useState('');
  const nav = useNavigate();
  async function submit(e) {
    e.preventDefault();
    try {
      const data = await api('/auth/login', { method: 'POST', body: form });
      setSession(data.user);
      nav(location.state?.returnTo || homeByRole[data.user.role]);
    } catch (err) {
      setError(err.message);
    }
  }
  return <Layout><div className="login-stage">
    <form className="login" onSubmit={submit}>
      <GraduationCap size={42} />
      <h2>登录写作批改平台</h2>
      <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="账号" />
      <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="密码" />
      {error && <p className="error">{error}</p>}
      <button><Send size={18} />登录</button>
      <p className="hint">演示账号：teacher / student，密码均为 123456</p>
    </form>
    <PublicAccessPanel title="公网演示入口" intro="手机浏览器打开这个地址，或在展示现场复制给听众访问。" compact />
  </div></Layout>;
}



// ==================== AI 辅导老师 ====================
function AiTutorChat({ essayId }) {
  const session = getSession();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  
  useEffect(() => {
    if (open && essayId) {
      api(`/ai/tutor/history/${essayId}`).then(setMessages).catch(() => {});
    }
  }, [open, essayId]);
  
  async function send() {
    if (!input.trim() || busy) return;
    const q = input;
    setInput('');
    setError('');
    setMessages((prev) => [...prev, { role: 'student', message: q, created_at: new Date().toISOString() }]);
    setBusy(true);
    try {
      const result = await api('/ai/tutor/chat', {
        method: 'POST',
        body: { essay_id: essayId, question: q, history: messages.slice(-6) }
      });
      setMessages((prev) => [...prev, { role: 'ai', message: result.answer, created_at: new Date().toISOString() }]);
    } catch (err) {
      setError(err.message || 'AI 辅导服务暂时不可用，请稍后再试。');
    }
    setBusy(false);
  }

  if (session?.role !== 'student') return null;
  
  return (
    <div className="ai-tutor-wrapper">
      <button className={`ai-tutor-toggle ${open ? 'active' : ''}`} onClick={() => setOpen(!open)}>
        <MessageCircle size={20} /> AI 辅导老师
      </button>
      {open && <div className="ai-tutor-panel">
        <div className="ai-tutor-header">
          <BrainCircuit size={18} /> <b>AI 作文辅导</b>
          <button className="icon-btn" style={{marginLeft:'auto',minHeight:32,width:32}} onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="ai-tutor-messages">
          {messages.length === 0 && <p className="ai-tutor-welcome">你好！我是你的 AI 作文辅导老师。你可以问我关于这篇作文的问题，比如为什么得这个分数、哪里可以改进、如何提升立意等。</p>}
          {messages.map((m, i) => (
            <div key={i} className={`tutor-msg ${m.role}`}>
              <b>{m.role === 'student' ? '我' : 'AI老师'}</b>
              <p>{m.message}</p>
            </div>
          ))}
          {busy && <div className="tutor-msg ai"><b>AI老师</b><p>正在思考...</p></div>}
          {error && <p className="error">{error}</p>}
        </div>
        <div className="ai-tutor-input">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="输入你的问题..." />
          <button onClick={send} disabled={busy}><Send size={16} /></button>
        </div>
      </div>}
    </div>
  );
}

// ==================== AI 仿写训练 ====================
function AiWritingExercise() {
  const [sourceText, setSourceText] = useState('');
  const [exType, setExType] = useState('imitation');
  const [exercise, setExercise] = useState(null);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  
  useEffect(() => { api('/ai/writing-exercises').then(setHistory).catch(() => {}); }, []);
  
  async function generate() {
    if (!sourceText.trim()) return;
    setBusy(true);
    setExercise(null);
    setFeedback(null);
    setAnswer('');
    try {
      const result = await api('/ai/writing-exercise/generate', {
        method: 'POST', body: { source_text: sourceText, exercise_type: exType }
      });
      setExercise(result);
    } catch (err) { alert('生成失败：' + err.message); }
    setBusy(false);
  }
  
  async function submit() {
    if (!answer.trim() || !exercise?.id) return;
    setBusy(true);
    try {
      const result = await api('/ai/writing-exercise/submit', {
        method: 'POST', body: { exercise_id: exercise.id, answer }
      });
      setFeedback(result);
      const rows = await api('/ai/writing-exercises');
      setHistory(rows);
    } catch (err) { alert('提交失败：' + err.message); }
    setBusy(false);
  }
  
  return <Card title="AI 仿写训练" icon={<PenLine size={20} />}>
    <div className="form-stack">
      <select value={exType} onChange={(e) => setExType(e.target.value)}>
        <option value="imitation">仿写练习</option>
        <option value="continuation">续写练习</option>
        <option value="rewrite">改写练习</option>
        <option value="outline">提纲练习</option>
      </select>
      <textarea rows="6" placeholder="粘贴范文或优秀作文片段..." value={sourceText} onChange={(e) => setSourceText(e.target.value)} />
      <button onClick={generate} disabled={busy}>{busy ? '生成中...' : '生成练习题'}</button>
      
      {exercise && <>
        <div className="exercise-content" style={{marginTop:12}}>
          <p><b>题目</b> {exercise.instruction}</p>
          <p><b>提示</b> {exercise.hint}</p>
          {exercise.reference_outline && <p><b>参考结构</b> {exercise.reference_outline}</p>}
        </div>
        <textarea rows="5" placeholder="在此写你的回答..." value={answer} onChange={(e) => setAnswer(e.target.value)} />
        <button onClick={submit} disabled={busy}>提交练习</button>
      </>}
      
      {feedback && <div className="success" style={{marginTop:12}}>
        <p><b>AI 反馈：</b>{feedback.feedback}</p>
        <p><b>得分：</b>{feedback.score}/100</p>
      </div>}
      
      {history.length > 0 && <>
        <h3 style={{margin:'16px 0 8px'}}>练习记录</h3>
        {history.slice(0, 5).map((h, i) => <div key={i} className="item"><p>{JSON.parse(h.exercise_prompt || '{}').instruction || '练习'} <span className="hint">{h.completed ? '✓ 已完成' : '待完成'}</span></p></div>)}
      </>}
    </div>
  </Card>;
}

// ==================== AI 升格训练 ====================
function AiUpgradeTrainer() {
  const [essayId, setEssayId] = useState('');
  const [originalText, setOriginalText] = useState('');
  const [originalScore, setOriginalScore] = useState(42);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [records, setRecords] = useState([]);
  const [tab, setTab] = useState('new');
  
  useEffect(() => { api('/ai/upgrade-records').then(setRecords).catch(() => {}); }, []);
  
  async function startUpgrade() {
    const text = essayId 
      ? (await api(`/essays/${essayId}`)).essay.original_text 
      : originalText;
    if (!text) return alert('请提供作文内容');
    setBusy(true);
    try {
      const result = await api('/ai/upgrade', {
        method: 'POST', body: { essay_id: essayId || undefined, original_text: text, original_score: originalScore }
      });
      setResult(result);
      const rows = await api('/ai/upgrade-records');
      setRecords(rows);
    } catch (err) { alert('升格失败：' + err.message); }
    setBusy(false);
  }
  
  return <Card title="AI 升格训练" icon={<TrendingUp size={20} />}>
    <div className="segment-tabs">
      <button className={tab === 'new' ? 'active' : ''} onClick={() => setTab('new')}>新升级</button>
      <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>历史记录</button>
    </div>
    
    {tab === 'new' ? <div className="form-stack">
      <input placeholder="作文ID（可选，留空则粘贴原文）" value={essayId} onChange={(e) => setEssayId(e.target.value)} />
      {!essayId && <textarea rows="6" placeholder="粘贴作文原文..." value={originalText} onChange={(e) => setOriginalText(e.target.value)} />}
      <div className="row"><span style={{flex:0}}>当前分数：</span><input type="number" value={originalScore} onChange={(e) => setOriginalScore(Number(e.target.value))} style={{width:80}} /></div>
      <button onClick={startUpgrade} disabled={busy}>{busy ? '升格中...' : '开始升格训练'}</button>
      
      {result && <div className="upgrade-result" style={{marginTop:16}}>
        <div className="stats"><span>原文 {result.original_score}分</span><Trophy size={20} /><span>升格 {result.upgraded_score}分</span><RotateCcw size={20} /></div>
        <p className="hint">{result.change_summary}</p>
        
        {result.paragraph_changes?.map((change, i) => <div key={i} className="item">
          <h4>{change.part}</h4>
          <div className="comparison-text" style={{margin:'6px 0'}}><span className="original-muted">原文：</span><span className="deleted-text">{change.original}</span></div>
          <div className="comparison-text"><span className="added-text">升格：</span><span className="changed-text">{change.upgraded}</span></div>
          <p className="hint" style={{marginTop:4}}>修改理由：{change.reason}</p>
        </div>)}
        
        <h4 style={{marginTop:12}}>升格后全文</h4>
        <div className="comparison-text">{result.upgraded_text}</div>
        
        <div className="chips" style={{marginTop:12}}>
          {result.key_improvements?.map((imp, i) => <span key={i}>+{imp}</span>)}
        </div>
      </div>}
    </div> : <div>
      {records.map((r, i) => <div key={i} className="item">
        <div className="row"><span>原文 {r.original_score}分 → 升格 {r.upgraded_score}分</span><span className="hint">{r.created_at}</span></div>
        <p className="hint">{r.upgrade_report.change_summary || '查看详情'}</p>
      </div>)}
      {records.length === 0 && <p className="hint">暂无升格记录</p>}
    </div>}
  </Card>;
}

function FullEssayUpgradePanel({ essayId, originalText, originalScore }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const data = await api('/ai/upgrade', {
        method: 'POST',
        body: { essay_id: essayId, original_text: originalText, original_score: originalScore }
      });
      setResult(data);
    } catch (err) {
      setError(err.message || '整篇升格失败，请稍后再试。');
    }
    setBusy(false);
  }

  return <section className="review-card full-upgrade-card">
    <SectionTitle title="整篇升格文章" actions={<button className="mini-action" onClick={generate} disabled={busy}>{busy ? '正在生成...' : result ? '重新生成' : '生成整篇升格稿'}</button>} />
    <p className="hint">基于你的原文和本次批改结果，保留核心观点与基本结构，输出可直接参考的完整升格文章。</p>
    {error && <p className="error">{error}</p>}
    {result && <>
      <div className="upgrade-score-line">原文 {result.original_score} 分 <TrendingUp size={17} /> 升格目标 {result.upgraded_score} 分</div>
      <p className="upgrade-summary">{result.change_summary}</p>
      <article className="full-upgraded-essay">
        <div className="full-upgraded-essay-head"><b>升格后全文</b><CopyTextButton text={result.upgraded_text} label="复制升格文章" /></div>
        <p>{result.upgraded_text}</p>
      </article>
      {!!result.key_improvements?.length && <div className="chips">{result.key_improvements.map((item, index) => <span key={index}>+{item}</span>)}</div>}
    </>}
  </section>;
}

// ==================== 教师报告系统 ====================
function TeacherReportsPanel() {
  const [daily, setDaily] = useState(null);
  const [weekly, setWeekly] = useState(null);
  const [classId, setClassId] = useState('');
  const [classes, setClasses] = useState([]);
  const [busy, setBusy] = useState(false);
  
  useEffect(() => { 
    api('/classes').then(setClasses).catch(() => {});
    api('/ai/teacher/reports/daily').then((rows) => {
      if (rows.length > 0) setDaily(rows[0].report_data);
    }).catch(() => {});
  }, []);
  
  async function genDaily() {
    setBusy(true);
    const data = await api('/ai/teacher/report/generate', { method: 'POST', body: { report_type: 'daily' } });
    setDaily(data);
    setBusy(false);
  }
  
  async function genWeekly() {
    if (!classId) return alert('请选择班级');
    setBusy(true);
    const data = await api('/ai/teacher/report/generate', { method: 'POST', body: { report_type: 'weekly', class_id: Number(classId) } });
    setWeekly(data);
    setBusy(false);
  }
  
  return <Card title="教学报告" icon={<Newspaper size={20} />}>
    <div className="segment-tabs">
      <button className={daily ? 'active' : ''} onClick={genDaily} disabled={busy}>
        📰 生成晨报
      </button>
      <button onClick={genWeekly} disabled={busy}>
        📊 生成周报/月报
      </button>
    </div>
    
    {daily && <div className="resource-grid" style={{marginTop:12}}>
      <section><h3>🔥 教育热点</h3><p><b>{daily.hot_topic?.title}</b><br/>{daily.hot_topic?.content}</p></section>
      <section><h3>📌 高考资讯</h3><p>{daily.exam_news}</p></section>
      <section><h3>📖 作文素材</h3><p><b>{daily.material?.event}</b><br/>运用角度：{daily.material?.angles?.join('、')}</p></section>
      <section><h3>💬 时评金句</h3><p>"{daily.quote?.text}"<br/><span className="hint">来源：{daily.quote?.source}</span></p></section>
      <section><h3>📚 名言积累</h3><p>"{daily.famous_saying?.text}"<br/><span className="hint">{daily.famous_saying?.author} · 适用：{daily.famous_saying?.usage}</span></p></section>
    </div>}
    
    <div className="form-stack" style={{marginTop:12}}>
      <select value={classId} onChange={(e) => setClassId(e.target.value)}>
        <option value="">选择班级</option>
        {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
    
    {weekly && <div style={{marginTop:12}}>
      <h3>学情诊断</h3>
      <p>{weekly.insight?.diagnosis}</p>
      <div className="chips">
        {weekly.insight?.teaching_suggestions?.map((s, i) => <span key={i} style={{background: s.priority === '高' ? '#fce4e4' : '#e5efe9'}}>{s.content}</span>)}
      </div>
      <h3>数据概览</h3>
      <div className="stats">
        <span>平均 {weekly.analytics?.averageScore}分</span>
        <span>最高 {weekly.analytics?.maxScore}分</span>
        <span>最低 {weekly.analytics?.minScore}分</span>
      </div>
    </div>}
  </Card>;
}

// ==================== 素材库 ====================
function MaterialLibrary() {
  const [materials, setMaterials] = useState([]);
  const [category, setCategory] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ category: 'quote', sub_category: '', title: '', content: '', source: '', tags: '' });
  
  useEffect(() => { load(); }, [category]);
  
  async function load() {
    const params = category ? '?category=' + category : '';
    const rows = await api('/ai/materials' + params);
    setMaterials(rows);
  }
  
  async function addMaterial() {
    await api('/ai/materials', {
      method: 'POST',
      body: { ...form, tags: form.tags.split(/[,，、]/).map((t) => t.trim()).filter(Boolean) }
    });
    setShowAdd(false);
    setForm({ category: 'quote', sub_category: '', title: '', content: '', source: '', tags: '' });
    load();
  }
  
  return <Card title="素材库" icon={<Bookmark size={20} />}>
    <div className="row">
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">全部</option>
        <option value="quote">名人名言</option>
        <option value="current_event">时事素材</option>
        <option value="excellent_essay">优秀范文</option>
        <option value="classic_case">经典案例</option>
      </select>
      <button className="ghost" onClick={() => setShowAdd(!showAdd)}>+ 添加</button>
    </div>
    
    {showAdd && <div className="form-stack" style={{marginTop:10}}>
      <select value={form.category} onChange={(e) => setForm({...form, category: e.target.value})}>
        <option value="quote">名人名言</option>
        <option value="current_event">时事素材</option>
        <option value="excellent_essay">优秀范文</option>
        <option value="classic_case">经典案例</option>
      </select>
      <input placeholder="标题/作者" value={form.title} onChange={(e) => setForm({...form, title: e.target.value})} />
      <textarea rows="4" placeholder="内容" value={form.content} onChange={(e) => setForm({...form, content: e.target.value})} />
      <input placeholder="来源" value={form.source} onChange={(e) => setForm({...form, source: e.target.value})} />
      <input placeholder="标签（用逗号分隔）" value={form.tags} onChange={(e) => setForm({...form, tags: e.target.value})} />
      <button onClick={addMaterial}>保存素材</button>
    </div>}
    
    <div style={{marginTop:12}}>
      {materials.map((m) => <div key={m.id} className="item">
        <h4 style={{margin:'0 0 4px'}}>{m.title} <span className="hint">{m.sub_category}</span></h4>
        <p>{m.content.slice(0, 120)}...</p>
        <div className="chips" style={{marginTop:4}}>
          {m.tags?.map((t, i) => <span key={i}>{t}</span>)}
          <span className="hint">使用 {m.usage_count} 次</span>
        </div>
      </div>)}
      {materials.length === 0 && <p className="hint">暂无素材，点击"+ 添加"开始积累</p>}
    </div>
  </Card>;
}

function StudentHome() {
  const [classes, setClasses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [students, setStudents] = useState([]);
  const [essays, setEssays] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  useEffect(() => { api('/classes').then((rows) => { setClasses(rows); setSelectedClassId(pickDefaultClassId(rows)); }); }, []);
  useEffect(() => {
    if (!selectedClassId) {
      setAssignments([]);
      setStudents([]);
      setEssays([]);
      return;
    }
    api(`/assignments?classId=${selectedClassId}`).then(setAssignments);
    api(`/classes/${selectedClassId}/students`).then(setStudents);
    api(`/essays?classId=${selectedClassId}`).then(setEssays);
  }, [selectedClassId]);
  const selectedClass = classes.find((item) => String(item.id) === selectedClassId);
  const uniqueStudents = useMemo(() => {
    const seen = new Map();
    for (const student of students) {
      const key = student.student_no || student.id || student.name;
      const existing = seen.get(key);
      if (!existing || student.is_current_user) seen.set(key, student);
    }
    return Array.from(seen.values());
  }, [students]);
  const currentStudent = uniqueStudents.find((student) => student.is_current_user);
  const uniqueEssays = useMemo(() => {
    const seen = new Map();
    for (const essay of essays) {
      const key = essay.assignment_id || essay.assignment_title || essay.title || essay.id;
      if (!seen.has(key)) seen.set(key, essay);
    }
    return Array.from(seen.values());
  }, [essays]);
  return <Layout>
    <section className="role-banner student-banner">
      <div className="role-banner-mark"><Users size={28} /></div>
      <div>
        <p>学生端</p>
        <h2>作文提交、批改结果与个人成长</h2>
      </div>
    </section>
    <div className="grid">
      <Card title="我的班级" icon={<School size={20} />}>
        <div className="class-picker">{classes.map((x) => <button key={x.id} className={String(x.id) === selectedClassId ? 'active' : ''} onClick={() => setSelectedClassId(String(x.id))}>{getClassDisplayName(x)}</button>)}</div>
        {selectedClass && <p className="hint">{getClassDisplayName(selectedClass)} · {selectedClass.grade || '未填写年级'}</p>}
        {!classes.length && <p className="hint">当前还没有关联班级，请联系教师在班级管理中添加学生名单。</p>}
      </Card>
      <Card title={`${selectedClass?.name || '班级'}学生名单`} icon={<Users size={20} />}>
        <div className="student-roster-list">
          {uniqueStudents.map((student) => <a key={student.id} href={`/student/workspace/${student.id}`} className={student.is_current_user ? 'current' : ''} title={`${student.name}的独立界面`}>
            {student.student_no || '--'} · {student.name}{student.is_current_user ? '（我）' : ''}
            <small>进入拍照、提交、查看结果</small>
          </a>)}
        </div>
        {!uniqueStudents.length && <p className="hint">当前班级还没有可显示的学生名单。</p>}
      </Card>
      <Card title="作文任务" icon={<BookOpen size={20} />} action={currentStudent ? <a className="mini-action" href={`/student/workspace/${currentStudent.id}`}>我的作文入口</a> : null}>
        {assignments.map((a) => <article className="item" key={a.id}>
          <b>{a.title}</b>
          <p>{a.essay_type} · 满分 {a.full_score}{a.deadline ? ` · 截止 ${a.deadline}` : ''}</p>
          <div className="actions"><a href={`/submit/${a.id}`}>文字提交</a><a href={`/upload?assignmentId=${a.id}`}>拍照上传</a></div>
        </article>)}
        {!assignments.length && <p className="hint">当前班级暂无作文任务。</p>}
      </Card>
      <Card title="我的作文与结果" icon={<FileText size={20} />}>
        <div id="my-essay-workspace" className="student-workspace-anchor" />
        {currentStudent && <p className="hint">已进入 {currentStudent.name} 的作文拍照、提交、查看批阅结果入口。</p>}
        {uniqueEssays.map((essay) => {
          const displayTitle = essay.title || essay.assignment_title || '未命名作文';
          const assignmentLabel = essay.assignment_title || '';
          const metaPrefix = assignmentLabel && assignmentLabel !== displayTitle ? `${assignmentLabel} · ` : '';
          return <article className="item" key={essay.id}>
            <b>{displayTitle}</b>
            <p>{metaPrefix}{essay.total_score ?? '--'}分 · {essay.level || '待批改'}</p>
            <a href={`/student/essays/${essay.id}/report`}>{essay.total_score == null ? '查看批改进度' : '查看我的批改 / 复制升格文章'}</a>
          </article>;
        })}
        {!uniqueEssays.length && <p className="hint">还没有提交记录。可从上方作文任务进入上传或提交。</p>}
      </Card>
      <PasswordCard />
      <AiWritingExercise />
      <AiUpgradeTrainer />
      <QuickLinks role="student" />
    </div>
  </Layout>;
}

function StudentWorkspacePage() {
  const { studentId } = useParams();
  const session = getSession();
  const isBlockedWorkspace = String(session?.studentId) !== String(studentId);
  const isOwnWorkspace = !isBlockedWorkspace;
  const [classes, setClasses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [essays, setEssays] = useState([]);
  const [students, setStudents] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [activeAssignmentId, setActiveAssignmentId] = useState(null);

  useEffect(() => {
    if (!isOwnWorkspace) return;
    api('/classes').then((rows) => { setClasses(rows); setSelectedClassId(pickDefaultClassId(rows)); });
  }, [isOwnWorkspace]);

  useEffect(() => {
    if (!isOwnWorkspace || !selectedClassId) {
      setAssignments([]);
      setEssays([]);
      setStudents([]);
      return;
    }
    api(`/assignments?classId=${selectedClassId}`).then(setAssignments);
    api(`/essays?classId=${selectedClassId}`).then(setEssays);
    api(`/classes/${selectedClassId}/students`).then(setStudents);
  }, [isOwnWorkspace, selectedClassId]);

  if (isBlockedWorkspace) {
    return <Layout><Card title="学生独立界面" icon={<LockKeyhole size={20} />}>
      <p className="error">只能进入自己的独立界面。请退出后使用该学生账号登录，再点击自己的名字进入。</p>
      <a className="button-link" href="/student">返回学生名单</a>
    </Card></Layout>;
  }

  const selectedClass = classes.find((item) => String(item.id) === selectedClassId);
  const uniqueStudents = useMemo(() => {
    const seen = new Map();
    for (const student of students) {
      const key = student.student_no || student.id || student.name;
      const existing = seen.get(key);
      if (!existing || student.is_current_user) seen.set(key, student);
    }
    return Array.from(seen.values());
  }, [students]);
  const currentStudent = uniqueStudents.find((student) => student.is_current_user);
  const uniqueEssays = useMemo(() => {
    const seen = new Map();
    for (const essay of essays) {
      const key = essay.assignment_id || essay.assignment_title || essay.title || essay.id;
      if (!seen.has(key)) seen.set(key, essay);
    }
    return Array.from(seen.values());
  }, [essays]);

  return <Layout>
    <div className="grid">
      <Card title={`${currentStudent?.name || session?.name || '我的'}独立界面`} icon={<Users size={20} />}>
        <div className="class-picker">{classes.map((x) => <button key={x.id} className={String(x.id) === selectedClassId ? 'active' : ''} onClick={() => setSelectedClassId(String(x.id))}>{getClassDisplayName(x)}</button>)}</div>
        {selectedClass && <p className="hint">{getClassDisplayName(selectedClass)} · {selectedClass.grade || '未填写年级'} · 当前账号只管理自己的作文。</p>}
      </Card>
      <PasswordCard />
      <Card title="作文任务" icon={<BookOpen size={20} />}>
        {assignments.map((a) => <article className={activeAssignmentId === a.id ? 'item assignment-task-card active' : 'item assignment-task-card'} key={a.id} onClick={() => setActiveAssignmentId(activeAssignmentId === a.id ? null : a.id)} role="button" tabIndex="0" onKeyDown={(e) => { if (e.key === 'Enter') setActiveAssignmentId(activeAssignmentId === a.id ? null : a.id); }}>
          <div className="assignment-task-head">
            <b>{a.title}</b>
            <span>{activeAssignmentId === a.id ? '收起任务' : '点击查看教师布置'}</span>
          </div>
          <p>{a.essay_type} · 满分 {a.full_score}</p>
          <p className="assignment-time">布置时间 {formatDateTime(a.created_at)} · 截止时间 {formatDateTime(a.deadline)}</p>
          {activeAssignmentId === a.id && <div className="assignment-prompt"><b>教师布置</b><p>{a.prompt || '教师暂未填写具体写作要求。'}</p></div>}
          <div className="actions"><a href={`/submit/${a.id}`}>文字提交</a><a href={`/upload?assignmentId=${a.id}`}>拍照上传</a></div>
        </article>)}
        {!assignments.length && <p className="hint">当前班级暂无作文任务。</p>}
      </Card>
      <Card title="我的作文与结果" icon={<FileText size={20} />}>
        {uniqueEssays.map((essay) => {
          const displayTitle = essay.title || essay.assignment_title || '未命名作文';
          const assignmentLabel = essay.assignment_title || '';
          const metaPrefix = assignmentLabel && assignmentLabel !== displayTitle ? `${assignmentLabel} · ` : '';
          return <article className="item essay-result-line" key={essay.id}>
            <b className="essay-result-title">{displayTitle}</b>
            <span className="essay-result-meta">{metaPrefix}{essay.total_score ?? '--'}分 · {essay.level || '待批改'}</span>
            <a href={`/student/essays/${essay.id}/report`}>{essay.total_score == null ? '查看批改进度' : '查看我的批改 / 复制升格文章'}</a>
          </article>;
        })}
        {!essays.length && <p className="hint">还没有提交记录。可从上方作文任务进入拍照上传或文字提交。</p>}
      </Card>
      <QuickLinks role="student" />
    </div>
  </Layout>;
}

function PasswordCard() {
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setMessage('');
    setError('');
    if (form.new_password !== form.confirm_password) return setError('两次输入的新密码不一致');
    try {
      const data = await api('/auth/change-password', { method: 'POST', body: form });
      setMessage(data.message);
      setForm({ current_password: '', new_password: '', confirm_password: '' });
    } catch (err) {
      setError(err.message);
    }
  }
  return <Card title="修改密码" icon={<LockKeyhole size={20} />}>
    <form className="form-stack" onSubmit={submit}>
      <input type="password" placeholder="当前密码" value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} />
      <input type="password" placeholder="新密码" value={form.new_password} onChange={(e) => setForm({ ...form, new_password: e.target.value })} />
      <input type="password" placeholder="确认新密码" value={form.confirm_password} onChange={(e) => setForm({ ...form, confirm_password: e.target.value })} />
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}
      <button>更新密码</button>
    </form>
  </Card>;
}

function UploadPage() {
  const assignmentId = new URLSearchParams(location.search).get('assignmentId') || '';
  const needsConfirm = new URLSearchParams(location.search).get('confirm') === 'ocr';
  const [title, setTitle] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nav = useNavigate();
  function chooseFiles(e) {
    setFiles(Array.from(e.target.files || []));
    setError('');
  }
  async function submitImages() {
    if (!assignmentId) return setError('缺少作文任务，请从作文任务卡片进入拍照上传。');
    if (!files.length) return setError('请先选择照片或图片');
    const fd = new FormData();
    fd.append('assignment_id', assignmentId);
    if (title.trim()) fd.append('title', title.trim());
    files.forEach((file) => fd.append('images', file));
    setBusy(true);
    setError('');
    try {
      const data = await api('/essays/images', { method: 'POST', formData: fd });
      nav(`/student/essays/${data.essayId}/report`);
    } catch (err) {
      setError(`上传批改失败：${err.message}`);
    } finally {
      setBusy(false);
    }
  }
  return <Layout><Card title="作文拍照上传" icon={<Camera size={20} />}>
    <input placeholder="作文标题（可选）" value={title} onChange={(e) => setTitle(e.target.value)} />
    {needsConfirm && <p className="hint">OCR 识别后请在批改前确认文字。当前会先完成识别与批改；如识别不准，请返回文本提交页粘贴修正后的文字。</p>}
    <div className="image-upload-options">
      <label className="upload-choice"><Camera size={18} />拍照上传<input type="file" accept="image/*,.heic" multiple capture="environment" onChange={chooseFiles} /></label>
      <label className="upload-choice"><FileText size={18} />选择图片<input type="file" accept="image/*,.heic" multiple onChange={chooseFiles} /></label>
    </div>
    {files.length > 0 && <div className="upload-file-list">{files.map((file, index) => <p key={`${file.name}-${index}`}>{index + 1}. {file.name}</p>)}</div>}
    {error && <p className="error">{error}</p>}
    <button onClick={submitImages} disabled={busy || !files.length}><Send size={18} />{busy ? 'AI识别并批改中...' : '上传图片并批改'}</button>
  </Card></Layout>;
}

function SubmitPage() {
  const { assignmentId } = useParams();
  const session = getSession();
  const params = new URLSearchParams(location.search);
  const [assignment, setAssignment] = useState(null);
  const [text, setText] = useState(params.get('text') || '');
  const [title, setTitle] = useState('');
  const [studentInfo, setStudentInfo] = useState({ className: '', name: session?.name || '', studentNo: '' });
  const [submissionStatus, setSubmissionStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nav = useNavigate();
  useEffect(() => {
    api(`/assignments/public/${assignmentId}`).then((row) => {
      setAssignment(row);
      setStudentInfo((info) => ({ ...info, className: row.class_name || '' }));
      setTitle((current) => current || row.title || '');
    }).catch((err) => setError(err.message));
    api(`/essays/drafts/${assignmentId}`).then((draft) => {
      if (draft?.content) setText(draft.content);
      if (draft?.title) setTitle(draft.title);
    }).catch(() => {});
    if (session?.role === 'student') {
      api(`/assignments/${assignmentId}/my-status`).then(setSubmissionStatus).catch(() => {});
    }
  }, [assignmentId]);
  const wordCount = text.replace(/\s+/g, '').length;
  const tooShort = assignment?.min_words && wordCount < Number(assignment.min_words);
  const tooLong = assignment?.max_words && wordCount > Number(assignment.max_words);
  async function submit() {
    if (!text.trim()) {
      setError('请先粘贴或输入作文正文');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await api('/essays', { method: 'POST', body: { assignment_id: assignmentId, student_id: session.studentId, title, original_text: text.trim() } });
      nav(`/student/essays/${data.essayId}/report`);
    } catch (err) {
      setError(`提交失败：${err.message}`);
    } finally {
      setBusy(false);
    }
  }
  return <Layout><Card title="作文提交" icon={<PenLine size={20} />}>
    {assignment && <div className="assignment-submit-summary">
      <h3>{assignment.title}</h3>
      <p>{assignment.class_name || '未指定班级'} · {assignment.grade || '未指定年级'} · 截止 {formatDateTime(assignment.deadline)}</p>
      <p>{assignment.prompt}</p>
      {assignment.requirements && <p><b>写作要求：</b>{assignment.requirements}</p>}
      <p>字数要求：{assignment.min_words || '不限'} - {assignment.max_words || '不限'} 字 · 当前约 {wordCount} 字</p>
      <p>提交设置：{assignment.allow_resubmit ? '允许重新提交/二稿提交' : '正式提交后不可重复提交'} · {assignment.allow_late_submit ? '允许迟交并标记' : '截止后禁止提交'}</p>
    </div>}
    {submissionStatus && <div className="status-strip">
      <b>当前提交状态：{submissionStatus.state}</b>
      <span>{submissionStatus.state === '待教师审核' ? 'AI 已批改，等待教师发布报告。' : submissionStatus.state === '已发布报告' ? '报告已发布，可从学生端结果入口查看。' : '请按要求完成作文并正式提交。'}</span>
    </div>}
    <div className="row">
      <input placeholder="班级" value={studentInfo.className} onChange={(e) => setStudentInfo({ ...studentInfo, className: e.target.value })} />
      <input placeholder="姓名" value={studentInfo.name} onChange={(e) => setStudentInfo({ ...studentInfo, name: e.target.value })} />
      <input placeholder="学号" value={studentInfo.studentNo} onChange={(e) => setStudentInfo({ ...studentInfo, studentNo: e.target.value })} />
    </div>
    <input placeholder="作文标题" value={title} onChange={(e) => setTitle(e.target.value)} />
    <textarea placeholder="请输入或粘贴/黏贴作文正文" value={text} onChange={(e) => setText(e.target.value)} rows="18" />
    <p className="hint">手机端请优先使用“拍照上传”或“OCR 后人工确认”。本页保留文字直接提交入口，文件上传入口已移除以避免误操作。</p>
    {tooShort && <p className="error">当前字数低于最低要求。</p>}
    {tooLong && <p className="error">当前字数超过最高限制。</p>}
    {error && <p className="error">{error}</p>}
    <div className="actions">
      <a className="ghost" href={`/upload?assignmentId=${assignmentId}`}>拍照上传</a>
      <a className="ghost" href={`/upload?assignmentId=${assignmentId}&confirm=ocr`}>OCR 后人工确认</a>
      <button onClick={submit} disabled={busy || !text.trim() || tooShort || tooLong}><Send size={18} />{busy ? '提交批改中...' : '正式提交并批改'}</button>
    </div>
  </Card></Layout>;
}

function ReviewPage() {
  const { essayId } = useParams();
  const nav = useNavigate();
  const session = getSession();
  const [data, setData] = useState(null);
  const [activeDraft, setActiveDraft] = useState('polish');
  const [menuOpen, setMenuOpen] = useState(false);
  async function reReview() {
    if (!confirm("确定要重新调用 AI 批阅本篇作文吗？现有批改结果将被覆盖。")) return;
    try {
      await api(`/essays/${essayId}/review`, { method: 'POST' });
      const updated = await api(`/essays/${essayId}`);
      setData(updated);
      alert("AI 批阅完成！");
    } catch (err) {
      alert("重新批阅失败：" + err.message);
    }
  }
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const load = async () => {
      try {
        const updated = await api(`/essays/${essayId}`);
        if (cancelled) return updated;
        setData(updated);
        const status = String(updated?.essay?.grading_status || '');
        if (updated?.review || !['grading', 'pending'].includes(status)) {
          if (timer) clearInterval(timer);
          timer = null;
        }
        return updated;
      } catch (err) {
        if (!cancelled) console.error('review page refresh failed', err);
        return null;
      }
    };
    load().then((updated) => {
      const status = String(updated?.essay?.grading_status || '');
      if (!cancelled && !updated?.review && ['grading', 'pending'].includes(status)) {
        timer = setInterval(load, 2000);
      }
    });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [essayId]);
  const gradingStatus = String(data?.essay?.grading_status || '');
  if (!data || (!data.review && ['grading', 'pending'].includes(gradingStatus))) {
    return <div className="review-page"><p className="review-loading">图片已收到，AI 正在批改中，请稍候...</p></div>;
  }
  if (!data.review && gradingStatus === 'failed') {
    return <div className="review-page"><p className="review-loading">图片批改失败，请返回后重试或改用文字提交。</p></div>;
  }
  const review = data.review?.raw || {};
  const fallback = {
    teacher_overall: '这篇作文能围绕题目建立基本中心，但文本中的主体段还需要把观点、材料和分析连接得更紧密。开头应先界定核心概念，主体段在举例之后要解释材料为什么能够证明观点，结尾则要回到时代责任或个人选择，让文章从态度表达推进到有层次的论证。',
    title_revision: data.essay.title || '在时代坐标中确立青春方向',
    opening_revision: review.upgraded_paragraph,
    ending_revision: '愿我们把清醒的判断化为持久的行动。',
    paragraph_rewrites: [],
    polished_full_text: data.essay.original_text
  };
  const report = { ...fallback, ...review };
  const score = review.total_score || data.review?.total_score || '-';
  const level = review.level || data.review?.level || '待评';
  const thinkingReport = defaultThinkingCoachReport(review);
  const questions = (review.problems || []).slice(0, 3).map((item, index) => `${index + 1}. 针对“${item}”，你准备怎样调整论证或表达？`);
  const corrections = review.editable_sentences || [];
  const suggestionItems = review.suggestions || review.next_training || [
    '继续深化中心论点，让每一段都服务于核心观点。',
    '在段落转换处补充引导句，使论证链条更连贯。',
    '将抽象判断落到具体材料和细节，增强说服力。'
  ];
  const paragraphRewrites = Array.isArray(report.paragraph_rewrites) && report.paragraph_rewrites.length
    ? report.paragraph_rewrites
    : [{ paragraph: 2, problem: '主体段材料之后缺少原因分析和观点回扣。', revision: report.upgraded_paragraph || '可在主体段材料后补写：这个选择之所以有力量，不只因为它表现出个人努力，更因为它把个体成长放入时代需要之中，使奋斗从一句口号变成可以承担责任的行动。' }];
  return <div className="review-page">
    <header className="review-header"><button className="review-icon" onClick={() => nav(-1)} title="返回"><ArrowLeft /></button><h1>作文批改结果</h1><div className="review-menu-wrap"><button className="review-icon" onClick={() => setMenuOpen((open) => !open)} title="更多操作"><MoreHorizontal /></button>{menuOpen && <div className="review-menu"><button onClick={() => { setMenuOpen(false); reReview(); }}><RotateCcw size={16} />重新 AI 批阅</button><button onClick={() => { setMenuOpen(false); document.querySelector('#original-text')?.scrollIntoView({ behavior: 'smooth' }); }}><Sparkles size={16} />查看润色对比</button></div>}</div></header>
    <main className="review-content">
      <section className="review-card">
        <SectionTitle title="教师总评" />
        <div className="score-panel"><strong>{score}<small>分</small></strong><span>{level}</span></div>
        <div className="style-row"><span>积极肯定风</span><b>严格严厉风</b><span>循循善诱风</span></div>
        <div className="overall-copy"><p>{report.teacher_overall}</p><CopyTextButton text={report.teacher_overall} /></div>
        {(data.comments || []).map((comment) => <p className="teacher-note" key={comment.id}>教师补充：{comment.comment}</p>)}
        {session?.role === 'teacher' && <TeacherCommentEditor essayId={essayId} onSaved={(comment) => setData({ ...data, comments: [comment, ...(data.comments || [])] })} />}
      </section>

      <section className="review-card">
        <SectionTitle title="作文详细点评" />
        <h3 className="display-title">斟酌改写</h3>
        <RewriteItem number="01" label="改写标题（参考）" content={report.title_revision} />
        <RewriteItem number="02" label="改写开头" content={report.opening_revision || '建议以具体情境切入，迅速建立核心概念之间的关系。'} />
        <RewriteItem number="03" label="改写结尾" content={report.ending_revision} />
        <h3 className="display-title">逻辑薄弱段落改写示范</h3>
        {paragraphRewrites.map((item, index) => <RewriteItem key={`${item.paragraph || index}-${index}`} number={String(index + 4).padStart(2, '0')} label={`第${item.paragraph || index + 1}段：${item.problem || '逻辑衔接需要加强'}`} content={item.revision || item.rewrite || item.example} />)}
      </section>

      <section className="review-card advice-card">
        <SectionTitle title="建议" actions={session?.role === 'teacher' ? <button className="mini-action">编辑</button> : null} />
        <AdviceGuidanceList items={suggestionItems} />
      </section>

      <ThinkingCoachPanel report={thinkingReport} />

      <ReviewSection title="文章亮点" items={review.strengths || ['立意较为明确，能够联系现实展开思考。']} />
      <ReviewSection title="深化提问" items={questions.length ? questions : ['1. 文章的核心概念能否进一步界定？', '2. 材料与中心论点之间还缺少哪一步推理？']} />

      <section className="review-card">
        <SectionTitle title="巩固练习" />
        <div className="exercise-content"><p><b>题目</b> 围绕本篇作文的核心话题，补写一个具有真实情境、完整因果链的论证段。</p><p><b>提示</b> 先明确观点，再选择材料，最后解释材料为什么能够证明观点。</p><p><b>示例</b> {review.upgraded_paragraph || report.opening_revision}</p></div>
      </section>

      <section className="review-card draft-card" id="original-text">
        <div className="draft-tabs"><button className={activeDraft === 'polish' ? 'active' : ''} onClick={() => setActiveDraft('polish')}>原文润色提升对比</button><button className={activeDraft === 'correct' ? 'active' : ''} onClick={() => setActiveDraft('correct')}>原文基础纠正对比</button></div>
        {activeDraft === 'polish' && <PolishedComparison original={data.essay.original_text} polished={report.polished_full_text} embedded />}
        {activeDraft === 'correct' && <CorrectionComparison original={data.essay.original_text} changes={corrections} />}
      </section>
      {session?.role === 'student' && <FullEssayUpgradePanel essayId={essayId} originalText={data.essay.original_text} originalScore={Number(score) || 42} />}
    </main>
    <AiTutorChat essayId={essayId} />
    <ReviewBottomBar essayId={essayId} onReReview={reReview} />
  <button className="back-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} title="回到顶部"><ChevronUp /><span>顶部</span></button>
  </div>;
}

function StudentEssayReportPage() {
  return <ReviewPage />;
}

function StudentMobileLoginPage() {
  return <Navigate to="/login" replace state={{ returnTo: '/student-mobile/home', role: 'student' }} />;
}

function StudentMobileJoinPage() {
  const [token] = useState(() => new URLSearchParams(location.search).get('token') || '');
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ studentName: '', studentNo: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const nav = useNavigate();
  useEffect(() => {
    if (!token) return;
    api(`/student-mobile/join/${encodeURIComponent(token)}`).then(setData).catch((err) => setError(err.message));
  }, [token]);
  async function submit() {
    if (!token) return setError('缺少入班令牌');
    if (!form.studentName.trim()) return setError('请填写学生姓名');
    try {
      const result = await api(`/student-mobile/join/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: { studentName: form.studentName.trim(), studentNo: form.studentNo.trim() }
      });
      nav(`/student-mobile/join/status?status=${encodeURIComponent(result.status || 'pending')}&classId=${encodeURIComponent(result.class_id || '')}&requestId=${encodeURIComponent(result.id || '')}`, { replace: true });
    } catch (err) {
      setError(err.message);
    }
  }
  return <Layout><Card title="加入班级" icon={<Users size={20} />}>
    {data ? <div className="form-stack">
      <p><b>{data.name}</b> · {data.grade || '未填写年级'} · {data.teacher_name || '任课教师未填'}</p>
      <p className="hint">入班方式：{data.join_mode || 'approval'} · 当前状态：{data.status || 'active'}</p>
      <input placeholder="学生姓名" value={form.studentName} onChange={(e) => setForm({ ...form, studentName: e.target.value })} />
      <input placeholder="学号（可选）" value={form.studentNo} onChange={(e) => setForm({ ...form, studentNo: e.target.value })} />
      <button onClick={submit}>提交入班申请</button>
      <a className="hint" href="/student-mobile/join/code">手工输入邀请码加入</a>
    </div> : <p className="hint">请通过教师发来的二维码或链接进入。</p>}
    {message && <p className="success">{message}</p>}
    {error && <p className="error">{error}</p>}
  </Card></Layout>;
}

function StudentMobileJoinCodePage() {
  const [form, setForm] = useState({ code: '', studentName: '', studentNo: '' });
  const [preview, setPreview] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const nav = useNavigate();

  useEffect(() => {
    const code = String(form.code || '').trim();
    if (!code) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(() => {
      setError('');
      api(`/student-mobile/join/code/${encodeURIComponent(code)}`).then(setPreview).catch((err) => {
        setPreview(null);
        setError(err.message);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [form.code]);

  async function submit() {
    const code = String(form.code || '').trim();
    if (!code) return setError('请填写邀请码');
    if (!form.studentName.trim()) return setError('请填写学生姓名');
    setError('');
    try {
      const result = await api('/student-mobile/join/code', {
        method: 'POST',
        body: { code, studentName: form.studentName.trim(), studentNo: form.studentNo.trim() }
      });
      nav(`/student-mobile/join/status?requestId=${encodeURIComponent(result.id || result.request_id || '')}&classId=${encodeURIComponent(result.class_id || '')}&status=${encodeURIComponent(result.status || 'pending')}`, { replace: true });
    } catch (err) {
      setStatusMessage('');
      setError(err.message);
    }
  }

  return <Layout><Card title="手工输入邀请码" icon={<Users size={20} />}>
    <div className="form-stack">
      <input placeholder="短邀请码，例如 JOIN-XXXXXX" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
      {preview && <div className="assignment-submit-summary">
        <h3>{preview.name}</h3>
        <p>{preview.grade || '未填写年级'} · {preview.teacher_name || '任课教师未填'}</p>
        <p>入班方式：{preview.join_mode || 'approval'} · 当前状态：{preview.status || 'active'} · 人数上限：{preview.max_students || '不限'}</p>
        <p>邀请码：{preview.invite_code || '未配置'} · 有效期：{formatDateTime(preview.invite_expires_at)}</p>
      </div>}
      <input placeholder="学生姓名" value={form.studentName} onChange={(e) => setForm({ ...form, studentName: e.target.value })} />
      <input placeholder="学号或识别信息（可选）" value={form.studentNo} onChange={(e) => setForm({ ...form, studentNo: e.target.value })} />
      {statusMessage && <p className="success">{statusMessage}</p>}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <a href="/student-mobile/join">返回二维码加入</a>
        <button type="button" onClick={submit}>提交入班申请</button>
      </div>
    </div>
  </Card></Layout>;
}

function StudentMobileJoinStatusPage() {
  const params = new URLSearchParams(location.search);
  const status = params.get('status') || 'pending';
  const classId = params.get('classId') || '';
  const requestId = params.get('requestId') || '';
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!requestId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const next = await api(`/student-mobile/join/requests/${encodeURIComponent(requestId)}`);
        if (!cancelled) setDetail(next);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    };
    load();
    const timer = setInterval(load, 2500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [requestId]);
  const resolvedStatus = detail?.status || status;
  return <Layout><Card title="入班结果" icon={<Check size={20} />}>
    <div className="form-stack">
      <p><b>{resolvedStatus === 'approved' ? '已加入班级' : resolvedStatus === 'rejected' ? '入班申请已被拒绝' : '入班申请已提交'}</b></p>
      <p className="hint">班级编号：{detail?.class_id || classId || '未返回'} · 申请编号：{requestId || '未返回'}</p>
      {detail && <div className="assignment-submit-summary">
        <h3>{detail.class_name || '班级'}</h3>
        <p>{detail.class_grade || '未填写年级'} · {detail.invite_code || '邀请码未返回'}</p>
        <p>申请状态：{detail.status || resolvedStatus} · 入班方式：{detail.invite_join_mode || 'approval'} · 班级状态：{detail.class_status || 'active'}</p>
        {detail.review_reason && <p>审核说明：{detail.review_reason}</p>}
      </div>}
      {error && <p className="error">{error}</p>}
      <p className="hint">如需继续，请返回任务首页或等待教师审核。</p>
      <div className="actions">
        <a href="/student-mobile/home">返回首页</a>
        <a href="/student-mobile/tasks">查看任务</a>
        {resolvedStatus === 'rejected' && <a href="/student-mobile/join/code">修改信息并重新申请</a>}
      </div>
    </div>
  </Card></Layout>;
}

function StudentMobileHomePage() {
  const [classes, setClasses] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    api('/student-mobile/classes').then(setClasses).catch(() => {});
    api('/student-mobile/tasks').then(setTasks).catch(() => {});
    api('/student-mobile/profile').then(setProfile).catch(() => {});
  }, []);
  const quickLinks = [
    { href: '/student-mobile/tasks', label: '我的任务' },
    { href: '/student-mobile/tasks', label: '提交作文' },
    { href: '/student-mobile/tasks', label: '批改进度' },
    { href: '/student-mobile/profile', label: '我的报告' },
    { href: '/student-mobile/profile', label: '升格与修改' },
    { href: '/student-mobile/profile', label: '成长档案' },
    { href: '/student-mobile/join', label: '加入班级' },
    { href: '/student', label: '自由作文 AI 批改', primary: true }
  ];
  return <Layout><div className="grid">
    <Card title="手机学生端" icon={<Home size={20} />}>
      <p>{profile?.name || '学生'} · {classes.length} 个班级 · {tasks.length} 个任务</p>
      <div className="mobile-quick-links">
        {quickLinks.map((link) => <a key={link.label} className={link.primary ? 'button-link primary' : 'button-link'} href={link.href}>{link.label}</a>)}
      </div>
    </Card>
    <Card title="我的班级" icon={<School size={20} />}>
      {classes.map((klass) => <article key={klass.id} className="item"><b>{klass.name}</b><p>{klass.grade || '未填写年级'} · {klass.join_mode || 'approval'} · {klass.status || 'active'}</p><p className="hint">邀请码状态：{klass.invite_code ? '已配置' : '未配置'}</p></article>)}
      {!classes.length && <p className="hint">还没有班级，请先通过邀请码加入。</p>}
    </Card>
    <Card title="我的任务" icon={<BookOpen size={20} />}>
      {tasks.map((task) => <article key={task.id} className="item"><b>{task.title}</b><p>{task.class_name || ''} · {task.essay_type || ''} · 满分 {task.full_score || 60}</p><p><a href={`/student-mobile/tasks/${encodeURIComponent(task.id)}`}>查看详情</a></p></article>)}
      {!tasks.length && <p className="hint">当前还没有任务。</p>}
    </Card>
  </div></Layout>;
}

function AdminIntegrationsPage() {
  const [feishu, setFeishu] = useState(null);
  const [publicAccess, setPublicAccess] = useState(null);
  useEffect(() => {
    api('/feishu/health').then(setFeishu).catch(() => {});
    api('/public-access').then(setPublicAccess).catch(() => {});
  }, []);
  return <Layout><div className="grid">
    <Card title="系统入口" icon={<Share2 size={20} />}>
      <p>网页教师入口：{publicAccess?.publicOrigin || 'https://pi.zhenwanyue.icu'}/teacher</p>
      <p>手机学生入口：{publicAccess?.publicOrigin || 'https://pi.zhenwanyue.icu'}/student-mobile</p>
      <p>微信生态入口已启用，飞书业务已暂停。</p>
    </Card>
    <Card title="飞书状态" icon={<MessageCircle size={20} />}>
      <p>业务开关：{String(feishu?.feishuBusinessEnabled ?? false)}</p>
      <p>学生提交：{String(feishu?.feishuStudentSubmissionEnabled ?? false)}</p>
      <p>教师审核：{String(feishu?.feishuTeacherReviewEnabled ?? false)}</p>
      <p>重新批改：{String(feishu?.feishuRegradingEnabled ?? false)}</p>
      <p>系统通知：{String(feishu?.feishuSystemNotificationEnabled ?? true)}</p>
      <p>文件上传：{String(feishu?.feishuFileUploadEnabled ?? false)}</p>
    </Card>
    <Card title="兼容说明" icon={<FileText size={20} />}>
      <p>历史飞书消息、旧归档链接和数据库记录保留，仅暂停新的飞书业务流。</p>
      <p className="actions"><a className="button-link" href="/teacher">返回教师工作台</a></p>
    </Card>
  </div></Layout>;
}

function StudentMobileTasksPage() {
  const { assignmentId } = useParams();
  const [tasks, setTasks] = useState([]);
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState(null);
  useEffect(() => {
    if (!assignmentId) {
      api('/student-mobile/tasks').then(setTasks).catch(() => {});
      return;
    }
    Promise.all([
      api(`/assignments/public/${encodeURIComponent(assignmentId)}`),
      api(`/assignments/${encodeURIComponent(assignmentId)}/my-status`)
    ]).then(([assignment, myStatus]) => {
      setDetail(assignment);
      setStatus(myStatus);
    }).catch(() => {});
  }, [assignmentId]);
  if (assignmentId) {
    return <Layout><Card title="任务详情" icon={<BookOpen size={20} />}>
      {detail ? <div className="form-stack">
        <p><b>{detail.title}</b></p>
        <p className="hint">{detail.class_name || ''} · {detail.essay_type || ''} · {detail.grade || ''}</p>
        <p className="hint">截止时间：{formatDateTime(detail.deadline)}</p>
        <p>{detail.prompt || '暂无材料说明'}</p>
        <p>{detail.requirements || '暂无写作要求'}</p>
        <p className="hint">状态：{status?.state || '未查询'}</p>
        <div className="actions">
          <a href={`/submit/${encodeURIComponent(assignmentId)}`}>提交作文</a>
          <a href={`/upload?assignmentId=${encodeURIComponent(assignmentId)}`}>拍照上传</a>
          <a href="/student-mobile/tasks">返回任务列表</a>
        </div>
      </div> : <p className="hint">任务不存在或暂不可见。</p>}
    </Card></Layout>;
  }
  return <Layout><Card title="我的任务" icon={<BookOpen size={20} />}>
    {tasks.map((task) => <article key={task.id} className="item"><b>{task.title}</b><p>{task.class_name || ''} · {task.essay_type || ''} · 截止 {formatDateTime(task.deadline)}</p><p className="hint">{task.prompt || task.requirements || '暂无说明'}</p><p><a href={`/student-mobile/tasks/${encodeURIComponent(task.id)}`}>查看详情</a></p></article>)}
    {!tasks.length && <p className="hint">当前没有可见任务。</p>}
  </Card></Layout>;
}

function StudentMobileProfilePage() {
  const [profile, setProfile] = useState(null);
  useEffect(() => { api('/student-mobile/profile').then(setProfile).catch(() => {}); }, []);
  return <Layout><Card title="成长档案" icon={<ChartNoAxesCombined size={20} />}>
    {profile ? <div className="form-stack">
      <p><b>{profile.name}</b> · {profile.student_no || '未填写学号'}</p>
      <p className="hint">{profile.growth_report || '暂无成长记录'}</p>
      <pre style={{whiteSpace:'pre-wrap'}}>{profile.score_trend || '[]'}</pre>
    </div> : <p className="hint">请先登录后查看。</p>}
  </Card></Layout>;
}

function TeacherLifecycleClassPage() {
  const { classKey } = useParams();
  const location = useLocation();
  const nav = useNavigate();
  const isNumeric = /^\d+$/.test(String(classKey || ''));
  const initialTab = location.pathname.endsWith('/join-requests')
    ? 'requests'
    : location.pathname.endsWith('/members')
      ? 'members'
      : 'overview';
  const [tab, setTab] = useState(initialTab);
  const [detail, setDetail] = useState(null);
  const [requests, setRequests] = useState([]);
  const [members, setMembers] = useState([]);
  const [allClasses, setAllClasses] = useState([]);
  const [transferTargets, setTransferTargets] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  async function load() {
    const [inviteData, memberRows, classRows] = await Promise.all([
      api(`/classes/${encodeURIComponent(classKey)}/invite`),
      api(`/classes/${encodeURIComponent(classKey)}/members`),
      api('/classes')
    ]);
    setDetail(inviteData);
    setRequests(inviteData.requests || []);
    setMembers(memberRows || []);
    setAllClasses(classRows || []);
    setMessage('');
  }

  useEffect(() => {
    if (!isNumeric) return;
    load().catch((err) => setMessage(err.message));
  }, [classKey]);

  if (!isNumeric) {
    return <TeacherClassDetailPage />;
  }

  if (!detail) {
    return <Layout><Card title="班级工作台" icon={<Users size={20} />}>{message ? <p className="error">{message}</p> : <p className="hint">正在加载班级工作台...</p>}</Card></Layout>;
  }

  const klass = detail.class || {};
  const currentInvite = detail.invite || null;
  const otherClasses = allClasses.filter((item) => String(item.id) !== String(classKey));

  async function rotateInvite() {
    setBusy('rotate');
    try {
      await api(`/classes/${encodeURIComponent(classKey)}/invite/rotate`, { method: 'POST', body: { joinMode: klass.join_mode || 'approval' } });
      await load();
      setMessage('已重新生成班级邀请码。');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy('');
    }
  }

  async function approveRequest(requestId) {
    setBusy(`approve-${requestId}`);
    try {
      await api(`/classes/${encodeURIComponent(classKey)}/join-requests/${encodeURIComponent(requestId)}/approve`, { method: 'POST', body: {} });
      await load();
      setMessage('已批准入班申请。');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy('');
    }
  }

  async function rejectRequest(requestId) {
    const reason = window.prompt('拒绝原因（可选）', '');
    if (reason === null) return;
    setBusy(`reject-${requestId}`);
    try {
      await api(`/classes/${encodeURIComponent(classKey)}/join-requests/${encodeURIComponent(requestId)}/reject`, { method: 'POST', body: { reason } });
      await load();
      setMessage('已拒绝入班申请。');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy('');
    }
  }

  async function changeMemberStatus(studentId, action, payload = {}) {
    setBusy(`${action}-${studentId}`);
    try {
      const targetMap = {
        remove: { method: 'DELETE', path: `/classes/${encodeURIComponent(classKey)}/students/${encodeURIComponent(studentId)}` },
        pause: { method: 'POST', path: `/classes/${encodeURIComponent(classKey)}/students/${encodeURIComponent(studentId)}/pause` },
        restore: { method: 'POST', path: `/classes/${encodeURIComponent(classKey)}/students/${encodeURIComponent(studentId)}/restore` },
        transfer: { method: 'POST', path: `/classes/${encodeURIComponent(classKey)}/students/${encodeURIComponent(studentId)}/transfer` }
      };
      const target = targetMap[action];
      if (!target) return;
      await api(target.path, { method: target.method, body: payload });
      await load();
      setMessage(action === 'transfer' ? '已完成转班。' : '已更新成员状态。');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy('');
    }
  }

  const requestsSection = (
    <div className="management-table">
      {requests.map((request) => <article className="management-row" key={request.id}>
        <b>{request.student_name}<span>{request.student_no || '未填学号'}</span></b>
        <span>{request.source || 'student-mobile'}</span>
        <span>{request.status}</span>
        <span>{formatDateTime(request.requested_at)}</span>
        <span>{request.invite_code || '邀请码未显示'}</span>
        <span>{request.membership_status || '未加入'}</span>
        <span className="record-actions">
          <button type="button" className="primary-button" disabled={busy === `approve-${request.id}`} onClick={() => approveRequest(request.id)}>{busy === `approve-${request.id}` ? '处理中' : '批准'}</button>
          <button type="button" className="danger-button" disabled={busy === `reject-${request.id}`} onClick={() => rejectRequest(request.id)}>{busy === `reject-${request.id}` ? '处理中' : '拒绝'}</button>
        </span>
      </article>)}
      {!requests.length && <p className="hint">当前没有待处理的入班申请。</p>}
    </div>
  );

  const membersSection = (
    <div className="management-table">
      {members.map((member) => {
        const targetClassId = transferTargets[member.id] || otherClasses[0]?.id || '';
        return <article className="management-row" key={member.id}>
          <b>{member.name}<span>{member.student_no || '未填学号'}</span></b>
          <span>{member.username || '--'}</span>
          <span>{member.binding_status || 'active'}</span>
          <span>{formatDateTime(member.joined_at)}</span>
          <span>{member.left_at ? `离开：${formatDateTime(member.left_at)}` : '当前有效'}</span>
          <span className="record-actions">
            <button type="button" onClick={() => changeMemberStatus(member.id, 'pause', { reason: '教师停用成员' })} disabled={busy === `pause-${member.id}` || member.binding_status !== 'active'}>停用</button>
            <button type="button" onClick={() => changeMemberStatus(member.id, 'restore', { reason: '教师恢复成员' })} disabled={busy === `restore-${member.id}` || member.binding_status === 'active'}>恢复</button>
            <button type="button" className="danger-button" onClick={() => changeMemberStatus(member.id, 'remove', { reason: '教师移出班级' })} disabled={busy === `remove-${member.id}`}>移出</button>
          </span>
          <div className="assignment-share-panel">
            <div className="row">
              <select value={String(targetClassId || '')} onChange={(e) => setTransferTargets((current) => ({ ...current, [member.id]: e.target.value }))}>
                <option value="">选择目标班级</option>
                {otherClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <button type="button" onClick={() => changeMemberStatus(member.id, 'transfer', { targetClassId: Number(targetClassId), keepSourceMembership: false, reason: '教师转班' })} disabled={!targetClassId || busy === `transfer-${member.id}`}>转班</button>
            </div>
          </div>
        </article>;
      })}
      {!members.length && <p className="hint">当前班级还没有成员，或成员已全部停用。</p>}
    </div>
  );

  return <Layout>
    <section className="role-banner teacher-banner">
      <div className="role-banner-mark"><School size={28} /></div>
      <div>
        <p>教师班级工作台</p>
        <h2>{klass.name || '班级工作台'}</h2>
      </div>
    </section>
    <div className="teacher-subnav">
      <a href="/teacher">首页</a>
      <a href="/teacher/classes">班级</a>
      <a href={`/teacher/classes/${encodeURIComponent(classKey)}`}>总览</a>
      <a href={`/teacher/classes/${encodeURIComponent(classKey)}/join-requests`}>入班申请</a>
      <a href={`/teacher/classes/${encodeURIComponent(classKey)}/members`}>成员管理</a>
    </div>
    <div className="grid">
      <Card title="班级总览" icon={<School size={20} />}>
        <div className="stats">
          <span><b>{klass.student_count ?? 0}</b>成员</span>
          <span><b>{klass.binding_count ?? 0}</b>绑定</span>
          <span><b>{klass.pending_join_requests ?? 0}</b>待审核</span>
          <span><b>{klass.active_invites ?? 0}</b>有效邀请码</span>
        </div>
        <p>{klass.name || '未命名班级'} · {klass.grade || '未填写年级'} · {klass.join_mode || 'approval'} · {klass.status || 'active'}</p>
        <p className="hint">邀请码：{currentInvite?.invite_code || klass.invite_code || '未配置'} · 有效期：{formatDateTime(currentInvite?.expires_at || klass.invite_code_expires_at)}</p>
        <div className="actions">
          <a className="button-link" href={detail.invite_url || '#'} target="_blank" rel="noreferrer">打开二维码链接</a>
          <button type="button" onClick={rotateInvite} disabled={busy === 'rotate'}>{busy === 'rotate' ? '生成中' : '重新生成邀请码'}</button>
        </div>
        {detail.qr_svg && <div className="qr-preview" dangerouslySetInnerHTML={{ __html: detail.qr_svg }} />}
        {message && <p className={message.includes('失败') ? 'error' : 'success'}>{message}</p>}
      </Card>
      <Card title="页面切换" icon={<Bookmark size={20} />}>
        <div className="actions">
          <button type="button" className={tab === 'overview' ? 'primary-button' : ''} onClick={() => setTab('overview')}>总览</button>
          <button type="button" className={tab === 'requests' ? 'primary-button' : ''} onClick={() => setTab('requests')}>入班申请</button>
          <button type="button" className={tab === 'members' ? 'primary-button' : ''} onClick={() => setTab('members')}>成员管理</button>
        </div>
        <p className="hint">同一班级的三类管理内容共用同一份成员数据，不再物理删除历史关系。</p>
      </Card>
      {(tab === 'overview' || tab === 'requests') && <Card title="入班申请" icon={<UserPlus size={20} />}>{requestsSection}</Card>}
      {(tab === 'overview' || tab === 'members') && <Card title="成员管理" icon={<Users size={20} />}>{membersSection}</Card>}
    </div>
  </Layout>;
}

function LegacyReviewRoute() {
  const { essayId } = useParams();
  const location = useLocation();
  const session = getSession();
  const suffix = location.search || '';
  const target = session?.role === 'teacher'
    ? `/teacher/essays/${encodeURIComponent(essayId)}${suffix}`
    : `/student/essays/${encodeURIComponent(essayId)}/report${suffix}`;
  return <Navigate to={target} replace />;
}

function splitLines(value) {
  return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function compactList(items = [], fallback = '暂无') {
  const list = Array.isArray(items) ? items : [items];
  const cleaned = list
    .map((item) => (typeof item === 'string' ? item : item?.focus || item?.title || item?.diagnosis || item?.task || item?.reason || item?.comment || ''))
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return cleaned.length ? cleaned : [fallback];
}

function RichTextEditor({ value, onChange, placeholder }) {
  const ref = React.useRef(null);
  function wrap(prefix, suffix = prefix) {
    const textarea = ref.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const payload = selected || placeholder || '';
    onChange(`${value.slice(0, start)}${prefix}${payload}${suffix}${value.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + prefix.length + payload.length + suffix.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }
  return <div className="rich-editor">
    <div className="rich-editor-toolbar">
      <button type="button" className="toolbar-button" onClick={() => wrap('**')}>B</button>
      <button type="button" className="toolbar-button" onClick={() => wrap('*')}>I</button>
      <button type="button" className="toolbar-button" onClick={() => wrap('> ', '')}>引用</button>
      <button type="button" className="toolbar-button" onClick={() => wrap('- ', '')}>列表</button>
      <button type="button" className="toolbar-button" onClick={() => onChange('')}>清空</button>
    </div>
    <textarea ref={ref} rows="8" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
  </div>;
}

function TeacherEssayDetailPage() {
  const { essayId, reportId: routeReportId } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [reviewForm, setReviewForm] = useState({ finalScore: '', comment: '', strengths: '', weaknesses: '', suggestions: '', status: 'draft' });
  const [rerunOpen, setRerunOpen] = useState(false);
  const [rerunForm, setRerunForm] = useState({ promptMode: 'latest', promptText: '', rerunReason: '' });
  const [savingReview, setSavingReview] = useState(false);
  const [rerunning, setRerunning] = useState(false);

  async function load() {
    const detail = await api(`/teacher/essays/${encodeURIComponent(essayId)}/detail`);
    setData(detail);
    const latestVersion = detail?.history?.at?.(-1)?.version_number || detail?.review?.version_number || 1;
    const requestedReportId = String(routeReportId || searchParams.get('reportId') || '').trim();
    const requestedAction = String(searchParams.get('action') || '').trim();
    const matchedVersion = detail?.history?.find((item) => {
      const itemId = String(item.id || '');
      const version = String(item.version_number || 1);
      const reportId = String(item.report_id || '');
      return requestedReportId && (requestedReportId === itemId || requestedReportId === version || requestedReportId === reportId);
    })?.version_number || latestVersion;
    setSelectedVersion(String(matchedVersion));
    setRerunOpen(requestedAction === 'regrade');
  }

  useEffect(() => {
    load().catch((err) => setMessage(err.message));
  }, [essayId, location.search]);

  const versionItems = data?.history || [];
  const selectedReview = useMemo(() => {
    const fallback = data?.review || null;
    if (!versionItems.length) return fallback;
    const picked = versionItems.find((item) => String(item.version_number || 1) === String(selectedVersion));
    return picked || fallback || versionItems.at(-1) || null;
  }, [data, versionItems, selectedVersion]);
  const selectedRaw = selectedReview?.raw_json || {};
  const essay = data?.essay || {};
  const links = data?.links || {};
  const comparison = data?.comparison || null;
  const teacherReview = selectedRaw.teacherReview || data?.teacherReview || selectedReview?.teacherReview || {};
  const selectedPrompt = selectedReview?.prompt_version || selectedRaw.metadata?.promptVersion || '--';
  const selectedModel = selectedReview?.model || selectedRaw.metadata?.model || '--';
  const selectedVersionTime = formatDateTime(selectedReview?.created_at || selectedReview?.createdAt);

  useEffect(() => {
    if (!selectedReview) return;
    setReviewForm({
      finalScore: teacherReview.finalScore ?? '',
      comment: teacherReview.comment || '',
      strengths: compactList(teacherReview.strengths || selectedRaw.summary?.mainStrengths || selectedRaw.strengths || selectedRaw.coreAdvantages || []).join('\n'),
      weaknesses: compactList(teacherReview.weaknesses || selectedRaw.summary?.mainProblems || selectedRaw.problems || selectedRaw.mainProblems || []).join('\n'),
      suggestions: compactList(teacherReview.suggestions || selectedRaw.summary?.priorityImprovements || selectedRaw.nextTraining || selectedRaw.suggestions || []).join('\n'),
      status: teacherReview.status || 'draft'
    });
    setRerunForm({ promptMode: 'latest', promptText: '', rerunReason: '' });
  }, [selectedReview?.id]);

  async function saveReview(status) {
    setMessage('');
    setSavingReview(true);
    try {
      const result = await api(`/teacher/essays/${encodeURIComponent(essayId)}/teacher-review`, {
        method: 'POST',
        body: {
          reviewId: selectedReview?.id,
          versionNumber: selectedReview?.version_number,
          status,
          finalScore: reviewForm.finalScore === '' ? null : Number(reviewForm.finalScore),
          comment: reviewForm.comment,
          strengths: splitLines(reviewForm.strengths),
          weaknesses: splitLines(reviewForm.weaknesses),
          suggestions: splitLines(reviewForm.suggestions)
        }
      });
      setMessage(status === 'submitted' ? '教师评分已提交并写回数据库。' : '草稿已保存。');
      setData(result.detail);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSavingReview(false);
    }
  }

  async function rerunEssay() {
    setMessage('');
    setRerunning(true);
    try {
      const result = await api(`/teacher/essays/${encodeURIComponent(essayId)}/rerun`, { method: 'POST', body: rerunForm });
      setMessage(`已重新批改，生成版本 V${result.review?.version_number || '?' }。`);
      setRerunOpen(false);
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setRerunning(false);
    }
  }

  const summaryStrengths = compactList(selectedRaw.summary?.mainStrengths || selectedRaw.strengths || selectedRaw.coreAdvantages || []).slice(0, 3);
  const summaryProblems = compactList(selectedRaw.summary?.mainProblems || selectedRaw.problems || selectedRaw.mainProblems || []).slice(0, 3);
  const summaryImprovements = compactList(selectedRaw.summary?.priorityImprovements || selectedRaw.nextTraining || selectedRaw.suggestions || []).slice(0, 3);

  if (!data) {
    return <Layout><Card title="教师工作台" icon={<FileText size={20} />}>{message ? <p className="error">{message}</p> : <p className="hint">正在加载作文详情...</p>}</Card></Layout>;
  }

  return <Layout>
    <section className="teacher-workspace">
      <aside className="teacher-workspace-rail">
        <Card title="作文版本" icon={<RotateCcw size={20} />}>
          <div className="version-switcher">
            {versionItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={String(selectedVersion) === String(item.version_number || 1) ? 'version-button active' : 'version-button'}
                onClick={() => setSelectedVersion(String(item.version_number || 1))}
              >
                <b>V{item.version_number || 1}</b>
                <span>{item.total_score ?? '--'}分</span>
                <small>{formatDateTime(item.created_at)}</small>
              </button>
            ))}
          </div>
          {versionItems.length > 1 && comparison && (
            <div className="version-compare">
              <p><b>分数变化</b>{comparison.scoreDelta >= 0 ? '+' : ''}{comparison.scoreDelta}</p>
              <p><b>Prompt</b>{comparison.promptFrom || '--'} → {comparison.promptTo || '--'}</p>
              <p><b>模型</b>{comparison.modelFrom || '--'} → {comparison.modelTo || '--'}</p>
            </div>
          )}
        </Card>

        <Card title="历史记录" icon={<FileSpreadsheet size={20} />}>
          {versionItems.length > 1 && comparison && <div className="version-compare compact">
            <p><b>评分变化</b>{comparison.scoreDelta >= 0 ? '+' : ''}{comparison.scoreDelta}</p>
            <p><b>Prompt</b>{comparison.promptFrom || '--'} → {comparison.promptTo || '--'}</p>
            <p><b>模型</b>{comparison.modelFrom || '--'} → {comparison.modelTo || '--'}</p>
          </div>}
          <div className="management-table">
            {versionItems.map((item) => <article className={String(selectedVersion) === String(item.version_number || 1) ? 'management-row active' : 'management-row'} key={item.id}>
              <b>V{item.version_number || 1}<span>{formatDateTime(item.created_at)}</span></b>
              <span>{item.total_score}分</span>
              <span>{item.level || '--'}</span>
              <span>{item.model || '--'}</span>
              <code>{item.prompt_version || '--'}</code>
            </article>)}
          </div>
        </Card>
      </aside>

      <main className="teacher-workspace-main">
        <Card title="作文详情" icon={<FileText size={20} />}>
          <div className="workspace-summary">
            <div>
              <strong>{essay.student_name || '未填写'}</strong>
              <span>{essay.class_name || '未填写班级'} · {essay.class_grade || '未填写年级'}</span>
            </div>
            <div>
              <strong>{essay.assignment_title || '未命名作文'}</strong>
              <span>{essay.word_count || 0} 字 · 当前版本 V{selectedReview?.version_number || 1}</span>
            </div>
            <div>
              <strong>{selectedReview?.total_score ?? selectedReview?.totalScore ?? '--'} / {selectedReview?.full_score ?? selectedReview?.fullScore ?? 60}</strong>
              <span>{selectedReview?.level || selectedReview?.grade || '待评'} · {selectedModel}</span>
            </div>
          </div>
          {message && <p className={message.includes('已重新批改') || message.includes('已保存') || message.includes('已提交') ? 'success' : 'hint'}>{message}</p>}
          <div className="workspace-actions">
            <button type="button" className="secondary-button" onClick={() => nav(location.state?.returnTo || '/teacher/reviews')}><ArrowLeft size={16} />返回列表</button>
            <button type="button" className="secondary-button" onClick={() => setRerunOpen((value) => !value)}>重新批改</button>
          </div>
        </Card>

        <Card title="作文全文" icon={<BookOpen size={20} />}>
          <div className="essay-meta-row">
            <span>报告版本 {selectedReview?.report_version || selectedReview?.reportVersion || '2.0'}</span>
            <span>Prompt {selectedPrompt}</span>
            <span>{selectedVersionTime}</span>
          </div>
          <div className="essay-text-block">
            <h3>{essay.title || essay.assignment_title || '作文全文'}</h3>
            <p>{essay.original_text || '暂无作文正文。'}</p>
          </div>
          {essay.revised_text && essay.revised_text !== essay.original_text && (
            <div className="essay-text-block secondary">
              <h3>修订文本</h3>
              <p>{essay.revised_text}</p>
            </div>
          )}
        </Card>

        <div className="workspace-grid">
          <Card title="AI 批改结果" icon={<Star size={20} />}>
            <div className="score-panel">
              <strong>{selectedReview?.total_score ?? selectedReview?.totalScore ?? '--'}<small>分</small></strong>
              <span>{selectedReview?.level || selectedReview?.grade || '待评'}</span>
            </div>
            <p className="workspace-lead">{selectedRaw.summary?.overallComment || selectedReview?.overallEvaluation || selectedReview?.teacherComment || '暂无总评。'}</p>
            <div className="workspace-list-grid">
              <article><b>主要优点</b><p>{summaryStrengths.join('；') || '暂无'}</p></article>
              <article><b>核心问题</b><p>{summaryProblems.join('；') || '暂无'}</p></article>
              <article><b>优先修改</b><p>{summaryImprovements.join('；') || '暂无'}</p></article>
              <article><b>逻辑分析</b><p>{selectedRaw.logicAnalysis?.centralClaim || selectedRaw.logicAnalysisText || '暂无'}</p></article>
            </div>
          </Card>

          <Card title="分项评分" icon={<ChartNoAxesCombined size={20} />}>
            <div className="dimension-grid">
              {Object.entries(selectedRaw.dimensions || {}).map(([key, value]) => <article key={key}><b>{key}</b><p>{typeof value === 'string' ? value : JSON.stringify(value)}</p></article>)}
            </div>
          </Card>

          <Card title="逐段点评" icon={<PenLine size={20} />}>
            <div className="workspace-list-grid">
              <article><b>段落点评</b><p>{compactList(selectedRaw.paragraphAnalysis || selectedRaw.paragraph_comments || [], '暂无').join('；')}</p></article>
              <article><b>关键句</b><p>{compactList(selectedRaw.sentenceAnalysis || selectedRaw.editableSentences || [], '暂无').join('；')}</p></article>
              <article><b>错别字 / 病句</b><p>{compactList(selectedRaw.typos || selectedRaw.languageIssues || [], '暂无').join('；')}</p></article>
            </div>
          </Card>

          <Card title="教师评分" icon={<Check size={20} />}>
            <div className="teacher-review-panel">
              <label>作文总分
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={reviewForm.finalScore}
                  onChange={(e) => setReviewForm({ ...reviewForm, finalScore: e.target.value })}
                  placeholder="0 - 100"
                />
              </label>
              <label>教师评语（富文本）
                <RichTextEditor
                  value={reviewForm.comment}
                  onChange={(value) => setReviewForm({ ...reviewForm, comment: value })}
                  placeholder="输入教师总评、结构建议、逻辑诊断与修改方向"
                />
              </label>
              <div className="teacher-review-columns">
                <label>优点
                  <textarea rows="5" value={reviewForm.strengths} onChange={(e) => setReviewForm({ ...reviewForm, strengths: e.target.value })} placeholder="每行一条" />
                </label>
                <label>不足
                  <textarea rows="5" value={reviewForm.weaknesses} onChange={(e) => setReviewForm({ ...reviewForm, weaknesses: e.target.value })} placeholder="每行一条" />
                </label>
              </div>
              <label>修改建议
                <textarea rows="5" value={reviewForm.suggestions} onChange={(e) => setReviewForm({ ...reviewForm, suggestions: e.target.value })} placeholder="每行一条" />
              </label>
              <div className="workspace-actions">
                <button type="button" className="secondary-button" onClick={() => saveReview('draft')} disabled={savingReview}>{savingReview ? '保存中' : '保存草稿'}</button>
                <button type="button" className="primary-button" onClick={() => saveReview('submitted')} disabled={savingReview}>{savingReview ? '提交中' : '提交评分'}</button>
              </div>
            </div>
          </Card>

          <details className="rerun-accordion" open={rerunOpen} onToggle={(event) => setRerunOpen(event.currentTarget.open)}>
            <summary>重新批改</summary>
            <div className="rerun-panel">
              <p className="hint">默认收起。确认后将启动新的 gradingJob，并保留历史版本。</p>
              <label>Prompt
                <select value={rerunForm.promptMode} onChange={(e) => setRerunForm({ ...rerunForm, promptMode: e.target.value })}>
                  <option value="keep_original">保持原 Prompt</option>
                  <option value="update">更新 Prompt</option>
                  <option value="latest">使用最新 Prompt</option>
                </select>
              </label>
              <label>新 Prompt
                <textarea rows="5" value={rerunForm.promptText} onChange={(e) => setRerunForm({ ...rerunForm, promptText: e.target.value })} placeholder="仅在更新 Prompt 时填写" />
              </label>
              <label>重批原因
                <textarea rows="4" value={rerunForm.rerunReason} onChange={(e) => setRerunForm({ ...rerunForm, rerunReason: e.target.value })} placeholder="例如：教师补充反馈后重批" />
              </label>
              <div className="workspace-actions">
                <button type="button" className="secondary-button" onClick={() => setRerunOpen(false)}>取消</button>
                <button type="button" className="primary-button" onClick={rerunEssay} disabled={rerunning}>{rerunning ? '批改中' : '确认重新批改'}</button>
              </div>
            </div>
          </details>
        </div>
      </main>

      <aside className="teacher-workspace-rail">
        <Card title="报告操作" icon={<Download size={20} />}>
          <div className="report-action-stack">
            <button type="button" className="report-button" onClick={() => links.reportUrl && window.open(links.reportUrl, '_blank', 'noopener,noreferrer')}>查看归档报告</button>
            <button type="button" className="report-button" onClick={() => links.pdfUrl && window.open(links.pdfUrl, '_blank', 'noopener,noreferrer')}>下载 PDF</button>
            <button type="button" className="report-button" onClick={() => links.docxUrl && window.open(links.docxUrl, '_blank', 'noopener,noreferrer')}>下载 Word</button>
          </div>
        </Card>
      </aside>
    </section>
  </Layout>;
}

function SectionTitle({ title, actions }) {
  return <div className="section-title"><h2>{title}</h2>{actions}</div>;
}

function CopyTextButton({ text, label = '全文复制' }) {
  const [copied, setCopied] = useState(false);
  async function copy() { await navigator.clipboard.writeText(text || ''); setCopied(true); setTimeout(() => setCopied(false), 1200); }
  return <button className="copy-button" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? '已复制' : label}</button>;
}

function RewriteItem({ number, label, content }) {
  return <article className="rewrite-item"><h4><span>{number}</span>{label}</h4><p>{content}</p></article>;
}

function AdviceGuidanceList({ items = [] }) {
  const safeItems = items.filter(Boolean);
  return <div className="advice-guidance-list">{safeItems.map((item, index) => {
    const advice = typeof item === 'string'
      ? { focus: `建议${index + 1}`, diagnosis: item, logic_analysis: '这条问题会削弱作文从观点到材料再到结论的推理链条，使读者难以看清你的判断依据。', action_steps: '先圈出对应段落的中心句，再补入材料分析句，最后用一句话回扣中心论点。', example_direction: '可按“现象是什么-原因在哪里-我如何回应”的顺序改写。' }
      : item;
    return <article className="advice-guidance-card" key={index}>
      <h3><span>{String(index + 1).padStart(2, '0')}</span>{advice.focus || advice.title || `建议${index + 1}`}</h3>
      <p><b>问题诊断</b>{advice.diagnosis || advice.problem || advice.content || '当前问题还需要结合原文进一步定位。'}</p>
      <p><b>逻辑分析</b>{advice.logic_analysis || advice.logic || '要说明这个问题为什么影响中心表达，以及它在论证链条中造成的断点。'}</p>
      <p><b>修改步骤</b>{advice.action_steps || advice.steps || advice.method || '按“定位问题句-补充分析-回扣观点”的顺序完成修改。'}</p>
      <p><b>示例方向</b>{advice.example_direction || advice.example || '示例方向应贴近原文主题，给出可仿照的表达路径。'}</p>
    </article>;
  })}</div>;
}

function defaultThinkingCoachReport(review = {}) {
  const logic = review.logic_thinking_score || {};
  const items = Array.isArray(logic.items) && logic.items.length ? logic.items : [
    { name: '观点是否明确', score: 4, full: 6, diagnosis: '观点基本能回应题目，但还需要进一步界定核心概念。', guidance: '追问本文真正要证明什么，并检查每段是否回到同一中心判断。' },
    { name: '论证结构', score: 4, full: 6, diagnosis: '段落具备观点和材料，但解释、分析、回扣环节还不够完整。', guidance: '按“观点-解释-举例-分析-回扣”补齐段落链条。' },
    { name: '推理能力', score: 4, full: 6, diagnosis: '推理中间环节还可以更清楚，避免从个别例子直接推出普遍结论。', guidance: '补写材料为什么能证明观点，检查因果关系是否成立。' },
    { name: '材料使用能力', score: 4, full: 6, diagnosis: '材料与主题有关，但还需要从故事转化为论据。', guidance: '讲完材料后分析选择、原因、价值和现实启示。' },
    { name: '论证深度', score: 4, full: 6, diagnosis: '文章多停留在现象和原因层面，尚未充分揭示本质。', guidance: '继续追问本质、反例、社会联系、时代意义和人性选择。' }
  ];
  return {
    logic_thinking_score: { total: logic.total ?? items.reduce((sum, item) => sum + (Number(item.score) || 0), 0), full: logic.full || 30, items },
    thinking_depth: review.thinking_depth || { stars: 3, label: '一般', current_layer: '分析原因', reason: '文章已有基本分析意识，但还需要向本质、时代意义和反面辨析推进。' },
    thinking_improvement: review.thinking_improvement || {
      current: '当前主要回答了“是什么”，还需要继续追问“为什么”和“本质是什么”。',
      next_questions: ['为什么会这样？', '有没有另一种解释？', '有没有反例？', '本质是什么？', '与社会、时代或人性有什么联系？'],
      training_focus: '每个主体段至少补出一句因果分析和一句价值回扣。'
    },
    socratic_questions: review.socratic_questions || ['这一段观点是否真正回答题目？', '材料是否能证明观点，还是只是在讲故事？', '如果换一个角度，结论是否仍然成立？', '有没有隐藏原因或反例？', '你的观点能否推进到时代意义？'],
    thinking_coach: review.thinking_coach || {
      diagnosis: '当前主要问题是观点、材料和分析之间的逻辑链条不够完整。',
      questions: ['本段先证明什么？', '读者可能不同意哪里？', '材料中的哪一点真正支撑观点？'],
      guidance: '先补分析句，再调整段落顺序，不急于整篇代写。',
      revision_task: '选择一个薄弱主体段，补齐“观点-解释-举例-分析-回扣”五步。',
      reevaluation: '再次评价时检查观点是否稳定、推理是否完整、材料是否转化为论据。'
    }
  };
}

function ThinkingCoachPanel({ report }) {
  const logic = report.logic_thinking_score;
  const depth = report.thinking_depth;
  const improvement = report.thinking_improvement;
  const coach = report.thinking_coach;
  return <section className="review-card thinking-coach-card">
    <SectionTitle title="思维教练" actions={<span className="score-pill">逻辑思维能力 {logic.total}/{logic.full}</span>} />
    <div className="thinking-depth-row">
      <div><b>思维深度</b><strong>{'★'.repeat(Math.max(1, Number(depth.stars) || 1))}</strong><span>{depth.label} · {depth.current_layer}</span></div>
      <p>{depth.reason}</p>
    </div>
    <div className="thinking-score-grid">{logic.items.map((item) => <article key={item.name}>
      <h3>{item.name}<span>{item.score}/{item.full}</span></h3>
      <p><b>诊断</b>{item.diagnosis}</p>
      <p><b>引导</b>{item.guidance}</p>
    </article>)}</div>
    <div className="thinking-section">
      <h3>思维提升建议</h3>
      <p>{improvement.current}</p>
      <div className="coach-question-list">{(improvement.next_questions || []).map((question, index) => <span key={index}>{question}</span>)}</div>
      <p><b>训练重点</b>{improvement.training_focus}</p>
    </div>
    <div className="thinking-section">
      <h3>苏格拉底式追问</h3>
      <ol>{(report.socratic_questions || []).map((question, index) => <li key={index}>{question}</li>)}</ol>
    </div>
    <div className="revision-loop">
      <h3>深度修改闭环</h3>
      <p><b>诊断</b>{coach.diagnosis}</p>
      <p><b>提问</b>{(coach.questions || []).join(' / ')}</p>
      <p><b>引导</b>{coach.guidance}</p>
      <p><b>修改任务</b>{coach.revision_task}</p>
      <p><b>再次评价</b>{coach.reevaluation}</p>
    </div>
  </section>;
}

function ReviewSection({ title, items = [], numbered = false }) {
  const safeItems = items.filter(Boolean);
  return <section className="review-card"><SectionTitle title={title} /><div className={numbered ? 'advice-list numbered' : 'advice-list'}>{safeItems.map((item, index) => <p key={index}>{numbered && <b>{index + 1}.</b>}{item}</p>)}</div></section>;
}

function TeacherCommentEditor({ essayId, onSaved }) {
  const [open, setOpen] = useState(false); const [comment, setComment] = useState(''); const [busy, setBusy] = useState(false);
  async function save() { if (!comment.trim()) return; setBusy(true); const result = await api(`/essays/${essayId}/comments`, { method: 'POST', body: { comment } }); onSaved(result); setComment(''); setOpen(false); setBusy(false); }
  return <div className="comment-editor">{open ? <><textarea rows="4" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="补充教师总评、修改要求或训练建议" /><div className="editor-actions"><button className="ghost-button" onClick={() => setOpen(false)}>取消</button><button onClick={save} disabled={busy}>{busy ? '保存中' : '保存教师批注'}</button></div></> : <button className="edit-review" onClick={() => setOpen(true)}><PenLine size={16} />编辑总评</button>}</div>;
}

function MarkedOriginal({ text, changes }) {
  const target = changes.find((item) => item.original && text.includes(item.original));
  if (!target) return text;
  const [before, after] = text.split(target.original);
  return <>{before}<span className="changed-text">{target.original}</span><span className="revision-note"> 修改为：{target.revision}</span>{after}</>;
}

function ReviewBlock({ title, items = [] }) {
  return <Card title={title}><ul>{items.filter(Boolean).map((x, i) => <li key={i}>{x}</li>)}</ul></Card>;
}

function buildInlineDiff(original = '', polished = '') {
  const oldTokens = Array.from(String(original || ''));
  const newTokens = Array.from(String(polished || ''));
  const rows = Array.from({ length: oldTokens.length + 1 }, () => new Uint32Array(newTokens.length + 1));
  for (let i = oldTokens.length - 1; i >= 0; i -= 1) {
    for (let j = newTokens.length - 1; j >= 0; j -= 1) {
      rows[i][j] = oldTokens[i] === newTokens[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }
  const parts = [];
  function push(type, text) {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.type === type) last.text += text;
    else parts.push({ type, text });
  }
  let i = 0; let j = 0;
  while (i < oldTokens.length && j < newTokens.length) {
    if (oldTokens[i] === newTokens[j]) {
      push('original', oldTokens[i]);
      i += 1;
      j += 1;
    } else if (rows[i + 1][j] >= rows[i][j + 1]) {
      push('deleted', oldTokens[i]);
      i += 1;
    } else {
      push('added', newTokens[j]);
      j += 1;
    }
  }
  while (i < oldTokens.length) {
    push('deleted', oldTokens[i]);
    i += 1;
  }
  while (j < newTokens.length) {
    push('added', newTokens[j]);
    j += 1;
  }
  return parts.length ? parts : [{ type: 'original', text: original }];
}

function PolishedComparison({ original, polished, embedded = false }) {
  const diffParts = buildInlineDiff(original, polished);
  const diffClassName = { original: 'diff-fragment original-text', added: 'diff-fragment added-text', deleted: 'diff-fragment deleted-text' };
  const body = <div className="polish-comparison"><div className="comparison-heading"><h2>原文润色提升对比</h2><button className="mini-action" onClick={() => navigator.clipboard.writeText(polished || '')}><Copy size={15} />全文复制</button></div><div className="comparison-legend"><span className="legend-original">原文</span><span className="legend-added">新增</span><span className="legend-deleted">删除</span></div><p className="comparison-text">{diffParts.map((part, index) => <span key={`${part.type}-${index}`} className={part.type === 'added' ? diffClassName.added : part.type === 'deleted' ? diffClassName.deleted : diffClassName.original}>{part.text}</span>)}</p></div>;
  return embedded ? body : <Card title="原文润色提升对比">{body}</Card>;
}

function CorrectionComparison({ original, changes = [] }) {
  const match = changes.find((item) => item.original && original.includes(item.original));
  if (!match) return <div className="polish-comparison"><div className="comparison-heading"><h2>原文基础纠正对比</h2><button className="mini-action" onClick={() => navigator.clipboard.writeText(original || '')}><Copy size={15} />全文复制</button></div><p className="comparison-text">当前未识别到需要逐句纠正的内容。请结合上方“建议”完成针对性修改。</p></div>;
  const [before, after] = original.split(match.original);
  return <div className="polish-comparison"><div className="comparison-heading"><h2>原文基础纠正对比</h2><button className="mini-action" onClick={() => navigator.clipboard.writeText(`${before}${match.revision}${after}`)}><Copy size={15} />全文复制</button></div><div className="comparison-legend"><span className="legend-original">保留</span><span className="legend-added">建议替换</span><span className="legend-deleted">原文问题</span></div><p className="comparison-text"><span>{before}</span><span className="deleted-text">{match.original}</span><span className="added-text">{match.revision}</span><span>{after}</span></p></div>;
}

function ReviewBottomBar({ essayId, onReReview }) {
  async function exp(format) { const data = await api(`/reports/essay/${essayId}/${format}`, { method: 'POST', body: {} }); window.open(assetUrl(data.url), '_blank'); }
  async function share() { if (navigator.share) await navigator.share({ title: '作文批改结果', url: location.href }); else await navigator.clipboard.writeText(location.href); }
  const [saved, setSaved] = useState(false);
  return <nav className="review-bottom"><button title="选为范文" onClick={() => setSaved((value) => !value)} className={saved ? 'saved-example' : ''}><Star fill={saved ? 'currentColor' : 'none'} /><span>{saved ? '已选范文' : '选为范文'}</span></button><button title="分享好友" onClick={share}><Share2 /><span>分享好友</span></button><button title="导出 PDF" onClick={() => exp('pdf')}><Download /><span>导出PDF</span></button><button className="word-export" onClick={() => exp('docx')}><FileText />导出 Word</button></nav>;
}

function assetUrl(pathname) {
  const isPrivateHost = /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(window.location.hostname);
  return window.location.port === '5173' && isPrivateHost ? `http://${window.location.hostname}:4000${pathname}` : pathname;
}

function ExportButtons({ essayId, studentId, classId }) {
  async function exp(type, id, format) {
    const data = await api(`/reports/${type}/${id}/${format}`, { method: 'POST', body: {} });
    const isPrivateHost = /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(window.location.hostname);
    const exportUrl = window.location.port === '5173' && isPrivateHost
      ? `http://${window.location.hostname}:4000${data.url}`
      : data.url;
    window.open(exportUrl, '_blank');
  }
  return <Card title="导出" icon={<Download size={20} />}>
    <div className="actions">
      {essayId && <><button onClick={() => exp('essay', essayId, 'docx')}>作文 Word</button><button onClick={() => exp('essay', essayId, 'pdf')}>作文 PDF</button></>}
      {studentId && <><button onClick={() => exp('student', studentId, 'docx')}>档案 Word</button><button onClick={() => exp('student', studentId, 'pdf')}>档案 PDF</button></>}
      {classId && <><button onClick={() => exp('class', classId, 'docx')}>班级 Word</button><button onClick={() => exp('class', classId, 'pdf')}>班级 PDF</button></>}
    </div>
  </Card>;
}

function StudentProfile() {
  const session = getSession();
  const [data, setData] = useState(null);
  useEffect(() => { api(`/analytics/students/${session.studentId}`).then(setData); }, []);
  const personalized = useMemo(() => JSON.parse(data?.profile?.personalized_suggestions || '[]'), [data]);
  const thinkingArchive = useMemo(() => personalized.find((item) => item?.type === 'thinking_growth') || {}, [personalized]);
  const thinkingGrowth = useMemo(() => thinkingArchive.abilities || [
    { name: '逻辑能力', score: '--', trend: '等待更多批改数据' },
    { name: '思辨能力', score: '--', trend: '等待更多批改数据' },
    { name: '论证能力', score: '--', trend: '等待更多批改数据' },
    { name: '材料分析能力', score: '--', trend: '等待更多批改数据' },
    { name: '语言表达能力', score: '--', trend: '等待更多批改数据' },
    { name: '修改能力', score: '--', trend: '等待更多批改数据' }
  ], [thinkingArchive]);
  const thinkingAnalyses = useMemo(() => thinkingArchive.thinking_analyses || thinkingArchive.analyses || [], [thinkingArchive]);
  const trend = useMemo(() => JSON.parse(data?.profile?.score_trend || '[]').map((item, index) => ({
    ...item,
    essayLabel: `第${index + 1}篇`
  })), [data]);
  const trendStats = useMemo(() => {
    const scores = trend.map((item) => Number(item.score)).filter((score) => Number.isFinite(score));
    const latestScore = scores.length ? scores.at(-1) : null;
    const bestScore = scores.length ? Math.max(...scores) : null;
    const scoreDelta = scores.length > 1 ? latestScore - scores[0] : null;
    return { latestScore, bestScore, scoreDelta, count: scores.length };
  }, [trend]);
  return <Layout><div className="grid">
    <Card title="个人作文档案" icon={<ChartNoAxesCombined size={20} />}>
      <p>{data?.profile?.growth_report || '暂无档案'}</p>
      <div className="profile-stats">
        <span><b>{trendStats.latestScore ?? '--'}</b>最近得分</span>
        <span><b>{trendStats.bestScore ?? '--'}</b>最高得分</span>
        <span><b>{trendStats.scoreDelta == null ? '--' : `${trendStats.scoreDelta >= 0 ? '+' : ''}${trendStats.scoreDelta}`}</b>成绩变化</span>
        <span><b>{trendStats.count}</b>已批改作文</span>
      </div>
      <div className="chart" aria-label="成绩趋势图">
        {trend.length ? <ResponsiveContainer>
          <LineChart data={trend} margin={{ top: 8, right: 18, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e3ebe7" />
            <XAxis dataKey="essayLabel" tick={{ fontSize: 12 }} />
            <YAxis domain={[0, 60]} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(value) => [`${value}分`, '成绩']} labelFormatter={(label) => `成绩趋势图：${label}`} />
            <Line type="monotone" dataKey="score" stroke="#226b5f" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer> : <div className="chart-empty">暂无已批改成绩，完成批改后会生成成绩趋势图。</div>}
      </div>
    </Card>
    <Card title="思维成长档案" icon={<BrainCircuit size={20} />}>
      <p className="hint">结合已批改作文的详细分析：{thinkingArchive.summary || '完成更多作文批改后，将按篇目归纳思维优势、薄弱点和下一步修改方向。'}</p>
      <div className="thinking-growth-grid">{thinkingGrowth.map((item) => <article key={item.name}><b>{item.score}</b><span>{item.name}</span><p>{item.trend}</p></article>)}</div>
      <div className="thinking-analysis-list">{thinkingAnalyses.map((item) => <article key={item.essay_id || item.essay_title}><h3>{item.essay_title}</h3><p>{item.detailed_analysis}</p><p><b>文本证据</b>{(item.evidence || []).join('；')}</p></article>)}</div>
    </Card>
    <Card title="历次作文" icon={<FileText size={20} />}>{data?.essays?.map((x) => <article className="item" key={x.id}><b>{x.assignment_title}</b><p>{x.total_score || '-'}分 · {x.level || '待批改'}</p><a href={`/review/${x.id}`}>查看</a></article>)}</Card>
    <ExportButtons studentId={session.studentId} />
  </div></Layout>;
}

function PublicAccessPanel({ title = '外网访问', intro = '公网入口由 Cloudflare Tunnel 转发到本机 4000 端口。', compact = false }) {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => { api('/public-access').then(setStatus).catch((err) => setMessage(err.message)); }, []);

  async function copyUrl() {
    if (!status?.url) return;
    try {
      await navigator.clipboard.writeText(status.url);
      setMessage('已复制公网访问地址');
    } catch {
      setMessage('复制失败，请手动选中地址复制');
    }
  }

  return <Card title={title} icon={<Share2 size={20} />} className={compact ? 'public-access-card compact' : 'public-access-card'}>
    {!status && !message && <p className="hint">正在读取公网配置...</p>}
    {status && <div className="public-access">
      <p className="hint">{intro}</p>
      <p className="public-url">{status.url || '尚未配置公网地址'}</p>
      <div className="actions">
        <button onClick={copyUrl} disabled={!status.url}><Copy size={16} />复制地址</button>
        <a className="button-link" href={status.url || '#'} target="_blank" rel="noreferrer" aria-disabled={!status.url}>打开外网</a>
      </div>
      <div className="access-checks">
        <span className={status.enabled ? 'ok' : 'warn'}>{status.enabled ? '公网入口已配置' : '未找到公网入口'}</span>
        <span className={status.hasTunnelBinary ? 'ok' : 'warn'}>{status.hasTunnelBinary ? '隧道工具存在' : '缺少隧道工具'}</span>
        <span>{status.tunnelService || '未读取到本地服务目标'}</span>
      </div>
      {!compact && <p className="hint">生产模式使用 {status.recommendedCommand} 启动。</p>}
    </div>}
    {message && <p className={message.includes('复制') ? 'success' : 'error'}>{message}</p>}
  </Card>;
}

function TeacherDashboardCard() {
  const [data, setData] = useState(null);
  useEffect(() => { api('/teacher/dashboard').then(setData).catch(() => {}); }, []);
  return <Card title="教师工作台" icon={<School size={20} />}>
    {!data ? <p className="hint">正在读取教师后台数据...</p> : <>
      <div className="teacher-kpis">
        <span><b>{data.classes.visible ?? data.classes.total}</b>可见班级</span>
        <span><b>{data.students.visible ?? data.students.total}</b>可见学生</span>
        <span><b>{data.classes.test ?? 0}</b>测试班级</span>
        <span><b>{data.students.test ?? 0}</b>测试学生</span>
        <span><b>{data.essays.total}</b>作文</span>
        <span><b>{data.scores.average7d ?? '--'}</b>7天均分</span>
      </div>
      <div className="access-checks">
        <span className={data.services.deepseek === 'healthy' ? 'ok' : 'warn'}>DeepSeek {data.services.deepseek}</span>
        <span className={data.services.nas === 'healthy' ? 'ok' : 'warn'}>NAS {data.services.nas}</span>
        <span className="ok">生产 {data.services.production}</span>
        <span>队列 {data.queues.archivePending + data.queues.profilePending + data.queues.managementPending}</span>
      </div>
      <div className="quick teacher-nav">
        <a href="/teacher/classes"><Users size={18} />班级管理</a>
        <a href="/teacher/students"><GraduationCap size={18} />学生管理</a>
        <a href="/teacher/essays"><FileText size={18} />作文管理</a>
        <a href="/teacher/tasks"><RotateCcw size={18} />任务中心</a>
        <a href="/teacher/test-center"><TestTube2 size={18} />系统测试中心</a>
        <a href="/teacher/benchmark"><FileSpreadsheet size={18} />Benchmark Center</a>
      </div>
    </>}
  </Card>;
}

function TeacherManagementShell({ title, icon, children }) {
  return <Layout>
    <section className="role-banner teacher-banner">
      <div className="role-banner-mark"><School size={28} /></div>
      <div>
        <p>教师后台</p>
        <h2>{title}</h2>
      </div>
    </section>
    <div className="teacher-subnav">
      <a href="/teacher">首页</a>
      <a href="/teacher/classes">班级</a>
      <a href="/teacher/students">学生</a>
      <a href="/teacher/essays">作文</a>
      <a href="/teacher/tasks">任务</a>
      <a href="/teacher/test-center">测试中心</a>
      <a href="/teacher/benchmark">Benchmark</a>
    </div>
    <Card title={title} icon={icon}>{children}</Card>
  </Layout>;
}

function BenchmarkCenterPage() {
  const [status, setStatus] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [latest, setLatest] = useState(null);
  const [message, setMessage] = useState('');
  const [running, setRunning] = useState(false);

  async function load() {
    const [nextStatus, nextDatasets, nextLatest] = await Promise.all([
      api('/benchmark/status'),
      api('/benchmark/datasets?pageSize=20'),
      api('/benchmark/reports/latest')
    ]);
    setStatus(nextStatus);
    setDatasets(nextDatasets.items || []);
    setLatest(nextLatest);
  }

  useEffect(() => { load().catch((err) => setMessage(err.message)); }, []);

  async function runMockBenchmark() {
    setRunning(true);
    setMessage('');
    try {
      const result = await api('/benchmark/run', { method: 'POST', body: { mock: true, providerNames: ['mock'] } });
      setMessage(`Benchmark 完成：样本 ${result.summary?.samples || 0}，均分 ${result.summary?.averageScore || 0}`);
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setRunning(false);
    }
  }

  function downloadExport(file) {
    window.open(`${apiBaseUrl()}/benchmark/download/${encodeURIComponent(file)}`, '_blank', 'noopener,noreferrer');
  }

  function downloadNamedExport(label, file) {
    return <button type="button" onClick={() => downloadExport(file)} disabled={!(latest?.exports || []).includes(file)}><Download size={16} />{label}</button>;
  }

  return <TeacherManagementShell title="Benchmark Center" icon={<FileSpreadsheet size={20} />}>
    <div className="teacher-kpis">
      <span><b>{status?.datasets ?? '--'}</b>历史样本</span>
      <span><b>{status?.summary?.averageScore ?? '--'}</b>平均分</span>
      <span><b>{status?.summary?.averageImprovementRate ?? '--'}%</b>提升率</span>
      <span><b>{status?.latestRun?.completedAt ? formatDateTime(status.latestRun.completedAt) : '--'}</b>最近运行时间</span>
    </div>
    <div className="actions">
      <button type="button" onClick={runMockBenchmark} disabled={running}><RotateCcw size={16} />{running ? '运行中' : '重新运行 Benchmark'}</button>
      <button type="button" onClick={() => load().catch((err) => setMessage(err.message))}><Search size={16} />刷新</button>
      {downloadNamedExport('下载 Word', 'Benchmark_Report.docx')}
      {downloadNamedExport('下载 PDF', 'Benchmark_Report.pdf')}
      {downloadNamedExport('下载 Excel', 'Benchmark_Report.xlsx')}
      {downloadNamedExport('下载 Markdown', 'Benchmark_Report.md')}
    </div>
    {message && <p className={message.includes('完成') ? 'success' : 'error'}>{message}</p>}
    <div className="archive-grid">
      <div className="archive-list">
        <h3>历史作文</h3>
        {datasets.map((item) => <article className="archive-row" key={item.id}>
          <div>
            <b>{item.title}</b>
            <p>{item.grade} · {item.className} · {item.wordCount}字 · {item.authorId}</p>
            <code>{item.id}</code>
          </div>
        </article>)}
        {!datasets.length && <p className="hint">暂无 Benchmark 样本，可通过 API 或脚本导入历史作文。</p>}
      </div>
      <aside className="archive-detail">
        <h3>历史运行记录</h3>
        {(status?.recentRuns || []).slice(0, 6).map((run) => <article className="archive-row" key={run.runId}>
          <div>
            <b>{formatDateTime(run.completedAt)}</b>
            <p>样本 {run.samples} · 成功 {run.successCount} · 均分 {run.averageScore} · 提升 {run.averageImprovementRate}%</p>
            <code>{(run.providers || []).join(', ') || 'mock'} · {run.status}</code>
          </div>
        </article>)}
        {!status?.recentRuns?.length && <p className="hint">暂无历史运行记录。</p>}
        <h3>导出报告</h3>
        {(latest?.exports || []).map((file) => <button key={file} type="button" onClick={() => downloadExport(file)}><Download size={16} />{file}</button>)}
        {!latest?.exports?.length && <p className="hint">尚未生成 Benchmark 导出报告。</p>}
        <p className="hint">待重试任务：{status?.queuePending ?? 0}</p>
      </aside>
    </div>
  </TeacherManagementShell>;
}

function TeacherClassesPage() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ scope: 'system_test', keyword: '', grade: '', schoolYear: '', status: '' });
  const [message, setMessage] = useState('');
  async function load() {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
    const data = await api(`/teacher/classes${query ? `?${query}` : ''}`);
    setRows(data.items || []);
  }
  useEffect(() => { load().catch((err) => setMessage(err.message)); }, []);
  async function archive(classKey) {
    if (!window.confirm('归档班级不会删除学生和历史作文，确认继续？')) return;
    await api(`/teacher/classes/${encodeURIComponent(classKey)}/archive`, { method: 'POST', body: {} });
    await load();
  }
  return <TeacherManagementShell title="班级管理" icon={<Users size={20} />}>
    <form className="archive-toolbar" onSubmit={(e) => { e.preventDefault(); load(); }}>
      <select value={filters.scope} onChange={(e) => setFilters({ ...filters, scope: e.target.value })}><option value="system_test">仅系统测试数据</option><option value="">全部历史数据</option></select>
      <label><Search size={18} /><input value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })} placeholder="搜索班级/教师" /></label>
      <input value={filters.grade} onChange={(e) => setFilters({ ...filters, grade: e.target.value })} placeholder="年级" />
      <input value={filters.schoolYear} onChange={(e) => setFilters({ ...filters, schoolYear: e.target.value })} placeholder="学年" />
      <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">全部状态</option><option value="active">active</option><option value="archived">archived</option></select>
      <button><Filter size={18} />筛选</button>
    </form>
    <p className="hint">默认仅展示系统测试班级。切换到“全部历史数据”可以查看旧班级，但不会自动执行删除。</p>
    {message && <p className="error">{message}</p>}
    <div className="management-table">
      {rows.map((klass) => <article className="management-row" key={klass.classKey}>
        <b>{klass.className}<span>{klass.grade} · {klass.schoolYear}</span></b>
        <span>{klass.studentCount} 人</span>
        <span>{klass.essayCount} 篇</span>
        <span>均分 {klass.averageScore ?? '--'}</span>
        <span>优秀率 {klass.excellentRate == null ? '--' : `${Math.round(klass.excellentRate * 100)}%`}</span>
        <span>{klass.status}</span>
        <span className="record-actions">
          <a href={`/teacher/classes/${encodeURIComponent(klass.classKey)}`}>详情</a>
          <a href={`/teacher/classes/${encodeURIComponent(klass.classKey)}/members`}>成员管理</a>
          {klass.status !== 'archived' ? <button type="button" onClick={() => archive(klass.classKey)}>归档</button> : <span className="hint">已归档</span>}
        </span>
      </article>)}
      {!rows.length && <p className="hint">暂无班级数据，请先运行 classes:rebuild 或创建班级。</p>}
    </div>
  </TeacherManagementShell>;
}

function TeacherClassDetailPage() {
  const { classKey } = useParams();
  const [data, setData] = useState({ klass: null, stats: null, students: [], essays: [] });
  const [message, setMessage] = useState('');
  useEffect(() => {
    Promise.all([
      api(`/teacher/classes/${encodeURIComponent(classKey)}`),
      api(`/teacher/classes/${encodeURIComponent(classKey)}/statistics`),
      api(`/teacher/classes/${encodeURIComponent(classKey)}/students`),
      api(`/teacher/classes/${encodeURIComponent(classKey)}/essays`)
    ]).then(([klass, stats, students, essays]) => setData({ klass, stats, students: students.items || [], essays: essays.items || [] })).catch((err) => setMessage(err.message));
  }, [classKey]);
  const trendRows = data.stats?.submitTrend30d || [];
  return <TeacherManagementShell title="班级详情" icon={<School size={20} />}>
    {message && <p className="error">{message}</p>}
    {data.klass && <><div className="teacher-kpis"><span><b>{data.stats.studentTotal}</b>学生</span><span><b>{data.stats.essayTotal}</b>作文</span><span><b>{data.stats.averageScore ?? '--'}</b>均分</span><span><b>{Math.round((data.stats.gradingCompletionRate || 0) * 100)}%</b>完成率</span></div>
    {trendRows.length ? <ResponsiveContainer width="100%" height={180}><LineChart data={trendRows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip /><Line dataKey="count" stroke="#226b5f" strokeWidth={3} /></LineChart></ResponsiveContainer> : <p className="hint">暂无提交趋势。</p>}
    <h3>学生</h3><div className="management-table">{data.students.map((student) => <a className="management-row" href={`/student-profiles/${encodeURIComponent(student.studentKey)}`} key={student.studentKey}><b>{student.studentName}<span>{student.studentId}</span></b><span>{student.essayCount}篇</span><span>{student.averageScore ?? '--'}分</span><span>{student.scoreTrend || '样本不足'}</span><span>{student.weakestAbility || '--'}</span></a>)}</div>
    <h3>作文</h3><div className="management-table">{data.essays.slice(0, 10).map((essay) => <article className="management-row" key={essay.archiveId}><b>{essay.essayTitle}<span>{essay.studentName}</span></b><span>{essay.score ?? '--'}分</span><span>{essay.level || '--'}</span><code>{essay.nasPath}</code></article>)}</div></>}
  </TeacherManagementShell>;
}

function TeacherStudentsPage() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ scope: 'system_test', keyword: '', classKey: '', trend: '', status: '' });
  async function load() {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
    const data = await api(`/teacher/students${query ? `?${query}` : ''}`);
    setRows(data.items || []);
  }
  useEffect(() => { load().catch(() => {}); }, []);
  return <TeacherManagementShell title="学生管理" icon={<GraduationCap size={20} />}>
    <form className="archive-toolbar" onSubmit={(e) => { e.preventDefault(); load(); }}>
      <select value={filters.scope} onChange={(e) => setFilters({ ...filters, scope: e.target.value })}><option value="system_test">仅系统测试数据</option><option value="">全部历史数据</option></select>
      <label><Search size={18} /><input value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })} placeholder="搜索姓名/学号" /></label>
      <input value={filters.classKey} onChange={(e) => setFilters({ ...filters, classKey: e.target.value })} placeholder="classKey" />
      <select value={filters.trend} onChange={(e) => setFilters({ ...filters, trend: e.target.value })}><option value="">全部趋势</option><option value="up">up</option><option value="stable">stable</option><option value="down">down</option></select>
      <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">全部状态</option><option value="active">active</option><option value="archived">archived</option></select>
      <button><Filter size={18} />筛选</button>
    </form>
    <p className="hint">默认仅展示系统测试学生。切换到“全部历史数据”可以查看旧学生名单，但不会自动执行删除。</p>
    <div className="management-table">{rows.map((student) => <a className="management-row" href={`/student-profiles/${encodeURIComponent(student.studentKey)}`} key={student.studentKey}><b>{student.studentName}<span>{student.studentId}</span></b><span>{student.className}</span><span>{student.essayCount}篇</span><span>均分 {student.averageScore ?? '--'}</span><span>最近 {student.latestScore ?? '--'}</span><span>{student.scoreTrend || '--'}</span><span>{student.weakestAbility || '--'}</span></a>)}</div>
  </TeacherManagementShell>;
}

function TeacherTestCenterPage() {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');

  async function load() {
    setBusy('load');
    try {
      setData(await api('/teacher/test-center'));
      setMessage('');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy('');
    }
  }

  useEffect(() => { load().catch(() => {}); }, []);

  async function resetFixture() {
    setBusy('reset');
    try {
      const result = await api('/teacher/test-center/reset-fixture', { method: 'POST', body: {} });
      setData(result.snapshot);
      setMessage('系统测试入口已重建。');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy('');
    }
  }

  async function rerunDryRun() {
    setBusy('dry-run');
    try {
      const result = await api('/teacher/cleanup/legacy/dry-run');
      const snapshot = await api('/teacher/test-center');
      setData({ ...snapshot, report: result.report, reportFiles: result.files });
      setMessage(`dry-run 已生成：可归档 ${result.report?.archive?.length || 0} 条，物理删除候选 ${result.report?.physicalDelete?.length || 0} 条。`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy('');
    }
  }

  const report = data?.report || null;
  const fixtureClass = data?.fixture?.class || null;
  const fixtureStudent = data?.fixture?.student || null;

  return <TeacherManagementShell title="系统测试中心" icon={<TestTube2 size={20} />}>
    <p className="hint">仅供系统测试，请勿用于真实学生数据。这里默认只展示系统测试班级和系统测试学生，旧数据保留在历史视图中。</p>
    {message && <p className="hint">{message}</p>}
    <div className="actions">
      <button type="button" onClick={resetFixture} disabled={busy === 'reset'}>{busy === 'reset' ? '重建中...' : '重建系统测试入口'}</button>
      <button type="button" onClick={rerunDryRun} disabled={busy === 'dry-run'}>{busy === 'dry-run' ? '生成中...' : '重新生成 dry-run'}</button>
      <button type="button" onClick={load} disabled={busy === 'load'}>{busy === 'load' ? '刷新中...' : '刷新'}</button>
    </div>
    <div className="teacher-kpis">
      <span><b>{report?.teacherManagement?.totals?.testClasses ?? 0}</b>测试班级</span>
      <span><b>{report?.teacherManagement?.totals?.testStudents ?? 0}</b>测试学生</span>
      <span><b>{report?.archive?.length ?? 0}</b>拟归档</span>
      <span><b>{report?.logicalDelete?.length ?? 0}</b>拟逻辑删除</span>
      <span><b>{report?.physicalDelete?.length ?? 0}</b>拟物理删除</span>
    </div>
    <div className="archive-grid">
      <div className="archive-list">
        <h3>测试入口</h3>
        <article className="archive-row">
          <div>
            <b>{fixtureClass?.className || '系统测试班'}</b>
            <p>{fixtureClass?.grade || '测试'} · {fixtureClass?.schoolYear || '当前学年'} · {fixtureClass?.joinMode || 'approval'}</p>
            <code>{fixtureClass?.classKey || '未配置 classKey'}</code>
            <p className="hint">邀请口令：{fixtureClass?.inviteCode || 'SYSTEM-TEST-001'} · 状态：{fixtureClass?.status || 'active'}</p>
          </div>
        </article>
        <article className="archive-row">
          <div>
            <b>{fixtureStudent?.studentName || '测试学生'}</b>
            <p>{fixtureStudent?.studentId || 'TEST001'} · {fixtureStudent?.className || '系统测试班'}</p>
            <code>{fixtureStudent?.studentKey || 'TEST001_测试学生'}</code>
          </div>
        </article>
        <div className="actions">
          <a className="button-link" href={data?.links?.teacherClasses || '/teacher/classes?scope=system_test'}>打开班级管理</a>
          <a className="button-link" href={data?.links?.teacherStudents || '/teacher/students?scope=system_test'}>打开学生管理</a>
          <a className="button-link" href={data?.links?.teacherAssignments || '/assignments/new'}>发布测试任务</a>
        </div>
        <div className="actions">
          <a className="button-link" href={data?.links?.studentJoin || '/student-mobile/join/code'}>学生入班页</a>
          <a className="button-link" href={data?.links?.studentHome || '/student-mobile/home'}>学生首页</a>
          <a className="button-link" href={data?.links?.teacherTasks || '/teacher/tasks'}>任务中心</a>
        </div>
      </div>
      <aside className="archive-detail">
        <h3>dry-run 结果</h3>
        <p className="hint">备份：{report?.backupPath || '未找到最新备份'}</p>
        {report ? <>
          <p>teacher-management：班级 {report.teacherManagement?.totals?.classes ?? 0}，学生 {report.teacherManagement?.totals?.students ?? 0}，作文 {report.teacherManagement?.totals?.essays ?? 0}</p>
          <p>SQLite：班级 {report.sqlite?.tables?.classes ?? 0}，学生 {report.sqlite?.tables?.students ?? 0}，作文 {report.sqlite?.tables?.essays ?? 0}，AI 记录 {report.sqlite?.tables?.ai_reviews ?? 0}</p>
          <h4>建议保留</h4>
          {(report.keep || []).slice(0, 6).map((item) => <article className="archive-row" key={`${item.type}-${item.key}`}>
            <div><b>{item.name}</b><p>{item.type} · {item.key}</p></div>
          </article>)}
          <h4>拟归档</h4>
          {(report.archive || []).slice(0, 6).map((item) => <article className="archive-row" key={item.classKey}>
            <div><b>{item.className}</b><p>{item.classKey} · {item.recommendedAction}</p></div>
          </article>)}
          <h4>拟物理删除</h4>
          {(report.physicalDelete || []).slice(0, 6).map((item) => <article className="archive-row" key={item.classKey || item.studentKey}>
            <div><b>{item.className || item.studentName}</b><p>{item.classKey || item.studentKey} · {item.recommendedAction}</p></div>
          </article>)}
        </> : <p className="hint">点击“重新生成 dry-run”后会显示清理建议。</p>}
      </aside>
    </div>
  </TeacherManagementShell>;
}

function TeacherEssaysPage() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ keyword: '', classKey: '', archiveStatus: '', provider: '' });
  const [message, setMessage] = useState('');
  async function load() {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
    const data = await api(`/teacher/essays${query ? `?${query}` : ''}`);
    setRows(data.items || []);
  }
  async function comment(archiveId) {
    const text = window.prompt('教师点评');
    if (!text) return;
    await api(`/teacher/essays/${encodeURIComponent(archiveId)}/comments`, { method: 'POST', body: { overallComment: text, visibleToStudent: true } });
    setMessage('教师点评已保存。');
    await load();
  }
  useEffect(() => { load().catch((err) => setMessage(err.message)); }, []);
  return <TeacherManagementShell title="作文管理" icon={<FileText size={20} />}>
    <form className="archive-toolbar" onSubmit={(e) => { e.preventDefault(); load(); }}>
      <label><Search size={18} /><input value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })} placeholder="搜索作文/学生" /></label>
      <input value={filters.classKey} onChange={(e) => setFilters({ ...filters, classKey: e.target.value })} placeholder="classKey" />
      <select value={filters.archiveStatus} onChange={(e) => setFilters({ ...filters, archiveStatus: e.target.value })}><option value="">全部归档</option><option value="archived">archived</option><option value="queued">queued</option></select>
      <select value={filters.provider} onChange={(e) => setFilters({ ...filters, provider: e.target.value })}><option value="">全部模型</option><option value="deepseek">deepseek</option></select>
      <button><Filter size={18} />筛选</button>
    </form>
    {message && <p className="success">{message}</p>}
    <div className="management-table">{rows.map((essay) => <article className="management-row" key={essay.archiveId}><b>{essay.essayTitle}<span>{essay.studentId}_{essay.studentName}</span></b><span>{essay.className}</span><span>{essay.score ?? '--'}分</span><span>{essay.level || '--'}</span><span>{essay.provider}</span><span>{essay.nasArchiveStatus}</span><code>{essay.nasPath}</code><span className="record-actions"><a href="/archive">归档</a><button type="button" onClick={() => comment(essay.archiveId)}>点评</button></span></article>)}</div>
  </TeacherManagementShell>;
}

function TeacherTasksPage() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  async function load() {
    const data = await api(`/teacher/tasks${status ? `?status=${encodeURIComponent(status)}` : ''}`);
    setRows(data.items || []);
  }
  useEffect(() => { load().catch(() => {}); }, []);
  return <TeacherManagementShell title="批改任务中心" icon={<RotateCcw size={20} />}>
    <form className="archive-toolbar" onSubmit={(e) => { e.preventDefault(); load(); }}>
      <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="queued">queued</option><option value="processing">processing</option><option value="completed">completed</option><option value="failed">failed</option><option value="retrying">retrying</option></select>
      <button><Filter size={18} />筛选</button>
      <button type="button" onClick={() => api('/teacher/tasks/retry-pending', { method: 'POST', body: {} }).then(load)}>重试队列</button>
    </form>
    <div className="management-table">{rows.map((task) => <article className="management-row" key={task.taskId}><b>{task.essayTitle}<span>{task.taskId}</span></b><span>{task.status}</span><span>{task.progress}%</span><span>{task.provider}</span><span>{task.retryCount}次</span><code>{task.nasPath}</code></article>)}</div>
  </TeacherManagementShell>;
}

function TeacherHome() {
  return <Layout>
    <section className="role-banner teacher-banner">
      <div className="role-banner-mark"><GraduationCap size={28} /></div>
      <div>
        <p>教师端</p>
        <h2>班级管理、任务发布与批改汇总</h2>
      </div>
    </section>
    <div className="grid"><TeacherDashboardCard /><PublicAccessPanel title="公网演示入口" intro="用于手机端访问、课堂展示和线上演示。复制后可直接发给听众。" /><TeacherRerunTaskCard /><Card title="系统测试中心" icon={<TestTube2 size={20} />}><p className="hint">统一查看测试班级、测试学生和清理 dry-run 结果。</p><div className="actions"><a className="button-link" href="/teacher/test-center">进入测试中心</a></div></Card><Card title="飞书班级群" icon={<MessageCircle size={20} />}><p className="hint">绑定班级主群、备用群，并发送系统测试消息。</p><div className="actions"><a className="button-link" href="/teacher/feishu/classes">进入群绑定</a></div></Card><Card title="Archive" icon={<PackageOpen size={20} />}><p className="hint">查看作文自动归档、NAS 路径和待同步状态。</p><div className="actions"><a className="button-link" href="/archive">进入 Archive</a></div></Card><Card title="学生成长档案" icon={<TrendingUp size={20} />}><p className="hint">查看学生分数趋势、能力变化、高频问题和训练计划。</p><div className="actions"><a className="button-link" href="/student-profiles">进入档案中心</a></div></Card><PasswordCard /><AssignmentPublish /><AssignmentManagement /><ClassManagement /><TeacherReviewCenter /><TeacherInsightPanel /></div>
  </Layout>;
}

function TeacherReviewCenter() {
  const [classes, setClasses] = useState([]); const [assignments, setAssignments] = useState([]); const [essays, setEssays] = useState([]);
  const [activeClassId, setActiveClassId] = useState('all'); const [activeAssignmentId, setActiveAssignmentId] = useState('');
  const [query, setQuery] = useState(''); const [reviewMode, setReviewMode] = useState('homework');
  const onlyPending = reviewMode === 'grading';
  const onlyReviewed = reviewMode === 'records';
  const [reviewingId, setReviewingId] = useState(null);
  const [batchReviewing, setBatchReviewing] = useState(false);
  const [message, setMessage] = useState('');
  async function loadTeacherRecords() {
    const classRows = await api('/classes');
    setClasses(classRows);
    const assignmentRows = await api('/assignments');
    setAssignments(assignmentRows);
    const essayGroups = await Promise.all(classRows.map((klass) => api(`/essays?classId=${klass.id}`).catch(() => [])));
    setEssays(essayGroups.flat());
  }
  async function refreshEssays() {
    if (!classes.length) return;
    const essayGroups = await Promise.all(classes.map((klass) => api(`/essays?classId=${klass.id}`).catch(() => [])));
    setEssays(essayGroups.flat());
  }
  async function triggerReview(essayId) {
    setReviewingId(essayId);
    setMessage('');
    try {
      await api(`/essays/${essayId}/review`, { method: 'POST' });
      await refreshEssays();
      setMessage('批阅完成，可在批改记录中查看。');
    } catch (err) {
      alert('批阅失败：' + err.message);
    } finally {
      setReviewingId(null);
    }
  }
  async function reviewAllPending() {
    const reviewTargets = essays.filter((essay) => (!activeAssignmentId || String(essay.assignment_id) === String(activeAssignmentId)) && essay.total_score == null);
    if (!reviewTargets.length) {
      setMessage('当前任务没有待批改作文。');
      return;
    }
    setBatchReviewing(true);
    setMessage('');
    try {
      for (const essay of reviewTargets) {
        setReviewingId(essay.id);
        await api(`/essays/${essay.id}/review`, { method: 'POST' });
      }
      await refreshEssays();
      setMessage(`批量批改完成：已处理 ${reviewTargets.length} 篇作文，可在批改记录中查看。`);
    } catch (err) {
      alert('批量批改失败：' + err.message);
    } finally {
      setReviewingId(null);
      setBatchReviewing(false);
    }
  }
  async function exportAssignment(assignment) {
    const data = await api(`/reports/assignment/${assignment.id}/docx`, { method: 'POST', body: {} });
    window.open(assetUrl(data.url), '_blank');
  }
  async function exportReviewed() {
    const classQuery = activeClassId !== 'all' ? `?classId=${activeClassId}` : '';
    const data = await api(`/reports/reviewed/docx${classQuery}`, { method: 'POST', body: {} });
    window.open(assetUrl(data.url), '_blank');
  }
  function goGrade(assignment) {
    setActiveClassId(String(assignment.class_id));
    setActiveAssignmentId(String(assignment.id));
    setReviewMode('grading');
    setMessage(`已导入“前往批改”：${assignment.class_name} · ${assignment.title}`);
  }
  useEffect(() => { loadTeacherRecords(); }, []);
  const classById = useMemo(() => new Map(classes.map((klass) => [String(klass.id), klass])), [classes]);
  const normalizedQuery = query.trim();
  const assignmentSummaries = useMemo(() => assignments
    .filter((assignment) => activeClassId === 'all' || String(assignment.class_id) === String(activeClassId))
    .map((assignment) => {
      const classInfo = classById.get(String(assignment.class_id));
      const assignmentEssays = essays.filter((essay) => String(essay.assignment_id) === String(assignment.id));
      const submittedStudents = new Set(assignmentEssays.map((essay) => essay.student_id));
      const submittedCount = assignmentEssays.length;
      const missingCount = Math.max(Number(classInfo?.student_count || 0) - submittedStudents.size, 0);
      const reviewedCount = assignmentEssays.filter((essay) => essay.total_score != null).length;
      return { ...assignment, classInfo, assignmentEssays, submittedCount, missingCount, reviewedCount };
    })
    .filter((assignment) => !normalizedQuery || `${assignment.title}${assignment.class_name}`.includes(normalizedQuery)), [assignments, activeClassId, classById, essays, normalizedQuery]);
  const filtered = essays.filter((essay) => {
    const matchesClass = activeClassId === 'all' || String(essay.class_id || classById.get(String(activeClassId))?.id) || true;
    return (!normalizedQuery || `${essay.student_name}${essay.assignment_title}${essay.title || ''}`.includes(normalizedQuery))
      && (!activeAssignmentId || String(essay.assignment_id) === String(activeAssignmentId))
      && (!onlyPending || essay.total_score == null)
      && (!onlyReviewed || essay.total_score != null)
      && matchesClass;
  });
  const reviewedEssays = essays.filter((essay) => (activeClassId === 'all' || assignments.find((assignment) => String(assignment.id) === String(essay.assignment_id) && String(assignment.class_id) === String(activeClassId))) && (!normalizedQuery || `${essay.student_name}${essay.assignment_title}${essay.title || ''}`.includes(normalizedQuery)) && essay.total_score != null);
  return <section className="teacher-records">
    <div className="records-tabs"><button className={reviewMode !== 'records' ? 'active' : ''} onClick={() => { setReviewMode('homework'); setActiveAssignmentId(''); }}>班级作业</button><button className={reviewMode === 'records' ? 'active' : ''} type="button" onClick={() => { setReviewMode('records'); setActiveAssignmentId(''); }}>批改记录</button></div>
    <div className="records-toolbar teacher-records-toolbar"><label><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={onlyReviewed ? '搜索备注名称、学生或作文' : '搜索班级或作文题目'} /></label><select value={activeClassId} onChange={(e) => { setActiveClassId(e.target.value); if (e.target.value === 'all') setActiveAssignmentId(''); }}><option value="all">全部班级</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{onlyReviewed ? <button onClick={exportReviewed} disabled={!reviewedEssays.length}><Download size={18} />批量导出</button> : onlyPending ? <button onClick={reviewAllPending} disabled={batchReviewing || !filtered.length}>{batchReviewing ? '批改中...' : '批量批改'}</button> : <button className="filter" onClick={loadTeacherRecords} title="刷新"><Filter size={18} />筛选</button>}</div>
    {message && <p className="success">{message}</p>}
    {reviewMode === 'homework' && (assignmentSummaries.length ? assignmentSummaries.map((assignment) => <article className="assignment-record homework-card" key={assignment.id}>
      <div className="record-head homework-head"><div><h3>{assignment.title}</h3><p>我布置给“{assignment.class_name}（{assignment.classInfo?.student_count || 0}人）”</p></div><MoreHorizontal size={26} /></div>
      <div className="homework-stats"><span><b>{assignment.submittedCount}</b>已提交</span><span><b>{assignment.missingCount}</b>未提交</span><span><b>{assignment.reviewedCount}</b>已批改</span></div>
      <div className="homework-actions"><time>{formatDateTime(assignment.created_at)}</time><span><button className="outline-button" onClick={() => goGrade(assignment)}><Send size={18} />前往批改</button><button onClick={() => exportAssignment(assignment)} disabled={!assignment.submittedCount}><Download size={18} />导出</button></span></div>
    </article>) : <div className="empty-records">暂无班级作业记录</div>)}
    {reviewMode === 'grading' && (filtered.length ? <article className="assignment-record">
      <div className="record-head"><div><h3>{assignments.find((assignment) => String(assignment.id) === String(activeAssignmentId))?.title || '前往批改'}</h3><p>已导入本任务的待批改作文，完成后进入批改记录查看。</p></div></div>
      {filtered.map((essay) => <div className="student-record" key={essay.id}><div><b>{essay.student_name}</b><strong>{essay.total_score ?? '--'}分</strong><p>{formatDateTime(essay.created_at)} <span>{essay.total_score == null ? '待批改' : '已自动批阅'}</span></p></div><span className="record-actions"><button className="review-btn-primary" onClick={() => triggerReview(essay.id)} disabled={reviewingId === essay.id || batchReviewing}>{reviewingId === essay.id ? '批阅中...' : essay.total_score == null ? '批改' : '重新批改'}</button><a href={`/teacher/essays/${essay.id}`}>点击查看</a></span></div>)}
    </article> : <div className="empty-records">当前任务暂无待批改作文</div>)}
    {reviewMode === 'records' && (reviewedEssays.length ? reviewedEssays.map((essay) => <article className="assignment-record review-record-card" key={essay.id}>
      <div className="record-head"><div><h3>{essay.assignment_title}</h3><p>批改进度 <span className="progress"><i style={{ width: '100%' }} /></span>100% 1/1</p></div><button onClick={() => api(`/reports/essay/${essay.id}/docx`, { method: 'POST', body: {} }).then((data) => window.open(assetUrl(data.url), '_blank'))}><Download size={18} />导出</button></div>
      <div className="student-record"><div><b>{essay.student_name}</b><strong>{essay.total_score}分</strong><p>{formatDateTime(essay.created_at)} <span>已自动批阅</span></p></div><span className="record-actions"><a href={`/teacher/essays/${essay.id}`}>点击查看</a></span></div>
    </article>) : <div className="empty-records">暂无已批改作文记录</div>)}
  </section>;
}

function TeacherInsightPanel() {
  const [classes, setClasses] = useState([]); const [classId, setClassId] = useState(''); const [data, setData] = useState(null);
  useEffect(() => { api('/classes').then((rows) => { setClasses(rows); setClassId(String(rows[0]?.id || '')); }); }, []);
  useEffect(() => { if (classId) api(`/analytics/classes/${classId}/insights`).then(setData); }, [classId]);
  async function exportExcellent(format) { const result = await api(`/reports/class/${classId}/excellent/${format}`, { method: 'POST', body: {} }); window.open(result.url, '_blank'); }
  const weaknesses = data?.thinkingWeaknesses?.length ? data.thinkingWeaknesses : [{ name: '不会分析原因', percent: 0, count: 0 }];
  return <Card title="班级思维分析" icon={<BrainCircuit size={20} />}>
    <select value={classId} onChange={(e) => setClassId(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
    <div className="stats"><span>平均 {data?.averageScore ?? '-'}</span><span>最高 {data?.maxScore ?? '-'}</span><span>最低 {data?.minScore ?? '-'}</span></div>
    <div className="thinking-teacher-panel">
      <h3>最薄弱能力</h3>
      {weaknesses.map((item) => <article key={item.name}><b>{item.percent}%</b><span>{item.name}</span><p>{item.count ? `${item.count} 次出现` : '暂无足够数据，默认关注原因分析训练'}</p></article>)}
    </div>
    <div className="thinking-ability-list">
      {(data?.thinkingAbilityAverages || []).map((item) => <span key={item.name}><b>{item.score}</b>{item.name}</span>)}
    </div>
    <div className="teacher-suggestions">
      <h3>教学建议</h3>
      {(data?.thinkingTeachingSuggestions || [{ focus: '不会分析原因', suggestion: '课堂讲评可统一训练“观点之后补为什么”，让学生在每个材料后写出因果分析句。' }]).map((item) => <p key={item.focus}><b>{item.focus}</b>{item.suggestion}</p>)}
    </div>
    <div className="teacher-suggestions">
      <h3>优文提取</h3>
      {(data?.excellentEssays || []).slice(0, 3).map((x) => <p key={x.id}>{x.student_name} · {x.total_score}分 · {x.title || '未命名作文'}</p>)}
    </div>
    <div className="actions"><button onClick={() => exportExcellent('docx')}>优文包 Word</button><button onClick={() => exportExcellent('pdf')}>优文包 PDF</button></div>
  </Card>;
}

function TeacherRerunTaskCard() {
  const [tasks, setTasks] = useState([]);
  useEffect(() => {
    api('/teacher/tasks').then((data) => setTasks(data.items || [])).catch(() => setTasks([]));
  }, []);
  const counts = tasks.reduce((acc, task) => {
    const key = String(task.status || 'unknown');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return <Card title="重新批改任务" icon={<RotateCcw size={20} />}>
    <div className="stats">
      <span><b>{counts.pending || 0}</b>待重新批改</span>
      <span><b>{counts.processing || 0}</b>正在重新批改</span>
      <span><b>{counts.completed || 0}</b>重新批改完成</span>
    </div>
    <p className="hint">状态来自教师任务中心，点击可进入筛选后的任务列表。</p>
    <div className="actions"><a className="button-link" href="/teacher/tasks">查看全部任务</a></div>
  </Card>;
}

function QuickLinks({ role }) {
  const links = role === 'student'
    ? [['/upload', '拍照上传', Camera], ['/profile', '个人档案', ChartNoAxesCombined]]
    : [['/teacher/reviews', '作文批改', FileText], ['/teacher/tasks', '重新批改任务', RotateCcw], ['/archive', 'Archive', PackageOpen], ['/classes', '我的班级', Users], ['/assignments/new', '发布任务', Plus]];
  return <Card title="快捷入口" icon={<Home size={20} />}><div className="quick">{links.map(([href, label, Icon]) => <a key={href} href={href}><Icon size={18} />{label}</a>)}</div></Card>;
}

function ArchivePage() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ search: '', className: '', month: '', title: '', sort: 'createdAt_desc' });
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');

  async function load() {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
    const data = await api(`/archive/list${query ? `?${query}` : ''}`);
    setRows(data.items || []);
  }

  useEffect(() => { load().catch(() => {}); }, []);

  async function applyFilters(e) {
    e.preventDefault();
    await load();
  }

  async function openDetail(record) {
    const detail = await api(`/archive/detail/${record.id}`);
    setSelected(detail);
  }

  async function resync(record) {
    setBusyId(record.id);
    setMessage('');
    try {
      const result = await api('/archive/save', { method: 'POST', body: { essayId: record.essayId } });
      await load();
      setMessage(result.queued ? 'NAS 暂时离线，已重新写入同步队列。' : '已重新同步到 NAS。');
    } catch (err) {
      setMessage(err.message);
    }
    setBusyId('');
  }

  async function remove(record) {
    if (!window.confirm(`确定删除归档记录“${record.essayTitle}”吗？`)) return;
    setBusyId(record.id);
    await api(`/archive/${record.id}`, { method: 'DELETE' });
    await load();
    setSelected(null);
    setBusyId('');
  }

  function downloadRecord(record) {
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${record.id || 'archive'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function downloadArchiveFile(record, fileName) {
    const session = getSession();
    const isDev = window.location.port === '5173';
    const isPrivate = /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(window.location.hostname);
    const url = `${isDev && isPrivate ? `http://${window.location.hostname}:4000/api` : '/api'}/archive/detail/${record.id}?file=${encodeURIComponent(fileName)}`;
    const response = await fetch(url, { headers: { 'x-user-id': session?.id || '' } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || '下载失败');
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(objectUrl);
  }

  return <Layout>
    <Card title="Archive" icon={<PackageOpen size={20} />}>
      <form className="archive-toolbar" onSubmit={applyFilters}>
        <label><Search size={18} /><input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="搜索班级、学生、作文标题" /></label>
        <input value={filters.className} onChange={(e) => setFilters({ ...filters, className: e.target.value })} placeholder="班级" />
        <input type="month" value={filters.month} onChange={(e) => setFilters({ ...filters, month: e.target.value })} />
        <input value={filters.title} onChange={(e) => setFilters({ ...filters, title: e.target.value })} placeholder="作文标题" />
        <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
          <option value="createdAt_desc">最新优先</option>
          <option value="student_asc">按学生</option>
          <option value="title_asc">按标题</option>
        </select>
        <button><Filter size={18} />筛选</button>
      </form>
      {message && <p className={message.includes('离线') || message.includes('失败') ? 'error' : 'success'}>{message}</p>}
      <div className="archive-grid">
        <div className="archive-list">
          {rows.map((record) => <article className="archive-row" key={record.id}>
            <div>
              <b>{record.className} · {record.studentId}_{record.studentName}</b>
              <p>{record.essayTitle} · {record.score ?? '--'}分 · {record.grade || '未评级'} · {record.archiveStatus}</p>
              <code>{record.nasPath}</code>
            </div>
            <span className="archive-actions">
              <button type="button" onClick={() => openDetail(record)}>详情</button>
              <button type="button" onClick={() => downloadArchiveFile(record, 'report.docx').catch((err) => setMessage(err.message))}><Download size={16} />Word</button>
              <button type="button" onClick={() => resync(record)} disabled={busyId === record.id}><RotateCcw size={16} />同步</button>
              <button type="button" className="danger-button" onClick={() => remove(record)} disabled={busyId === record.id}><Trash2 size={16} />删除</button>
            </span>
          </article>)}
          {!rows.length && <p className="hint">暂无归档记录。</p>}
        </div>
        {selected && <aside className="archive-detail">
          <h3>{selected.essayTitle}</h3>
          <p>{selected.className} · {selected.studentId}_{selected.studentName}</p>
          <code>{selected.nasPath}</code>
          <ul>{(selected.files || []).map((file) => <li key={file.remotePath}><span>{file.name} <button type="button" onClick={() => downloadArchiveFile(selected, file.name).catch((err) => setMessage(err.message))}>下载</button></span><code>{file.remotePath}</code></li>)}</ul>
          <button type="button" onClick={() => downloadRecord(selected)}><Download size={16} />下载归档索引</button>
        </aside>}
      </div>
    </Card>
  </Layout>;
}

function apiBaseUrl() {
  const isDev = window.location.port === '5173';
  const isPrivate = /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(window.location.hostname);
  return isDev && isPrivate ? `http://${window.location.hostname}:4000/api` : '/api';
}

async function downloadProfileReport(studentKey, format) {
  const session = getSession();
  const response = await fetch(`${apiBaseUrl()}/student-profiles/${encodeURIComponent(studentKey)}/export?format=${format}`, {
    headers: { 'x-user-id': session?.id || '' }
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || '导出失败');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${studentKey}-growth-report.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

function StudentProfilesPage() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ keyword: '', className: '', grade: '', trend: '', sortBy: 'lastUpdatedAt', sortOrder: 'desc' });
  const [total, setTotal] = useState(0);

  async function load() {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
    const data = await api(`/student-profiles${query ? `?${query}` : ''}`);
    setRows(data.items || []);
    setTotal(data.total || 0);
  }

  useEffect(() => { load().catch(() => {}); }, []);

  async function submit(e) {
    e.preventDefault();
    await load();
  }

  return <Layout>
    <Card title="学生成长档案中心" icon={<TrendingUp size={20} />}>
      <form className="archive-toolbar" onSubmit={submit}>
        <label><Search size={18} /><input value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })} placeholder="搜索姓名、学号、班级" /></label>
        <input value={filters.className} onChange={(e) => setFilters({ ...filters, className: e.target.value })} placeholder="班级" />
        <input value={filters.grade} onChange={(e) => setFilters({ ...filters, grade: e.target.value })} placeholder="年级" />
        <select value={filters.trend} onChange={(e) => setFilters({ ...filters, trend: e.target.value })}>
          <option value="">全部趋势</option>
          <option value="up">上升</option>
          <option value="stable">稳定</option>
          <option value="down">下降</option>
          <option value="insufficient_data">样本不足</option>
        </select>
        <select value={`${filters.sortBy}_${filters.sortOrder}`} onChange={(e) => {
          const [sortBy, sortOrder] = e.target.value.split('_');
          setFilters({ ...filters, sortBy, sortOrder });
        }}>
          <option value="lastUpdatedAt_desc">最近更新</option>
          <option value="averageScore_desc">平均分高</option>
          <option value="essayCount_desc">作文数量</option>
          <option value="studentName_asc">学生姓名</option>
        </select>
        <button><Filter size={18} />筛选</button>
      </form>
      <p className="hint">共 {total} 个学生档案。</p>
      <div className="profile-table">
        {rows.map((profile) => <a className="profile-row" href={`/student-profiles/${encodeURIComponent(profile.studentKey)}`} key={profile.studentKey}>
          <b>{profile.studentName || '未填写'} <span>{profile.studentId || '未填写学号'}</span></b>
          <span>{profile.className || '未填写班级'}</span>
          <span>{profile.essayCount} 篇</span>
          <span>均分 {profile.averageScore}</span>
          <span>最近 {profile.latestScore}</span>
          <span>{profile.scoreTrend}</span>
          <span>{profile.weakestAbility || '样本不足'}</span>
          <time>{formatDateTime(profile.lastUpdatedAt)}</time>
        </a>)}
        {!rows.length && <p className="hint">暂无学生成长档案。可先运行 profiles:rebuild 或等待新作文归档后自动生成。</p>}
      </div>
    </Card>
  </Layout>;
}

function StudentProfileDetailPage() {
  const { studentKey } = useParams();
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');
  useEffect(() => { api(`/student-profiles/${encodeURIComponent(studentKey)}`).then(setData).catch((err) => setMessage(err.message)); }, [studentKey]);
  if (!data) return <Layout><Card title="学生成长档案" icon={<TrendingUp size={20} />}>{message ? <p className="error">{message}</p> : <p className="hint">正在加载...</p>}</Card></Layout>;
  const profile = data.profile || {};
  const scoreRows = (data.scoreHistory?.items || []).map((item) => ({ ...item, label: String(item.createdAt || '').slice(5, 10) || item.essayTitle }));
  const abilityRows = Object.entries(data.abilityHistory?.dimensions || {}).map(([name, values]) => {
    const valid = values.map((item) => item.score).filter((value) => Number.isFinite(value));
    return { name, score: valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null };
  }).filter((item) => item.score !== null);
  async function rebuild() {
    setMessage('');
    try {
      await api(`/student-profiles/${encodeURIComponent(studentKey)}/rebuild`, { method: 'POST', body: {} });
      const next = await api(`/student-profiles/${encodeURIComponent(studentKey)}`);
      setData(next);
      setMessage('档案已重建。');
    } catch (err) {
      setMessage(err.message);
    }
  }
  return <Layout>
    <div className="profile-detail-grid">
      <Card title="学生信息" icon={<Users size={20} />}>
        <div className="stats"><span>{profile.studentName || '未填写'}</span><span>{profile.className || '未填写班级'}</span><span>{profile.essayCount || 0} 篇作文</span></div>
        <p className="hint">studentKey：{profile.studentKey}</p>
        <div className="actions"><button onClick={() => downloadProfileReport(studentKey, 'md').catch((err) => setMessage(err.message))}>导出 Markdown</button><button onClick={() => downloadProfileReport(studentKey, 'docx').catch((err) => setMessage(err.message))}>导出 Word</button><button onClick={() => downloadProfileReport(studentKey, 'pdf').catch((err) => setMessage(err.message))}>导出 PDF</button><button onClick={rebuild}><RotateCcw size={16} />重建档案</button></div>
        {message && <p className={message.includes('已') ? 'success' : 'error'}>{message}</p>}
      </Card>
      <Card title="分数趋势" icon={<ChartNoAxesCombined size={20} />}>
        {scoreRows.length > 1 ? <ResponsiveContainer width="100%" height={220}><LineChart data={scoreRows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis domain={[0, 60]} /><Tooltip /><Line type="monotone" dataKey="score" stroke="#226b5f" strokeWidth={3} /></LineChart></ResponsiveContainer> : <p className="hint">样本不足，至少 2 篇作文后显示趋势。</p>}
      </Card>
      <Card title="能力维度" icon={<BrainCircuit size={20} />}>
        <div className="ability-bars">{abilityRows.map((item) => <p key={item.name}><span>{item.name}</span><b style={{ width: `${item.score}%` }}>{item.score}</b></p>)}</div>
      </Card>
      <Card title="高频问题" icon={<Scale size={20} />}>
        {(data.issueStatistics?.issues || []).slice(0, 8).map((issue) => <article className="item" key={issue.code}><b>{issue.label}</b><p>{issue.count} 次 · 占比 {Math.round(issue.ratio * 100)}%</p></article>)}
      </Card>
      <Card title="最近作文" icon={<FileText size={20} />}>
        {(data.archiveIndex?.items || []).slice(-6).reverse().map((essay) => <article className="item" key={essay.archiveId}><b>{essay.essayTitle}</b><p>{essay.score ?? '--'}分 · {essay.level || '未评级'} · {formatDateTime(essay.createdAt)}</p></article>)}
      </Card>
      <Card title="7天训练计划" icon={<PenLine size={20} />}>
        {(data.trainingPlan?.weeklyPlan || []).map((item) => <article className="item" key={item.day}><b>第{item.day}天：{item.title}</b><p>{item.task}</p></article>)}
      </Card>
    </div>
  </Layout>;
}

function RoleRoute({ roles, children }) {
  const session = getSession();
  const location = useLocation();
  if (!session) return <Navigate to="/login" replace state={{ returnTo: `${location.pathname}${location.search || ''}` }} />;
  if (!roles.includes(session.role)) return <Navigate to={homeByRole[session.role] || '/login'} replace />;
  return children;
}

function ClassManagement() {
  const [message] = useState('');
  return <Card title="班级管理" icon={<Users size={20} />}>
    <p className="hint">默认班级管理已迁移到“教师工作台 → 班级管理 / 学生管理 / 系统测试中心”。这个旧入口保留兼容，不再展示删除按钮和冗长名单。</p>
    <div className="actions">
      <a className="button-link" href="/teacher/classes?scope=system_test">打开班级管理</a>
      <a className="button-link" href="/teacher/students?scope=system_test">打开学生管理</a>
      <a className="button-link" href="/teacher/test-center">进入系统测试中心</a>
    </div>
    {message && <p className="hint">{message}</p>}
  </Card>;
}

function ClassRosterPanel({ klass, availableClasses = [], onChanged }) {
  const [students, setStudents] = useState([]);
  const [editingStudentId, setEditingStudentId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function loadStudents() {
    setStudents(await api(`/classes/${klass.id}/students`));
  }
  useEffect(() => { loadStudents(); }, [klass.id]);
  async function removeStudent(studentId) {
    await api(`/classes/${klass.id}/students/${studentId}`, { method: 'DELETE' });
    await loadStudents();
    await onChanged();
  }
  async function pauseStudent(studentId) {
    await api(`/classes/${klass.id}/students/${studentId}/pause`, { method: 'POST', body: { reason: '教师停用成员' } });
    await loadStudents();
    await onChanged();
  }
  async function restoreStudent(studentId) {
    await api(`/classes/${klass.id}/students/${studentId}/restore`, { method: 'POST', body: { reason: '教师恢复成员' } });
    await loadStudents();
    await onChanged();
  }
  async function transferStudent(studentId) {
    const choices = (availableClasses || [])
      .filter((item) => String(item.id) !== String(klass.id))
      .map((item) => `${item.id}:${item.name}`)
      .join('，');
    const targetClassId = window.prompt(`转班到哪个班级？可选：${choices || '暂无其他班级'}。请输入班级 ID（当前班级：${klass.id}）`, '');
    if (!targetClassId) return;
    await api(`/classes/${klass.id}/students/${studentId}/transfer`, {
      method: 'POST',
      body: { targetClassId: Number(targetClassId), keepSourceMembership: false, reason: '教师转班' }
    });
    await loadStudents();
    await onChanged();
  }
  function startEditStudent(student) {
    setEditingStudentId(student.id);
    setEditingName(student.name);
    setError('');
    setMessage('');
  }
  async function saveStudentName() {
    const name = editingName.trim();
    if (!name) return setError('学生姓名不能为空');
    const updated = await api(`/classes/${klass.id}/students/${editingStudentId}`, { method: 'PATCH', body: { name } });
    await loadStudents();
    await onChanged();
    setEditingStudentId(null);
    setEditingName('');
    setMessage(`已修改 ${updated.name} 的姓名，学生端会同步显示。`);
  }
  return <section className="roster-panel">
    <div className="card-head"><div><h3>{klass.name}</h3><p>{klass.grade} · 学生 {klass.student_count || 0} 人</p></div><UserPlus size={18} /></div>
    {error && <p className="error">{error}</p>}
    {message && <p className="hint">{message}</p>}
    <ul>{students.map((student) => <li key={student.id}>
      {editingStudentId === student.id ? <>
        <input value={editingName} onChange={(e) => setEditingName(e.target.value)} aria-label="修改后的学生姓名" />
        <div className="roster-actions">
          <button onClick={saveStudentName}>保存姓名</button>
          <button type="button" onClick={() => setEditingStudentId(null)}>取消</button>
        </div>
      </> : <>
        <span>{student.name} · {student.student_no || '未填写学号'} · {student.username}</span>
        <span className="hint">状态：{student.binding_status || 'active'} · 加入：{formatDateTime(student.joined_at)}</span>
        <div className="roster-actions">
          <button type="button" onClick={() => startEditStudent(student)}>修改姓名</button>
          <button type="button" onClick={() => pauseStudent(student.id)}>停用</button>
          <button type="button" onClick={() => restoreStudent(student.id)}>恢复</button>
          <button type="button" onClick={() => transferStudent(student.id)}>转班</button>
          <button type="button" className="danger-button" onClick={() => removeStudent(student.id)}>移出班级</button>
        </div>
      </>}
    </li>)}</ul>
  </section>;
}

function AssignmentPublish() {
  const [classes, setClasses] = useState([]);
  const [form, setForm] = useState({ class_id: 1, title: '', prompt: '', requirements: '', essay_type: '材料作文', full_score: 60, grade: '', min_words: 800, max_words: 1000, scoring_standard: '内容、表达、发展等级综合评分', deadline: '', allow_resubmit: false });
  const [published, setPublished] = useState(null);
  const [publishing, setPublishing] = useState(false);
  useEffect(() => { api('/classes').then((rows) => { setClasses(rows); setForm((f) => ({ ...f, class_id: rows[0]?.id || 1 })); }); }, []);
  async function copyLink(value) {
    try {
      await navigator.clipboard.writeText(value);
      alert('提交链接已复制');
    } catch {
      window.prompt('复制学生提交链接', value);
    }
  }
  async function save() {
    if (publishing) return;
    setPublishing(true);
    try {
      const assignment = await api('/assignments', { method: 'POST', body: form });
      setPublished(assignment);
      window.dispatchEvent(new Event('assignments-changed'));
      alert('已发布');
    } finally {
      setPublishing(false);
    }
  }
  return <Card title="作文任务发布" icon={<Plus size={20} />}>
    <select value={form.class_id} onChange={(e) => setForm({ ...form, class_id: Number(e.target.value) })}>{classes.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select>
    <input placeholder="题目" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
    <textarea placeholder="作文材料" value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} rows="5" />
    <textarea placeholder="写作要求" value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })} rows="4" />
    <div className="row"><input placeholder="年级" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} /><input value={form.essay_type} onChange={(e) => setForm({ ...form, essay_type: e.target.value })} /><input type="number" value={form.full_score} onChange={(e) => setForm({ ...form, full_score: Number(e.target.value) })} /></div>
    <div className="row"><input type="number" placeholder="最低字数" value={form.min_words} onChange={(e) => setForm({ ...form, min_words: Number(e.target.value) })} /><input type="number" placeholder="最高字数" value={form.max_words} onChange={(e) => setForm({ ...form, max_words: Number(e.target.value) })} /><input type="datetime-local" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></div>
    <textarea placeholder="评分标准" value={form.scoring_standard} onChange={(e) => setForm({ ...form, scoring_standard: e.target.value })} rows="3" />
    <label className="checkbox-row"><input type="checkbox" checked={form.allow_resubmit} onChange={(e) => setForm({ ...form, allow_resubmit: e.target.checked })} />允许学生重新提交</label>
    <button onClick={save} disabled={publishing}>{publishing ? '发布中...' : '发布'}</button>
    {published && <div className="assignment-share-panel">
      <p><b>学生提交链接：</b>{published.submission_url || published.share_url}</p>
      <div className="actions">
        <button type="button" onClick={() => copyLink(published.submission_url || published.share_url)}>复制链接</button>
        <button type="button" onClick={() => api(`/assignments/${published.public_id || published.id}/share/feishu`, { method: 'POST', body: {} }).then((data) => alert(data.sent ? '已发送到飞书' : data.message || '已生成飞书分享卡片'))}>发送到飞书</button>
      </div>
      {published.qr_svg && <div className="qr-preview" dangerouslySetInnerHTML={{ __html: published.qr_svg }} />}
    </div>}
  </Card>;
}

function AssignmentManagement() {
  const [publishedAssignments, setPublishedAssignments] = useState([]);
  const [feishuInputs, setFeishuInputs] = useState({});
  const [previews, setPreviews] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function loadAssignments() {
    setPublishedAssignments(await api('/assignments'));
  }
  useEffect(() => {
    loadAssignments();
    window.addEventListener('assignments-changed', loadAssignments);
    return () => window.removeEventListener('assignments-changed', loadAssignments);
  }, []);
  async function deleteAssignment(assignment) {
    if (!window.confirm(`确定删除任务“${assignment.title}”吗？删除后学生端和学生独立界面将不再展示该任务。`)) return;
    setError('');
    try {
      await api(`/assignments/${assignment.id}`, { method: 'DELETE' });
      await loadAssignments();
      window.dispatchEvent(new Event('assignments-changed'));
      setMessage(`已删除任务：${assignment.title}`);
    } catch (err) {
      setError(err.message);
    }
  }
  async function showStatus(assignment) {
    setError('');
    try {
      const data = await api(`/assignments/${assignment.public_id || assignment.id}/status`);
      const names = data.missing.map((item) => `${item.student_no || '无学号'} ${item.student_name}`).join('\n') || '无';
      window.alert(`已交 ${data.assignment.submitted_count} 人，未交 ${data.assignment.missing_count} 人\n\n未交名单：\n${names}`);
    } catch (err) {
      setError(err.message);
    }
  }
  function updateFeishuInput(assignmentId, patch) {
    setFeishuInputs((current) => ({ ...current, [assignmentId]: { ...(current[assignmentId] || {}), ...patch } }));
  }
  async function bindClassGroup(assignment) {
    const input = feishuInputs[assignment.id] || {};
    if (!input.chatId?.trim()) return setError('请先填写飞书班级群 chatId');
    const row = await api(`/classes/${assignment.class_id}/feishu-binding`, {
      method: 'POST',
      body: { feishuChatId: input.chatId.trim(), feishuChatName: input.chatName || `${assignment.class_name || '班级'}作文群` }
    });
    setMessage(`已绑定飞书班级群：${row.feishu_chat_name || row.feishu_chat_id}`);
  }
  async function previewFeishuCard(assignment) {
    const data = await api(`/assignments/${assignment.public_id || assignment.id}/share/feishu/preview`);
    setPreviews((current) => ({ ...current, [assignment.id]: data.card }));
    setMessage('已生成飞书消息卡片预览');
  }
  async function sendFeishuCard(assignment) {
    const input = feishuInputs[assignment.id] || {};
    const data = await api(`/assignments/${assignment.public_id || assignment.id}/share/feishu`, {
      method: 'POST',
      body: input.chatId ? { chatId: input.chatId.trim() } : {}
    });
    setMessage(data.sent ? '已发送到飞书群' : data.message || '已生成飞书分享卡片');
  }
  async function revokeFeishuCard(assignment) {
    const data = await api(`/assignments/${assignment.public_id || assignment.id}/share/feishu/revoke`, { method: 'POST', body: {} });
    setMessage(data.message || '已处理撤回请求');
  }
  async function remindMissing(assignment) {
    const data = await api(`/assignments/${assignment.public_id || assignment.id}/remind-missing`, { method: 'POST', body: {} });
    setMessage(`未交提醒完成：已发送 ${data.sent || 0} 人，跳过 ${data.skipped || 0} 人`);
  }
  return <Card title="发布任务管理" icon={<BookOpen size={20} />}>
    {error && <p className="error">{error}</p>}
    {message && <p className="hint">{message}</p>}
    <div className="published-assignment-list">
      {publishedAssignments.map((assignment) => <article className="item published-assignment-item" key={assignment.id}>
        <div>
          <b>{assignment.title}</b>
          <p>{assignment.class_name || '未指定班级'} · {assignment.essay_type} · 满分 {assignment.full_score} · 发布时间 {formatDateTime(assignment.created_at)}</p>
          {assignment.deadline && <p>截止时间 {formatDateTime(assignment.deadline)}</p>}
          <p>提交进度：已交 {assignment.submitted_count || 0} 人 · 未交 {assignment.missing_count || 0} 人</p>
          {assignment.submission_url && <p className="assignment-link">{assignment.submission_url}</p>}
        </div>
        <div className="roster-actions">
          <button type="button" onClick={() => showStatus(assignment)}>查看提交状态</button>
          <button type="button" onClick={() => window.open(`/class/${assignment.class_id}/essays`, '_self')}>查看报告</button>
          <button type="button" className="danger-button" onClick={() => deleteAssignment(assignment)}>删除任务</button>
        </div>
        <div className="assignment-share-panel">
          <h4>飞书作业发布</h4>
          <div className="row">
            <input placeholder="选择飞书班级群 chatId" value={feishuInputs[assignment.id]?.chatId || assignment.feishu_chat_id || ''} onChange={(e) => updateFeishuInput(assignment.id, { chatId: e.target.value })} />
            <input placeholder="飞书班级群名称" value={feishuInputs[assignment.id]?.chatName || ''} onChange={(e) => updateFeishuInput(assignment.id, { chatName: e.target.value })} />
          </div>
          <div className="actions">
            <button type="button" onClick={() => bindClassGroup(assignment)}>绑定班级群</button>
            <button type="button" onClick={() => previewFeishuCard(assignment)}>预览消息卡片</button>
            <button type="button" onClick={() => sendFeishuCard(assignment)}>发送到飞书</button>
            <button type="button" onClick={() => revokeFeishuCard(assignment)}>撤回或重新发布</button>
            <button type="button" onClick={() => remindMissing(assignment)}>提醒未提交学生</button>
          </div>
          {previews[assignment.id] && <pre className="card-preview">{JSON.stringify(previews[assignment.id], null, 2)}</pre>}
        </div>
      </article>)}
      {!publishedAssignments.length && <p className="hint">暂无已发布任务。</p>}
    </div>
  </Card>;
}

function EssayList() {
  const { classId } = useParams();
  const [rows, setRows] = useState([]);
  useEffect(() => { api(`/essays?classId=${classId}`).then(setRows); }, [classId]);
  return <Layout><Card title="班级作文列表" icon={<FileText size={20} />}>{rows.map((x) => <article className="item" key={x.id}><b>{x.student_name} · {x.assignment_title}</b><p>{x.total_score || '-'}分 · {x.level || '待批改'}</p><a href={`/teacher/essays/${x.id}`}>进入详情</a></article>)}</Card></Layout>;
}

function AnalyticsPage() {
  const { classId } = useParams();
  const [data, setData] = useState(null);
  useEffect(() => { api(`/analytics/classes/${classId}`).then(setData); }, [classId]);
  return <Layout><div className="grid">
    <Card title="班级数据分析" icon={<ChartNoAxesCombined size={20} />}><div className="stats"><span>平均 {data?.averageScore}</span><span>最高 {data?.maxScore}</span><span>最低 {data?.minScore}</span></div></Card>
    <ReviewBlock title="未提交名单" items={data?.missingStudents || []} />
    <ReviewBlock title="常见写作问题" items={(data?.commonProblems || []).map((x) => `${x.name}（${x.count}次）`)} />
    <ExportButtons classId={classId} />
  </div></Layout>;
}

function AdminFeishuTeachersPage() {
  const [data, setData] = useState({ teachers: [], logs: [] });
  const [keyword, setKeyword] = useState('');
  const [message, setMessage] = useState('');
  const [createdCode, setCreatedCode] = useState(null);

  async function load() {
    const query = keyword ? `?keyword=${encodeURIComponent(keyword)}` : '';
    setData(await api(`/admin/feishu/teachers${query}`));
  }

  useEffect(() => { load().catch((err) => setMessage(err.message)); }, []);

  async function createCode(teacher) {
    if (!window.confirm(`为 ${teacher.teacher_name} 创建一次性飞书教师绑定码？绑定码只显示一次。`)) return;
    const result = await api(`/admin/feishu/teachers/${teacher.teacher_id}/binding-code`, { method: 'POST', body: {} });
    setCreatedCode({ teacherName: teacher.teacher_name, ...result });
    await load();
  }

  async function updateBinding(bindingId, action) {
    const label = { disable: '停用', restore: '恢复', unbind: '解绑' }[action] || action;
    if (!window.confirm(`确认${label}该飞书教师绑定？`)) return;
    await api(`/admin/feishu/teacher-bindings/${bindingId}/${action}`, { method: 'POST', body: {} });
    setMessage(`已${label}教师绑定。`);
    await load();
  }

  return <Layout><Card title="飞书教师绑定管理" icon={<MessageCircle size={20} />}>
    <form className="archive-toolbar" onSubmit={(e) => { e.preventDefault(); load(); }}>
      <label><Search size={18} /><input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索教师姓名或账号" /></label>
      <button><Filter size={18} />查询</button>
    </form>
    {message && <p className="hint">{message}</p>}
    {createdCode && <div className="success">
      <p><b>{createdCode.teacherName}</b> 的一次性绑定码：</p>
      <p className="assignment-link">{createdCode.code}</p>
      <p>有效期至：{formatDateTime(createdCode.expiresAt)}。该明文只显示一次，后续无法查看，只能重新生成。</p>
      <button type="button" onClick={() => navigator.clipboard?.writeText(createdCode.code)}>复制绑定码</button>
    </div>}
    <div className="management-table">
      {data.teachers.map((teacher) => <article className="management-row" key={`${teacher.teacher_id}-${teacher.binding_id || 'none'}`}>
        <b>{teacher.teacher_name}<span>{teacher.username} · {teacher.title || '教师'}</span></b>
        <span>负责班级 {teacher.class_count || 0} 个</span>
        <span>绑定状态：{teacher.status || '未绑定'}</span>
        <span>绑定时间：{teacher.verified_at ? formatDateTime(teacher.verified_at) : '未绑定'}</span>
        <span className="record-actions">
          <button type="button" onClick={() => createCode(teacher)}>创建绑定码</button>
          {teacher.binding_id && teacher.status !== 'disabled' && <button type="button" onClick={() => updateBinding(teacher.binding_id, 'disable')}>停用</button>}
          {teacher.binding_id && teacher.status === 'disabled' && <button type="button" onClick={() => updateBinding(teacher.binding_id, 'restore')}>恢复</button>}
          {teacher.binding_id && <button type="button" className="danger-button" onClick={() => updateBinding(teacher.binding_id, 'unbind')}>解绑</button>}
        </span>
      </article>)}
    </div>
    <h3 style={{ marginTop: 16 }}>最近操作日志</h3>
    <div className="management-table">
      {data.logs.map((log) => <article className="management-row" key={log.id}><b>{log.action}<span>{log.resource_type}:{log.resource_id}</span></b><span>{log.status}</span><span>{log.error_code || '无错误'}</span><span>{formatDateTime(log.created_at)}</span></article>)}
    </div>
  </Card></Layout>;
}

function TeacherFeishuClassesPage() {
  const [data, setData] = useState({ rows: [], permissions: {} });
  const [inputs, setInputs] = useState({});
  const [message, setMessage] = useState('');

  async function load() {
    setData(await api('/teacher/feishu/classes'));
  }
  useEffect(() => { load().catch((err) => setMessage(err.message)); }, []);

  function updateInput(classId, patch) {
    setInputs((current) => ({ ...current, [classId]: { ...(current[classId] || {}), ...patch } }));
  }

  async function bindGroup(row, isPrimary = true) {
    const input = inputs[row.id] || {};
    if (!input.chatId?.trim()) return setMessage('请填写飞书群 chatId，或在飞书开放平台补齐群列表权限后选择群聊。');
    await api(`/teacher/feishu/classes/${row.id}/bind`, {
      method: 'POST',
      body: {
        feishuChatId: input.chatId.trim(),
        feishuChatName: input.chatName || row.name,
        tenantKey: input.tenantKey || '',
        isPrimary
      }
    });
    setMessage('班级飞书群绑定已保存。');
    await load();
  }

  async function unbind(row) {
    if (!row.binding_id) return;
    if (!window.confirm(`解除 ${row.name} 的飞书群绑定？`)) return;
    await api(`/teacher/feishu/classes/${row.id}/unbind`, { method: 'POST', body: { bindingId: row.binding_id } });
    setMessage('已解除班级飞书群绑定。');
    await load();
  }

  async function testMessage(row) {
    if (!row.binding_id) return setMessage('请先绑定飞书群。');
    const result = await api(`/teacher/feishu/classes/${row.id}/test-message`, { method: 'POST', body: { bindingId: row.binding_id } });
    setMessage(result.ok ? '系统测试消息已发送。' : `测试消息未发送：${result.reason || '飞书权限或配置不足'}`);
    await load();
  }

  return <Layout><Card title="班级飞书群绑定" icon={<MessageCircle size={20} />}>
    {message && <p className="hint">{message}</p>}
    {!data.permissions?.canListChats && <div className="warning">
      <p>当前飞书应用暂未确认具备群列表读取权限，页面提供手动 chatId 绑定备用方式。</p>
      <p>需要权限：{(data.permissions?.missingPermissions || []).join('、') || 'im:chat:readonly / im:message:send_as_bot'}</p>
      <p>如新增权限，通常需要在飞书开放平台重新发布应用版本。</p>
    </div>}
    <div className="management-table">
      {data.rows.map((row) => <article className="management-row" key={`${row.id}-${row.binding_id || 'none'}`}>
        <b>{row.name}<span>{row.grade || '未填写年级'} · {row.binding_status || '未绑定'}</span></b>
        <span>主群：{row.is_primary ? '是' : '否'}</span>
        <span>群名：{row.feishu_chat_name || '未绑定'}</span>
        <span>chatId：{row.feishu_chat_id_masked || '未绑定'}</span>
        <span>最近测试：{row.last_tested_at ? `${formatDateTime(row.last_tested_at)} ${row.last_test_status || ''}` : '未测试'}</span>
        <div className="assignment-share-panel">
          <div className="row">
            <input placeholder="飞书群 chatId" value={inputs[row.id]?.chatId || ''} onChange={(e) => updateInput(row.id, { chatId: e.target.value })} />
            <input placeholder="飞书群名称" value={inputs[row.id]?.chatName || ''} onChange={(e) => updateInput(row.id, { chatName: e.target.value })} />
          </div>
          <div className="actions">
            <button type="button" onClick={() => bindGroup(row, true)}>绑定主群</button>
            <button type="button" onClick={() => bindGroup(row, false)}>设置备用群</button>
            <button type="button" onClick={() => testMessage(row)}>测试发送</button>
            {row.binding_id && <button type="button" className="danger-button" onClick={() => unbind(row)}>解除绑定</button>}
          </div>
        </div>
      </article>)}
      {!data.rows.length && <p className="hint">暂无可管理班级。</p>}
    </div>
  </Card></Layout>;
}

function AdminHome() {
  const [system, setSystem] = useState(null);
  const [ai, setAi] = useState(null);
  const [storage, setStorage] = useState(null);
  const [feishu, setFeishu] = useState(null);
  const [publicAccess, setPublicAccess] = useState(null);
  useEffect(() => {
    api('/system/status').then(setSystem).catch(() => {});
    api('/admin/ai/status').then(setAi).catch(() => {});
    api('/admin/storage/zspace/status').then(setStorage).catch(() => {});
    api('/feishu/health').then(setFeishu).catch(() => {});
    api('/public-access').then(setPublicAccess).catch(() => {});
  }, []);
  return <Layout><div className="grid">
    <Card title="系统配置" icon={<PackageOpen size={20} />}>
      <p>公网入口：{publicAccess?.publicOrigin || 'https://pi.zhenwanyue.icu'}</p>
      <p>本地服务：{system?.localUrl || 'http://127.0.0.1:4000'}</p>
      <p>生产状态：{system?.status || (system?.ok ? 'healthy' : 'checking')}</p>
    </Card>
    <Card title="模型配置" icon={<BrainCircuit size={20} />}>
      <p>Provider：{ai?.primaryProvider || 'deepseek'}</p>
      <p>Ready：{String(ai?.ready ?? false)}</p>
      <p>Degraded：{String(ai?.degraded ?? false)}</p>
    </Card>
    <Card title="WebDAV 状态" icon={<PackageOpen size={20} />}>
      <p>Enabled：{String(storage?.enabled ?? false)}</p>
      <p>Connected：{String(storage?.connected ?? false)}</p>
      <p>Writable：{String(storage?.writable ?? false)}</p>
    </Card>
    <Card title="飞书配置" icon={<MessageCircle size={20} />}>
      <p>App configured：{String(feishu?.appConfigured ?? false)}</p>
      <p>Webhook：{String(feishu?.webhookConfigured ?? false)}</p>
      <p>Connected：{String(feishu?.connected ?? false)}</p>
      <div className="actions"><a className="button-link" href="/admin/feishu/teachers">教师绑定管理</a></div>
    </Card>
    <Card title="Cloudflare 状态" icon={<Share2 size={20} />}>
      <p>公网域名：{publicAccess?.publicUrl || publicAccess?.publicOrigin || 'https://pi.zhenwanyue.icu'}</p>
      <p>隧道状态：{publicAccess?.tunnelStatus || '由 prod:status 检查'}</p>
    </Card>
    <Card title="日志与健康检查" icon={<FileText size={20} />}>
      <p>管理员端只负责系统级配置、账号权限、模型、存储、飞书、Cloudflare、WebDAV 与日志健康检查。</p>
      <a href="/api/system/logs" target="_blank" rel="noreferrer">查看系统日志摘要</a>
      <div className="actions"><a className="button-link" href="/admin/integrations">进入集成状态</a></div>
    </Card>
  </div></Layout>;
}

function App() {
  return <BrowserRouter><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/student-mobile" element={<Navigate to="/student-mobile/home" replace />} />
    <Route path="/student-mobile/login" element={<StudentMobileLoginPage />} />
    <Route path="/student-mobile/join" element={<StudentMobileJoinPage />} />
    <Route path="/student-mobile/join/code" element={<StudentMobileJoinCodePage />} />
    <Route path="/student-mobile/join/status" element={<StudentMobileJoinStatusPage />} />
    <Route path="/student-mobile/home" element={<RoleRoute roles={['student']}><StudentMobileHomePage /></RoleRoute>} />
    <Route path="/student-mobile/tasks" element={<RoleRoute roles={['student']}><StudentMobileTasksPage /></RoleRoute>} />
    <Route path="/student-mobile/tasks/:assignmentId" element={<RoleRoute roles={['student']}><StudentMobileTasksPage /></RoleRoute>} />
    <Route path="/student-mobile/profile" element={<RoleRoute roles={['student']}><StudentMobileProfilePage /></RoleRoute>} />
    <Route path="/student" element={<RoleRoute roles={['student']}><StudentHome /></RoleRoute>} />
    <Route path="/student/workspace/:studentId" element={<RoleRoute roles={['student']}><StudentWorkspacePage /></RoleRoute>} />
    <Route path="/student/essays/:essayId/report" element={<RoleRoute roles={['student']}><StudentEssayReportPage /></RoleRoute>} />
    <Route path="/upload" element={<RoleRoute roles={['student']}><UploadPage /></RoleRoute>} />
    <Route path="/submit/:assignmentId" element={<RoleRoute roles={['student']}><SubmitPage /></RoleRoute>} />
    <Route path="/review/:essayId" element={<RoleRoute roles={['student', 'teacher']}><LegacyReviewRoute /></RoleRoute>} />
    <Route path="/profile" element={<RoleRoute roles={['student']}><StudentProfile /></RoleRoute>} />
    <Route path="/teacher" element={<RoleRoute roles={['teacher']}><TeacherHome /></RoleRoute>} />
    <Route path="/teacher/classes" element={<RoleRoute roles={['teacher']}><TeacherClassesPage /></RoleRoute>} />
    <Route path="/teacher/classes/:classKey" element={<RoleRoute roles={['teacher']}><TeacherLifecycleClassPage /></RoleRoute>} />
    <Route path="/teacher/classes/:classKey/join-requests" element={<RoleRoute roles={['teacher']}><TeacherLifecycleClassPage /></RoleRoute>} />
    <Route path="/teacher/classes/:classKey/members" element={<RoleRoute roles={['teacher']}><TeacherLifecycleClassPage /></RoleRoute>} />
    <Route path="/teacher/students" element={<RoleRoute roles={['teacher']}><TeacherStudentsPage /></RoleRoute>} />
    <Route path="/teacher/test-center" element={<RoleRoute roles={['teacher']}><TeacherTestCenterPage /></RoleRoute>} />
    <Route path="/teacher/essays" element={<RoleRoute roles={['teacher']}><TeacherEssaysPage /></RoleRoute>} />
    <Route path="/teacher/tasks" element={<RoleRoute roles={['teacher']}><TeacherTasksPage /></RoleRoute>} />
    <Route path="/teacher/benchmark" element={<RoleRoute roles={['teacher']}><BenchmarkCenterPage /></RoleRoute>} />
    <Route path="/teacher/essay/:essayId" element={<RoleRoute roles={['teacher']}><TeacherEssayDetailPage /></RoleRoute>} />
    <Route path="/teacher/essays/:essayId" element={<RoleRoute roles={['teacher']}><TeacherEssayDetailPage /></RoleRoute>} />
    <Route path="/teacher/essays/:essayId/report/:reportId" element={<RoleRoute roles={['teacher']}><TeacherEssayDetailPage /></RoleRoute>} />
    <Route path="/admin" element={<RoleRoute roles={['admin']}><AdminHome /></RoleRoute>} />
    <Route path="/admin/integrations" element={<RoleRoute roles={['admin']}><AdminIntegrationsPage /></RoleRoute>} />
    <Route path="/admin/feishu/teachers" element={<RoleRoute roles={['admin']}><AdminFeishuTeachersPage /></RoleRoute>} />
    <Route path="/teacher/feishu/classes" element={<RoleRoute roles={['teacher']}><TeacherFeishuClassesPage /></RoleRoute>} />
    <Route path="/teacher/reviews" element={<RoleRoute roles={['teacher']}><Layout><TeacherReviewCenter /></Layout></RoleRoute>} />
    <Route path="/archive" element={<RoleRoute roles={['teacher']}><ArchivePage /></RoleRoute>} />
    <Route path="/student-profiles" element={<RoleRoute roles={['student', 'teacher']}><StudentProfilesPage /></RoleRoute>} />
    <Route path="/student-profiles/:studentKey" element={<RoleRoute roles={['student', 'teacher']}><StudentProfileDetailPage /></RoleRoute>} />
    <Route path="/classes" element={<RoleRoute roles={['teacher']}><Layout><ClassManagement /></Layout></RoleRoute>} />
    <Route path="/assignments/new" element={<RoleRoute roles={['teacher']}><Layout><AssignmentPublish /></Layout></RoleRoute>} />
    <Route path="/class/:classId/essays" element={<RoleRoute roles={['teacher']}><EssayList /></RoleRoute>} />
    <Route path="/essay/:essayId" element={<RoleRoute roles={['teacher']}><TeacherEssayDetailPage /></RoleRoute>} />
    <Route path="/class/:classId/analytics" element={<RoleRoute roles={['teacher']}><AnalyticsPage /></RoleRoute>} />
    <Route path="/student/:studentId/profile" element={<RoleRoute roles={['teacher']}><StudentProfile /></RoleRoute>} />
    <Route path="*" element={<RoleRoute roles={['student', 'teacher', 'admin']}><Navigate to={homeByRole[getSession()?.role] || '/login'} replace /></RoleRoute>} />
  </Routes></BrowserRouter>;
}

createRoot(document.getElementById('root')).render(<App />);

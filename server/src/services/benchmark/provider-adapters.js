import { reviewEssay } from '../openai.js';

function mockReport(dataset = {}, provider = 'mock') {
  const title = dataset.title || '未命名作文';
  return {
    title,
    provider,
    model: `${provider}-benchmark`,
    overall: `这是一份针对《${title}》的 Benchmark 批改报告。报告从等级原因、核心优点、真实短板和后续训练四个层面展开，重点检查是否具备高中语文教师可直接使用的指导价值。`,
    topicIntentAnalysis: '审题立意能够围绕材料关键词展开，重点评估中心判断是否准确、是否存在偏题风险，以及价值判断是否具备现实意义与思辨深度。',
    structureAnalysis: '结构分析覆盖开头、主体、分论点、材料安排、层次推进、过渡照应和结尾升华，指出段落之间是否形成递进关系。',
    logicAnalysis: '逻辑分析重点检查观点、论据和论证之间的关系，评估概念界定、因果链条、材料与观点的一致性，以及是否存在推理跳跃或论证漏洞。',
    languageAnalysis: '语言分析覆盖语言风格、句式节奏、修辞意识、书面表达、口语化问题和高级表达替换方向。',
    materialAnalysis: '素材分析判断材料是否典型、新颖、真实、丰富、贴题，并给出可替换的素材方向。',
    argumentAnalysis: '论证分析要求材料后必须有解释、分析和回扣，避免只有例子没有证明。',
    teacherComment: '从重点高中语文教师角度看，这篇作文已经具备基本立意，但要真正提升等级，需要把宏大表态转化为可证明的判断，把材料转化为论据，把结尾转化为思想提升。',
    revisionSuggestions: ['逐段补齐“观点-解释-材料-分析-回扣”链条', '把抽象口号改成可论证判断', '材料后补写因果分析句'],
    growthSuggestions: ['审题关键词关系训练', '论证链补全训练', '素材迁移训练', '语言升格训练'],
    score: 48,
    level: '二类文',
    latencyMs: 1,
    tokenUsage: { promptTokens: 1200, completionTokens: 1800, totalTokens: 3000 },
    cost: 0
  };
}

class BenchmarkProviderAdapter {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
  }

  getProviderName() {
    return this.name;
  }

  isConfigured() {
    return Boolean(this.options.enabled);
  }

  async gradeEssay() {
    throw new Error(`${this.name} Provider 尚未实现`);
  }
}

class MockProvider extends BenchmarkProviderAdapter {
  constructor(options = {}) {
    super('mock', { enabled: true, ...options });
  }

  async gradeEssay({ dataset }) {
    const startedAt = Date.now();
    const wait = Number(this.options.latencyMs || 0);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const report = mockReport(dataset, 'mock');
    report.latencyMs = Date.now() - startedAt;
    return { provider: 'mock', model: 'mock-benchmark', report, latencyMs: report.latencyMs, tokenUsage: report.tokenUsage, cost: 0 };
  }
}

class DeepSeekProvider extends BenchmarkProviderAdapter {
  constructor(options = {}) {
    super('deepseek', options);
  }

  isConfigured() {
    return Boolean(this.options.enabled || process.env.DEEPSEEK_API_KEY);
  }

  async gradeEssay({ dataset }) {
    const startedAt = Date.now();
    const review = await reviewEssay({
      assignment: { title: dataset.title, prompt: dataset.title, full_score: 60 },
      essayText: dataset.originalEssay
    });
    return {
      provider: 'deepseek',
      model: review?.ai_meta?.model || process.env.DEEPSEEK_MODEL || 'deepseek',
      report: {
        title: dataset.title,
        provider: 'deepseek',
        model: review?.ai_meta?.model || process.env.DEEPSEEK_MODEL || 'deepseek',
        ...review
      },
      latencyMs: Date.now() - startedAt,
      tokenUsage: review?.ai_meta?.tokenUsage || null,
      cost: review?.ai_meta?.cost || 0
    };
  }
}

class DisabledProvider extends BenchmarkProviderAdapter {
  isConfigured() {
    return Boolean(this.options.enabled);
  }

  async gradeEssay({ dataset }) {
    if (this.options.customGradeEssay) return this.options.customGradeEssay({ dataset, provider: this.name });
    throw new Error(`${this.name} Provider 未配置，Benchmark 已跳过真实调用`);
  }
}

export function listProviderAdapters() {
  return ['mock', 'deepseek', 'openai', 'gemini', 'custom'];
}

export function createProviderAdapter(name = 'mock', options = {}) {
  const provider = String(name || 'mock').toLowerCase();
  if (provider === 'mock') return new MockProvider(options);
  if (provider === 'deepseek') return new DeepSeekProvider(options);
  return new DisabledProvider(provider, options);
}

export { mockReport };

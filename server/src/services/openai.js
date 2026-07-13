import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildReviewPrompt, ocrPrompt } from './prompt.js';
import { getAIConfig, validateProviderConfig } from '../config/ai-config.js';
import { createAIRouter } from './ai/ai-router.js';
import {
  AIServiceError,
  classifyAIError,
  getAIProviderStatus,
  redactAIText
} from './ai/client-factory.js';

const localOcrScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'local-ocr.swift');

function normalizeProvider(value) {
  return String(value || '').trim().toLowerCase();
}

function hasApiKey(value) {
  return Boolean(String(value || '').trim());
}

function safeAiErrorMessage(error) {
  return String(error?.message || error || 'AI 服务异常')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
    .replace(/your-[A-Za-z0-9_*.-]+-key/gi, '***key')
    .slice(0, 500);
}

export function getTextProvider() {
  const config = getAIConfig();
  return normalizeProvider(config.routes.general || config.primaryProvider || 'openai');
}

function isProviderReady(provider = getTextProvider()) {
  return validateProviderConfig(provider).ok;
}

export function getAiStatus() {
  const config = getAIConfig();
  const openai = validateProviderConfig('openai', config);
  const deepseek = validateProviderConfig('deepseek', config);
  return {
    provider: config.primaryProvider,
    textReady: openai.ok || deepseek.ok,
    openaiReady: config.providers.openai.enabled && openai.ok,
    deepseekReady: config.providers.deepseek.enabled && deepseek.ok,
    model: config.providers[config.primaryProvider]?.model || '',
    envFile: config.envFile,
    routerEnabled: config.routerEnabled,
    fallbackProvider: config.fallbackProvider,
    fallbackEnabled: config.fallbackEnabled
  };
}

function shouldFallbackFromDeepSeek(error) {
  const message = String(error?.message || '');
  return /DeepSeek API 调用失败：(401|403)|authentication_error|Authentication Fails|invalid api key/i.test(message);
}

function isRecoverableAiError(error) {
  const message = String(error?.message || error || '');
  return /(OpenAI|DeepSeek) API 调用失败：(401|403|429)|authentication_error|Authentication Fails|invalid[_ ]api[_ ]key|Incorrect API key|insufficient_quota|quota|rate_limit|ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|network/i.test(message);
}

async function callOpenAI(input) {
  const validation = validateProviderConfig('openai');
  if (!validation.ok) return null;
  const router = createAIRouter();
  const result = await router.executeWithFallback('ocr_cleanup', {
    messages: input,
    allowedProviders: ['openai'],
    fallbackEnabled: false
  });
  return result.text;
}

async function callDeepSeek(prompt, options = {}) {
  const router = createAIRouter();
  const result = await router.executeWithFallback(options.taskType || 'general', {
    prompt,
    jsonMode: Boolean(options.jsonMode),
    allowedProviders: ['deepseek'],
    fallbackEnabled: false
  });
  return result.text;
}

export async function callTextModel(prompt, options = {}) {
  const router = createAIRouter();
  const result = await router.executeWithFallback(options.taskType || 'general', {
    prompt,
    jsonMode: Boolean(options.jsonMode),
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    allowedProviders: options.allowedProviders,
    fallbackEnabled: options.fallbackEnabled
  });
  return result.text;
}

export async function callTextTask(taskType, prompt, options = {}) {
  const router = createAIRouter();
  return router.executeWithFallback(taskType || 'general', {
    prompt,
    jsonMode: Boolean(options.jsonMode),
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    allowedProviders: options.allowedProviders,
    fallbackEnabled: options.fallbackEnabled
  });
}

function mockReview(fullScore = 60) {
  const overallEvaluation = '这篇作文能够把青年成长放到时代背景中思考，基本方向是准确的，因此可进入二类文区间。但文章的主要问题并不只是材料少或句子不够漂亮，而是中心判断仍偏口号化，主体段没有把“个人选择”与“时代责任”之间的逻辑关系说透。优点在于立意积极、表达顺畅，短板在于论证链不够完整，材料后的分析没有承担证明观点的任务。';
  const topicIntentAnalysis = '从审题看，文章能抓住“青年”“个人选择”“时代责任”等关键词，没有明显跑题。问题在于对关键词之间关系的辨析还不够：个人选择不是单纯选择职业或兴趣，时代责任也不是一句宏大的口号，二者之间应当形成“个体在时代需要中确认方向，并用持续行动回应公共责任”的论证关系。若能进一步讨论个人价值与社会需要如何互相成就，文章的思想深度会明显提升。';
  const structureAnalysis = '结构上，文章已有开头、主体和结尾的基本框架，但层次推进不够鲜明。开头能引出青年与时代主题，却缺少一个可以统领全文的中心判断。主体部分更像并列谈奋斗、责任和行动，段落之间缺少由概念界定到原因分析再到实践路径的递进。结尾能够回扣主题，但提升力度不足，建议用“辨认方向、承担责任、落实行动”重组主体段，使文章层次更清楚。';
  const logicAnalysis = '逻辑上的核心问题是观点、材料和分析之间没有形成稳定的论证链。文章能提出青年应承担时代责任，也能举出相关材料，但常常在材料之后直接得出结论，中间缺少“为什么这个材料能够证明观点”的分析句。高考议论文需要完成“观点-解释-材料-分析-回扣”的闭环，尤其要避免把相关材料误当成有效论据。修改时应先界定“责任”的内涵，再说明青年选择为什么不能只服务个人成功，最后回到时代问题对青年能力和担当的要求。';
  const languageAnalysis = '语言整体通顺，有一定书面表达意识，但部分句子仍偏口号化，如“青年要努力奋斗”这类表达信息量不足，不能支撑高分作文的思辨要求。建议增加概念辨析句、因果分析句和价值提升句，减少反复出现的“奋斗、责任、时代”等抽象词堆叠。可以多使用对照句和递进句，例如“不只是姿态上的昂扬，更是把个人理想嵌入时代坐标的清醒选择”，让语言同时承担表达和论证功能。';
  const materialAnalysis = '素材基本贴题，但典型性和分析深度仍可加强。文章不宜只罗列青年奋斗故事，而要选择能体现个人选择与时代需要相互成就的材料，并在材料后解释人物选择背后的价值逻辑。若材料过于常见，要用新的分析角度使其变得有效；若材料与分论点只是主题相关而非证明关系，就需要替换或重写。';
  return {
    total_score: Math.round(fullScore * 0.78),
    level: '二类文',
    overall_evaluation: overallEvaluation,
    topic_intent_analysis: topicIntentAnalysis,
    structure_analysis: structureAnalysis,
    logic_analysis: logicAnalysis,
    language_analysis: languageAnalysis,
    material_analysis: materialAnalysis,
    recommended_materials: [
      { title: '钱学森归国', summary: '科学家放弃海外优厚条件回国参与新中国建设。', reason: '能证明个人专业选择与国家时代需要之间的结合。', usage: '可用于论证“个人理想应回应时代召唤”。' },
      { title: '黄文秀返乡扶贫', summary: '青年干部回到基层，用实际行动承担乡村振兴责任。', reason: '比空泛奋斗更具体，能体现责任落地。', usage: '可用于论证“时代责任必须落实到具体行动”。' },
      { title: '中国航天青年团队', summary: '青年科研人员参与重大工程，在协作中完成时代任务。', reason: '能体现个人能力成长与国家工程之间的关系。', usage: '可用于论证“青年价值在时代工程中被检验”。' }
    ],
    gaokao_scoring: {
      content: { score: 16, full: 20, comment: '切题，中心明确，但思想深度和材料分析不足。' },
      expression: { score: 16, full: 20, comment: '语言通顺，结构完整，部分表达口号化。' },
      development: { score: 15, full: 20, comment: '有一定深度，创新性和文采仍可提升。' },
      total_score: Math.round(fullScore * 0.78),
      level: '二类文',
      deductions: ['材料后分析不足', '分论点递进关系不够鲜明', '语言表达有口号化倾向']
    },
    dimension_scores: [
      { name: '审题立意', score: 8, full: 10, comment: '能扣住材料核心，但立意还可进一步深化。' },
      { name: '内容充实度', score: 8, full: 10, comment: '观点明确，有事例支撑，材料层次可再丰富。' },
      { name: '结构层次', score: 7, full: 10, comment: '基本具备提出问题、分析问题、解决问题的结构。' },
      { name: '论证逻辑', score: 7, full: 10, comment: '论证链条较清楚，部分段落存在跳跃。' },
      { name: '语言表达', score: 8, full: 10, comment: '表达通顺，有一定文采。' },
      { name: '规范表达', score: 7, full: 10, comment: '个别语句可再凝练。' }
    ],
    logic_thinking_score: {
      total: 21,
      full: 30,
      items: [
        { name: '观点是否明确', score: 4, full: 6, diagnosis: '中心观点能回应题目，但仍偏价值表态，缺少可论证的判断边界。', guidance: '先追问“这篇文章真正要证明什么”，再检查每段是否都回到同一个判断。' },
        { name: '论证结构', score: 4, full: 6, diagnosis: '已有观点和材料，但部分段落缺少解释观点与回扣观点。', guidance: '按“观点-解释-举例-分析-回扣”逐段补齐，尤其要在材料后补出分析句。' },
        { name: '推理能力', score: 4, full: 6, diagnosis: '存在由个别材料直接推出普遍结论的倾向，推理中间环节不够清楚。', guidance: '检查是否以偏概全，补写“为什么这个例子能证明本段观点”的因果说明。' },
        { name: '材料使用能力', score: 5, full: 6, diagnosis: '材料基本贴合主题，但还没有充分转化为论据。', guidance: '讲完材料后，说明人物选择背后的原因、价值和现实启示。' },
        { name: '论证深度', score: 4, full: 6, diagnosis: '文章主要处在分析原因层，尚未进入揭示本质和时代意义。', guidance: '继续追问个人奋斗与时代责任之间的本质关系。' }
      ]
    },
    thinking_depth: {
      stars: 3,
      label: '一般',
      current_layer: '分析原因',
      reason: '文章不只描述现象，已经能说明青年奋斗的原因，但对本质、反例和时代意义展开不足。'
    },
    thinking_improvement: {
      current: '你目前主要回答了“青年应该奋斗是什么态度”，还需要进一步回答“为什么这种奋斗与时代责任有关”。',
      next_questions: ['为什么奋斗不能只是个人努力？', '如果只强调热情会有什么问题？', '有没有反例能提醒观点不能绝对化？', '奋斗背后的本质是责任、选择还是能力？', '这个观点与当下社会变化有什么联系？'],
      training_focus: '训练从现象到原因再到本质的三层追问，每个主体段至少补出一句因果分析和一句价值回扣。'
    },
    socratic_questions: [
      '这一段观点是否真正回答了题目，而不是只表达态度？',
      '如果删掉这个材料，中心论证会不会受影响？为什么？',
      '这个例子能证明观点，还是只是和主题有关？',
      '有没有一种情况会让你的判断不成立？',
      '你的结论还能向时代意义或人性选择推进一步吗？'
    ],
    thinking_coach: {
      diagnosis: '核心问题不是没有观点，而是观点、材料和分析之间的推理链条还不够完整。',
      questions: ['本段先证明什么？', '材料中的哪一点能证明它？', '读者可能不同意哪里？'],
      guidance: '不要先重写整段，先在每段材料后补一到两句“原因解释”和“回扣观点”，再判断段落是否需要调整顺序。',
      revision_task: '选择一个主体段，补齐“观点-解释-举例-分析-回扣”五步，并标出新增的分析句。',
      reevaluation: '再次评价时重点检查观点是否稳定、材料是否变成论据、是否避免以偏概全，以及结尾是否提升到时代意义。'
    },
    strengths: [
      '开头能够围绕“青年与时代”建立写作方向，说明学生已经意识到作文不能只谈个人努力，而要放到更大的时代背景中展开。',
      '主体段中“奋斗”与“责任”的联系有一定价值判断基础，如果继续补出原因分析，就能成为支撑中心论点的关键亮点。'
    ],
    problems: ['材料分析深度不足。', '分论点之间的递进关系不够鲜明。'],
    paragraph_comments: [
      { paragraph: 1, comment: '本自然段承担开头引题功能，能够引出青年奋斗主题，但中心句还偏价值表态。建议在段末补一句对“奋斗”的界定，说明它不是情绪化口号，而是把个人理想放入时代坐标的责任选择。' },
      { paragraph: 2, comment: '本自然段承担主体论证功能，材料与主题有关，但材料之后的分析不足。需要进一步解释人物选择为什么能证明青年责任，最后用一句话回扣本段观点。' }
    ],
    editable_sentences: [{ original: '青年要努力奋斗。', reason: '表达较泛。', revision: '青年之奋斗，不只是姿态上的昂扬，更是把个人理想嵌入时代坐标的清醒选择。' }],
    suggestions: [
      {
        focus: '把中心论点从口号推进到可论证判断',
        diagnosis: '原文能够表达青年应当奋斗的态度，但判断还停留在价值表态层面，缺少对“为什么奋斗”和“怎样奋斗”的具体解释。',
        logic_analysis: '高考议论文需要让中心论点具备可展开性。如果只说“青年要努力奋斗”，后文材料只能证明态度正确，却难以形成原因、方法和价值之间的递进链条。',
        action_steps: '先在开头界定奋斗不是情绪化口号，而是责任选择；再在主体段分别回答时代需要、个人成长和现实行动；最后用一句话回扣中心。',
        example_direction: '可改为“青年之奋斗，不只是姿态上的昂扬，更是把个人理想嵌入时代坐标的清醒选择”。'
      },
      {
        focus: '让材料承担分析任务',
        diagnosis: '文章中的材料容易成为观点后的附属例子，没有充分解释材料与中心论点之间的证明关系。',
        logic_analysis: '材料只有经过分析才会转化为论据。缺少分析时，读者只能看到“有例子”，但看不到例子为什么能支撑观点，论证力度会明显下降。',
        action_steps: '每使用一个材料后，补写一到两句因果分析；说明人物选择背后的价值逻辑；再用关键词回扣本段分论点。',
        example_direction: '可按“这个选择表面上是个人努力，实质上体现了青年把自我成长与时代责任相连”的方向展开。'
      },
      {
        focus: '重排主体段递进顺序',
        diagnosis: '主体段之间目前更像并列展开，缺少由概念到原因再到行动的层次推进。',
        logic_analysis: '结构递进会决定文章的思维深度。若每段都在重复同一层面的判断，文章就难以体现发展等级中的“深刻”和“丰富”。',
        action_steps: '第一段先辨析核心概念，第二段解释青年与时代的关系，第三段落到具体行动路径；段首句用递进词连接。',
        example_direction: '可用“首先要辨认方向”“进一步要承担责任”“最终要落到行动”作为段落推进线索。'
      }
    ],
    upgraded_paragraph: '真正的青年成长，不在于被时代浪潮推着前行，而在于能在浪潮中辨认方向。把个人志趣与家国需要相连，把一时热情沉淀为长期行动，青春才不只是年华的明亮，更成为精神的成熟。',
    paragraph_rewrites: [
      {
        paragraph: 2,
        problem: '原段材料之后缺少“为什么能证明观点”的分析，导致论据与中心之间存在跳跃。',
        revision: '真正的青年成长，不在于被时代浪潮推着前行，而在于能在浪潮中辨认方向。当一个青年把个人志趣与家国需要相连，他的奋斗就不再只是自我实现，而是在时代问题面前承担责任。这样写既保留了原段的积极态度，也补足了材料到观点之间的因果说明。'
      },
      {
        paragraph: 3,
        problem: '原段如果只重复“要行动”，会与前文形成同层并列，缺少由认识到实践的递进。',
        revision: '有了方向，还要让判断落到持续行动中。面对复杂现实，青年不能只凭一时热情表态，而要在学习、岗位和公共生活中锤炼能力，把责任感转化为可检验的选择。这样一来，文章就从“为什么奋斗”推进到“怎样奋斗”。'
      }
    ],
    paragraph_refinements: [
      {
        paragraph: 1,
        original: '青年要努力奋斗。',
        problem: '原句是态度口号，缺少概念界定和论证空间。',
        revision: '青年之奋斗，不只是姿态上的昂扬，更是把个人理想嵌入时代坐标的清醒选择。',
        explanation: '修改后把“奋斗”从情绪表态推进为可论证的价值判断，后文可以围绕个人理想、时代坐标和责任选择展开。',
        sentence_edits: [
          { original: '青年要努力奋斗。', revision: '青年之奋斗，不只是姿态上的昂扬，更是把个人理想嵌入时代坐标的清醒选择。', reason: '增强概念辨析和思想力度。' }
        ]
      }
    ],
    good_sentences: ['把个人理想嵌入时代坐标，青春才拥有更辽阔的回声。'],
    next_training: ['练习核心概念辨析。', '积累“青年与时代”主题素材。', '训练分论点递进式结构。'],
    training_tasks: [
      { type: '审题训练', title: '关键词关系图', goal: '辨清个人选择与时代责任的关系', task: '用三句话分别解释关键词含义、二者关系和中心判断。', checkpoint: '中心句不能只写态度，必须可展开论证。' },
      { type: '论证训练', title: '材料后分析句', goal: '把材料转化为论据', task: '为一个素材补写原因分析句和回扣观点句。', checkpoint: '删掉素材后，分析句仍能说明观点。' },
      { type: '语言训练', title: '口号句升级', goal: '提升书面表达', task: '把三句口号化表达改为概念辨析句。', checkpoint: '改句必须包含“不只是/更是”等关系判断。' },
      { type: '思辨训练', title: '反例追问', goal: '避免绝对化', task: '为中心论点设计一个可能反例，并说明如何修正观点边界。', checkpoint: '观点更稳健，不是绝对化口号。' }
    ],
    teacher_overall: '文章能够扣住青年与时代的关系，基本方向是准确的。主要问题在于文本中的主体段还停留在“青年要奋斗”的态度表达，材料之后没有充分解释它为什么能证明时代责任。修改时应先在开头界定“奋斗”的内涵，再把主体段按“方向辨认、责任承担、行动落实”重排，每个材料后补出原因分析和观点回扣，最后让结尾提升到青年与时代互相成就的层面。',
    teacher_comment: '作为一篇考场作文，你最值得肯定的是没有脱离题意，能意识到青年写作不能只写个人情绪，而要放到时代语境中讨论。但现在最需要突破的地方，是把正确态度写成严密论证。你不能满足于说青年应当奋斗、应当担当，而要解释为什么个人选择必须回应时代责任，怎样的选择才算有责任，材料中的人物或事件又如何证明这一点。下一次修改时，请先重写中心论点，再检查每个主体段是否都有观点、解释、材料、分析和回扣。只要你能把材料后的两三句分析补扎实，这篇文章就会从“方向正确”提升为“论证有力”。',
    growth_analysis: {
      advantages: ['审题方向较准', '能主动连接青年与时代'],
      weaknesses: ['论证链不完整', '材料分析不足', '语言口号化'],
      trend: 'insufficient_data',
      trend_summary: '当前为本地兜底批改，历史样本不足，暂不判断成长曲线。',
      ability_radar: { 审题立意: 78, 内容材料: 74, 结构层次: 72, 逻辑论证: 70, 语言表达: 76, 素材运用: 73, 思辨能力: 70 },
      next_focus: ['逻辑论证', '素材运用', '思辨能力']
    },
    title_revision: '在时代坐标中确立青春方向',
    opening_revision: '时代的潮声从不只催促人向前，更追问青年以何种姿态前行。',
    ending_revision: '愿我们把清醒的判断化为持久的行动，在时代坐标中写下青春的答案。',
    polished_full_text: '时代的浪潮从不只是向前奔涌，它也不断追问青年：面对新的技术、新的生活和新的责任，我们究竟以怎样的姿态站立其中？青年不能满足于做岸边的旁观者，更不能把奋斗简化为一句响亮口号。真正有力量的成长，是在具体事务中辨认方向，在平凡岗位上锤炼本领，并把个人理想放入更辽阔的时代坐标。唯有如此，青春才不只是年华的明亮，更能成为回应时代、承担责任的清醒行动。',
    excellent_version: '时代的潮声从不只催促人向前，更追问青年以何种姿态前行。真正的青春选择，不是脱离时代的自我设计，也不是被宏大叙事裹挟的空泛表态，而是在时代需要中确认个人方向，在具体行动中承担公共责任。青年唯有把理想落到学习、岗位与社会生活的每一次选择里，才能让个人价值与时代进步彼此照亮。'
  };
}

function repairJsonStringNewlines(value) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (const char of String(value || '')) {
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      output += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      output += char;
      continue;
    }
    if (inString && char === '\n') {
      output += '\\n';
      continue;
    }
    if (inString && char === '\r') {
      output += '\\r';
      continue;
    }
    output += char;
  }
  return output;
}

export function parseAIJsonObject(text) {
  const cleaned = String(text || '').trim().replace(/^`{3}(?:json)?\s*/i, '').replace(/\s*`{3}$/i, '').trim();
  const candidates = [cleaned];
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        return JSON.parse(repairJsonStringNewlines(candidate));
      } catch {
        // try next candidate
      }
    }
  }
  throw new AIServiceError('AI 服务返回格式无法解析', {
    code: 'AI_UPSTREAM_ERROR',
    status: 502
  });
}

function toNonEmptyArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null && item !== '');
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function stringifyTrainingTask(task) {
  if (typeof task === 'string') return task;
  if (!task || typeof task !== 'object') return String(task || '');
  const prefix = task.type ? `【${task.type}】` : '';
  const title = task.title || task.focus || '训练任务';
  const body = task.task || task.goal || task.checkpoint || '';
  return `${prefix}${title}${body ? `：${body}` : ''}`;
}

function firstSentenceFrom(text, pattern) {
  const value = String(text || '');
  const match = value.match(pattern);
  if (match?.[1]) return match[1].trim().replace(/[。；;，,]*$/, '');
  return '';
}

export function completeLegacyReviewFields(review = {}) {
  const completed = { ...review };
  const growth = completed.growth_analysis || completed.growthAnalysis || {};
  if (!toNonEmptyArray(completed.strengths).length) {
    const inferred = toNonEmptyArray(completed.core_advantages || completed.coreAdvantages || growth.advantages);
    const fromOverall = firstSentenceFrom(completed.overall_evaluation, /最大优点是([^。；;]+)/);
    completed.strengths = inferred.length ? inferred : (fromOverall ? [fromOverall] : []);
  }
  if (!toNonEmptyArray(completed.problems).length) {
    const inferred = toNonEmptyArray(completed.main_problems || completed.mainProblems || completed.weaknesses || growth.weaknesses);
    const fromOverall = firstSentenceFrom(completed.overall_evaluation, /最大短板是([^。；;]+)/);
    completed.problems = inferred.length ? inferred : (fromOverall ? [fromOverall] : []);
  }
  if (!toNonEmptyArray(completed.suggestions).length && toNonEmptyArray(completed.paragraph_refinements).length) {
    completed.suggestions = toNonEmptyArray(completed.paragraph_refinements).map((item) => ({
      focus: item.paragraph ? `第${item.paragraph}段精修` : '逐段精修',
      diagnosis: item.problem || '',
      action_steps: item.revision || '',
      example_direction: item.explanation || ''
    }));
  }
  if (!toNonEmptyArray(completed.next_training).length) {
    completed.next_training = toNonEmptyArray(completed.training_tasks || completed.trainingTasks).map(stringifyTrainingTask).filter(Boolean);
  }
  if (!completed.teacher_overall && completed.teacher_comment) completed.teacher_overall = completed.teacher_comment;
  if (!completed.polished_full_text && completed.excellent_version) completed.polished_full_text = completed.excellent_version;
  return completed;
}

export async function reviewEssay({ assignment, essayText }) {
  const prompt = buildReviewPrompt({ assignment, essayText, fullScore: assignment?.full_score || 60 });
  let result;
  try {
    result = await callTextTask('essay_grading', prompt, { jsonMode: true, maxTokens: 9000 });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production' && process.env.AI_ALLOW_MOCK_FALLBACK !== 'false' && isRecoverableAiError(error)) {
      console.warn('AI 批改服务暂时不可用，测试/开发环境使用本地兜底批改：', safeAiErrorMessage(error));
      return mockReview(assignment?.full_score || 60);
    }
    throw error;
  }
  const text = result.text;
  if (!text) {
    throw new AIServiceError('AI 服务返回空内容', {
      code: 'AI_UPSTREAM_ERROR',
      provider: result.provider || getTextProvider(),
      model: result.model || getAIProviderStatus().model,
      status: 502
    });
  }
  const review = completeLegacyReviewFields(parseAIJsonObject(text));
  review.ai_meta = {
    provider: result.provider,
    model: result.model,
    fallbackUsed: result.fallbackUsed,
    primaryProvider: result.primaryProvider,
    taskType: result.taskType,
    latencyMs: result.latencyMs
  };
  return review;
}

export async function recognizeImages(files) {
  if (files.length && fs.existsSync('/usr/bin/swift')) {
    try {
      return files.map((file) => execFileSync('/usr/bin/swift', [localOcrScript, file.path], { encoding: 'utf8', timeout: 60000 }).trim()).filter(Boolean).join('\n\n');
    } catch (error) {
      console.error('本机 OCR 失败，回退到在线识别：', error.message);
    }
  }
  const validation = validateProviderConfig('openai');
  if (!validation.ok) return '';

  const content = [{ type: 'input_text', text: ocrPrompt }];
  for (const file of files) {
    const base64 = fs.readFileSync(file.path).toString('base64');
    content.push({
      type: 'input_image',
      image_url: `data:${file.mimetype};base64,${base64}`
    });
  }
  try {
    return await callOpenAI([{ role: 'user', content }]);
  } catch (error) {
    if (isRecoverableAiError(error)) console.warn('在线 OCR 服务暂时不可用：', safeAiErrorMessage(error));
    throw error;
  }
}

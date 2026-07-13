import { analyzeEssay } from '../../apps/essay-ai/src/index.js';

const result = await analyzeEssay({
  appDir: process.cwd(),
  title: '示例作文',
  text: '青年应在时代中寻找自己的位置。有人说出发比到达更重要，也有人说结果才是努力的证明。对此你怎么看？',
  source: 'script'
});

console.log(JSON.stringify(result, null, 2));

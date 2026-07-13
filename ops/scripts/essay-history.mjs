import { listEssayHistory } from '../../apps/essay-ai/src/index.js';

const history = listEssayHistory({
  appDir: process.cwd(),
  limit: 20
});

console.log(JSON.stringify(history, null, 2));

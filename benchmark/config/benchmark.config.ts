export type BenchmarkProviderName = 'mock' | 'deepseek' | 'openai' | 'gemini' | 'custom';

export interface BenchmarkConfig {
  version: string;
  enabledModels: BenchmarkProviderName[];
  outputDirs: {
    history: string;
    reports: string;
    result: string;
    charts: string;
    export: string;
    logs: string;
    config: string;
  };
  scoring: {
    dimensions: string[];
    weights: Record<string, number>;
  };
  exports: string[];
  anonymization: {
    enabled: boolean;
    prefix: string;
  };
  charts: {
    theme: string;
    imageWidth: number;
    imageHeight: number;
  };
  retry: {
    maxRetries: number;
    backoffMs: number;
  };
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export const benchmarkConfig: BenchmarkConfig = {
  version: '1.0',
  enabledModels: ['mock'],
  outputDirs: {
    history: 'benchmark/history',
    reports: 'benchmark/reports',
    result: 'benchmark/result',
    charts: 'benchmark/charts',
    export: 'benchmark/export',
    logs: 'benchmark/logs',
    config: 'benchmark/config'
  },
  scoring: {
    dimensions: ['批改深度', '教师价值', '逻辑分析', '语言分析', '素材分析', '修改质量', '成长指导', '可操作性'],
    weights: {
      批改深度: 1,
      教师价值: 1,
      逻辑分析: 1.2,
      语言分析: 1,
      素材分析: 1,
      修改质量: 1.1,
      成长指导: 1,
      可操作性: 1.1
    }
  },
  exports: ['word', 'pdf', 'markdown', 'excel', 'csv', 'zip'],
  anonymization: {
    enabled: true,
    prefix: 'anon'
  },
  charts: {
    theme: 'teacher-green',
    imageWidth: 1200,
    imageHeight: 800
  },
  retry: {
    maxRetries: 2,
    backoffMs: 1000
  },
  logLevel: 'info'
};

export default benchmarkConfig;

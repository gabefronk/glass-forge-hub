import { createScriptedExecution } from './scriptedExecution.js';
import { createQuoteIntakeRouter } from './windowQuoteIntakeRouter.js';
import { loadScriptedRunnerConfig } from './scriptedRunnerConfig.js';

export function createLazyScriptedRuntime({ normalizeRequest, validateReady, loadConfig = loadScriptedRunnerConfig, hash, now, uuid } = {}) {
  async function resolve({ db }) {
    const config = await loadConfig({ db });
    const scripted = createScriptedExecution({ config, normalizeRequest, validateReady, ...(hash ? { hash } : {}), ...(now ? { now } : {}), ...(uuid ? { uuid } : {}) });
    return { scripted, router: createQuoteIntakeRouter({ scripted, config, ...(now ? { now } : {}) }) };
  }
  return {
    // User core has a truthy execution object, retaining worker_* retirement.
    // Configuration state is read through getStatus; no startup snapshot is trusted.
    execution: {
      configured: false,
      provider: 'deterministic',
      async afterInput(args) { return (await resolve({ db: args.db })).router.afterInput(args); },
      async getStatus(args) { return (await resolve(args)).router.getStatus(args); }
    },
    async getExecution(args) { return (await resolve(args)).scripted; }
  };
}

import { createConfigurationPackageServices } from './configurationPackageServices.js';
import { loadScriptedRunnerConfig } from './scriptedRunnerConfig.js';

export function createConfigurationAgentRouter({ legacy, onlineExecution, loadConfig = loadScriptedRunnerConfig, now, hash, uuid } = {}) {
  const route = method => async args => {
    // Exact private ID lookup comes first. Ordinary quotes retain their existing
    // executor without requiring package configuration or private work storage.
    const rows = args.db.WindowQuoteOnlineRequests ? await args.db.WindowQuoteOnlineRequests.filter({ id: args.body?.quote_id }, undefined, 1) : [];
    if (!rows.length) return legacy[method](args);
    const config = await loadConfig({ db: args.db });
    const services = createConfigurationPackageServices({ config, onlineExecution, now, hash, uuid });
    const output = await services.online.route(args, method);
    if (method === 'report' || method === 'tool' && args.body.action === 'report') {
      // The raw report persists and releases its slot first. An exact terminal
      // replay also re-enters here if completion failed after that persistence.
      await services.coordinator.reconcile({ db: args.db, packageId: rows[0].package_id });
    }
    return output;
  };
  return { ...legacy, tool: route('tool'), report: route('report') };
}

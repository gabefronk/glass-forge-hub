import { createConfigurationPackageCoordinator } from './configurationPackageCoordinator.js';
import { createConfigurationOnlineService } from './configurationOnlineQueue.js';
import { verifyOnlineConfigurationResult } from './onlineConfigurationEvidence.js';
import { configurationReadyPatch } from './configurationReadyPatch.js';
import { previewPolicyKey } from './nativePricePreview.js';

// No transport is created here. Both paths share the same guarded online
// executor and browser slot, but private window requests have their own storage.
export function createConfigurationPackageServices({ config, onlineExecution, now = () => new Date(), hash, uuid, previews, plan } = {}) {
  const online = createConfigurationOnlineService({ execution: onlineExecution, now, ...(hash ? { hash } : {}),
    policy: config?.native_engine ? previewPolicyKey(config.native_engine) : null,
    verifyReady: args => verifyOnlineConfigurationResult({ ...args, now: now() }) });
  const coordinator = createConfigurationPackageCoordinator({ config, now, online, ...(hash ? { hash } : {}), ...(uuid ? { uuid } : {}),
    ...(previews ? { previews } : {}), ...(plan ? { plan } : {}), complete: args => configurationReadyPatch({ ...args, ...(hash ? { hash } : {}) }) });
  return { online, coordinator };
}

// Node resolve hook for tests: maps Vite's "@/..." alias to src/ and adds the ".js"
// extension that src/ modules omit ("./feeMath"). Test-only; app code is unchanged.
const SRC = new URL('../../src/', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  let target = specifier;
  if (target.startsWith('@/')) target = SRC + target.slice(2);
  else if ((target.startsWith('./') || target.startsWith('../')) && context.parentURL?.startsWith(SRC)) target = new URL(target, context.parentURL).href;
  if (target.startsWith(SRC) && !/\.[cm]?jsx?$/.test(target)) return nextResolve(target + '.js', context);
  return nextResolve(target, context);
}

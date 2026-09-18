// Import this first in a test that loads src/lib modules using "@/..." imports.
import { register } from 'node:module';
register('./src-alias-hooks.mjs', import.meta.url);

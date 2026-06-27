import sharedConfig from '@extension/tailwindcss-config';
import deepmerge from 'deepmerge';
import type { Config } from 'tailwindcss';

export const withUI = (tailwindConfig: Config): Config =>
  deepmerge(deepmerge(sharedConfig, tailwindConfig), {
    content: ['../../packages/ui/lib/**/*.tsx'],
  }) as Config;

import { ServiceToolProvider, type ProviderOptions } from './provider.js';
export { AceToolError } from './provider.js';
export type { ProviderOptions as SunoToolProviderOptions } from './provider.js';

/** Suno music generation, extension, lyrics, and task queries through Ace Data Cloud. */
export class SunoToolProvider extends ServiceToolProvider {
  constructor(options: ProviderOptions = {}) {
    super({
      slug: 'suno',
      name: 'Suno by Ace Data Cloud',
      description: 'Suno AI music, instrumental tracks, lyrics, audio extension, and same-task result queries.',
      endpoint: 'https://suno.mcp.acedata.cloud/mcp',
      packageName: '@acedatacloud/mastra-suno',
    }, options);
  }
}

import { MastraEditor } from '@mastra/editor';
import { SunoToolProvider } from '../src/index.js';

// Pass editor into your existing new Mastra({ ..., editor, storage }) configuration.
// Its API key belongs to the server owner; it is not a per-user OAuth connection.
export function createSunoEditor(apiKey: string) {
  const suno = new SunoToolProvider({ apiKey });
  const editor = new MastraEditor({ toolProviders: { suno } });
  return { suno, editor };
}

// Code-configured agents can use the same provider without stored-agent editing.
export async function createSunoTools(apiKey: string) {
  const suno = new SunoToolProvider({ apiKey });
  const tools = await suno.resolveTools(['suno_generate_music', 'suno_get_task']);
  return { suno, tools };
}

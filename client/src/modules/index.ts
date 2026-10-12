/**
 * Client module registry: maps module ids to their interactive workspaces.
 */

import type { ClientModule } from './types.ts';
import { programmingClient } from './programming/index.tsx';
import { electricalClient } from './electrical/index.tsx';

const CLIENT_MODULES: Record<string, ClientModule> = {
  [programmingClient.id]: programmingClient,
  [electricalClient.id]: electricalClient,
};

export function clientModule(id: string): ClientModule | undefined {
  return CLIENT_MODULES[id];
}

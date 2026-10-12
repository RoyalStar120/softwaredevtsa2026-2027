/**
 * Client entry for the Electrical troubleshooting module.
 * Imports only TYPES from shared code (no hidden circuit/fault data).
 */

import type { ClientModule } from '../types.ts';
import { DebriefExtras } from './DebriefExtras.tsx';
import { Workspace } from './Workspace.tsx';

export const electricalClient: ClientModule = {
  id: 'electrical',
  Workspace,
  DebriefExtras,
};

export default electricalClient;

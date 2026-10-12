/**
 * Client entry for the Programming: Debugging module.
 * Imports only TYPES and secret-free helpers (grading / codeAnalysis) from shared code.
 */

import type { ClientModule } from '../types.ts';
import { DebriefExtras } from './DebriefExtras.tsx';
import { Workspace } from './Workspace.tsx';

export const programmingClient: ClientModule = {
  id: 'programming',
  Workspace,
  DebriefExtras,
};

export default programmingClient;

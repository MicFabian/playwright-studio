import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Testing Library only auto-cleans when Vitest globals are on. Without this,
// each render stacks on the last and queries find several matches.
afterEach(cleanup);

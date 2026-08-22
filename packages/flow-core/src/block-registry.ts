import type { FlowStep, FlowStepKind, LocatorTarget, ValueExpr } from './ir';

export type BlockCategory = 'entry' | 'action' | 'assertion' | 'logic' | 'annotation';

export interface BlockDefinition {
  kind: FlowStepKind;
  category: BlockCategory;
  title: string;
  description: string;
  codeLabel: string;
  accentToken: string;
  icon: string;
  scoped: boolean;
}

const literal = (value: string): ValueExpr => ({ source: 'literal', value });

const testIdTarget = (value: string): LocatorTarget => ({
  base: { by: 'testId', value: literal(value) },
});

export const blockRegistry: Record<FlowStepKind, BlockDefinition> = {
  navigate: {
    kind: 'navigate',
    category: 'entry',
    title: 'Open page',
    description: 'Boot a browser page or jump to a route.',
    codeLabel: 'page.goto()',
    accentToken: 'var(--block-entry)',
    icon: 'Globe',
    scoped: false,
  },
  click: {
    kind: 'click',
    category: 'action',
    title: 'Click',
    description: 'Trigger a button, link, or custom locator.',
    codeLabel: 'locator.click()',
    accentToken: 'var(--block-action)',
    icon: 'MousePointerClick',
    scoped: false,
  },
  fill: {
    kind: 'fill',
    category: 'action',
    title: 'Fill input',
    description: 'Type or replace content in a field.',
    codeLabel: 'locator.fill()',
    accentToken: 'var(--block-action)',
    icon: 'Keyboard',
    scoped: false,
  },
  press: {
    kind: 'press',
    category: 'action',
    title: 'Press key',
    description: 'Send a keyboard key to an element.',
    codeLabel: 'locator.press()',
    accentToken: 'var(--block-action)',
    icon: 'CornerDownLeft',
    scoped: false,
  },
  check: {
    kind: 'check',
    category: 'action',
    title: 'Check box',
    description: 'Check or uncheck a checkbox or radio.',
    codeLabel: 'locator.check()',
    accentToken: 'var(--block-action)',
    icon: 'SquareCheck',
    scoped: false,
  },
  selectOption: {
    kind: 'selectOption',
    category: 'action',
    title: 'Select option',
    description: 'Choose a value in a select element.',
    codeLabel: 'locator.selectOption()',
    accentToken: 'var(--block-action)',
    icon: 'List',
    scoped: false,
  },
  hover: {
    kind: 'hover',
    category: 'action',
    title: 'Hover',
    description: 'Move the pointer over an element.',
    codeLabel: 'locator.hover()',
    accentToken: 'var(--block-action)',
    icon: 'Pointer',
    scoped: false,
  },
  assert: {
    kind: 'assert',
    category: 'assertion',
    title: 'Assert element',
    description: 'Validate text, visibility, value, or count.',
    codeLabel: 'expect(locator)',
    accentToken: 'var(--block-assertion)',
    icon: 'CircleCheck',
    scoped: false,
  },
  assertPage: {
    kind: 'assertPage',
    category: 'assertion',
    title: 'Assert page',
    description: 'Validate the page URL or title.',
    codeLabel: 'expect(page)',
    accentToken: 'var(--block-assertion)',
    icon: 'FileCheck',
    scoped: false,
  },
  extract: {
    kind: 'extract',
    category: 'action',
    title: 'Extract value',
    description: 'Read text or state and bind it to a variable.',
    codeLabel: 'textContent()',
    accentToken: 'var(--block-action)',
    icon: 'Variable',
    scoped: false,
  },
  condition: {
    kind: 'condition',
    category: 'logic',
    title: 'Condition',
    description: 'Run a branch only when a check passes.',
    codeLabel: 'if / else',
    accentToken: 'var(--block-logic)',
    icon: 'GitBranch',
    scoped: true,
  },
  loop: {
    kind: 'loop',
    category: 'logic',
    title: 'Loop',
    description: 'Repeat a sequence over a collection.',
    codeLabel: 'for...of',
    accentToken: 'var(--block-logic)',
    icon: 'Repeat',
    scoped: true,
  },
  try: {
    kind: 'try',
    category: 'logic',
    title: 'Try',
    description: 'Recover from a failing sequence.',
    codeLabel: 'try / catch',
    accentToken: 'var(--block-logic)',
    icon: 'ShieldAlert',
    scoped: true,
  },
  call: {
    kind: 'call',
    category: 'action',
    title: 'Call helper',
    description: 'Invoke a fixture, helper, or page object method.',
    codeLabel: 'helper()',
    accentToken: 'var(--block-action)',
    icon: 'FunctionSquare',
    scoped: false,
  },
  code: {
    kind: 'code',
    category: 'action',
    title: 'Custom code',
    description: 'Run Playwright code that has no block yet.',
    codeLabel: 'custom code',
    accentToken: 'var(--block-code)',
    icon: 'Code',
    scoped: false,
  },
  comment: {
    kind: 'comment',
    category: 'annotation',
    title: 'Comment',
    description: 'Explain intent without affecting the run.',
    codeLabel: '//',
    accentToken: 'var(--block-annotation)',
    icon: 'MessageSquare',
    scoped: false,
  },
};

export const blockLibrary: readonly FlowStepKind[] = [
  'navigate',
  'click',
  'fill',
  'press',
  'check',
  'selectOption',
  'hover',
  'assert',
  'assertPage',
  'extract',
  'condition',
  'loop',
  'try',
  'call',
  'code',
  'comment',
];

export function createStep(kind: FlowStepKind, id: string): FlowStep {
  switch (kind) {
    case 'navigate':
      return { id, kind, url: literal('https://example.com') };
    case 'click':
      return { id, kind, target: testIdTarget('submit') };
    case 'fill':
      return { id, kind, target: testIdTarget('email'), value: literal('qa@example.com') };
    case 'press':
      return { id, kind, target: testIdTarget('search'), key: 'Enter' };
    case 'check':
      return { id, kind, target: testIdTarget('terms'), checked: true };
    case 'selectOption':
      return { id, kind, target: testIdTarget('country'), value: literal('DE') };
    case 'hover':
      return { id, kind, target: testIdTarget('menu') };
    case 'assert':
      return {
        id,
        kind,
        target: testIdTarget('dashboard-title'),
        assertion: { type: 'containsText', text: literal('Dashboard') },
      };
    case 'assertPage':
      return { id, kind, assertion: { type: 'url', value: literal('/dashboard') } };
    case 'extract':
      return { id, kind, target: testIdTarget('order-count'), variable: 'orderCount' };
    case 'condition':
      return {
        id,
        kind,
        predicate: { type: 'locatorVisible', target: testIdTarget('toast-error') },
        then: { steps: [] },
      };
    case 'loop':
      return { id, kind, source: literal('rows'), itemName: 'row', body: { steps: [] } };
    case 'try':
      return {
        id,
        kind,
        body: { steps: [] },
        catch: { errorName: 'error', body: { steps: [] } },
      };
    case 'call':
      return { id, kind, target: 'helpers.signIn', args: [] };
    case 'code':
      return { id, kind, code: "await page.waitForLoadState('networkidle');" };
    case 'comment':
      return { id, kind, text: 'Describe this part of the flow' };
    default:
      return { id, kind: 'comment', text: 'Unsupported block' };
  }
}

export function describeStep(step: FlowStep): string {
  switch (step.kind) {
    case 'navigate':
      return step.url.source === 'literal' ? step.url.value : `$${step.url.name}`;
    case 'extract':
      return `→ ${step.variable}`;
    case 'loop':
      return `for each ${step.itemName}`;
    case 'call':
      return step.target;
    case 'comment':
      return step.text;
    case 'assertPage':
      return step.assertion.type === 'url' ? 'URL' : 'title';
    default:
      return blockRegistry[step.kind]?.codeLabel ?? step.kind;
  }
}

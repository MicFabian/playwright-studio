export const FLOW_FORMAT_VERSION = 2;

export type AriaRole =
  | 'alert'
  | 'button'
  | 'checkbox'
  | 'columnheader'
  | 'combobox'
  | 'dialog'
  | 'heading'
  | 'link'
  | 'list'
  | 'listbox'
  | 'listitem'
  | 'menu'
  | 'menuitem'
  | 'navigation'
  | 'option'
  | 'progressbar'
  | 'radio'
  | 'region'
  | 'row'
  | 'searchbox'
  | 'separator'
  | 'slider'
  | 'spinbutton'
  | 'status'
  | 'switch'
  | 'tab'
  | 'table'
  | 'tabpanel'
  | 'textbox'
  | 'tooltip';

export type ValueExpr =
  | { source: 'literal'; value: string }
  | { source: 'variable'; name: string }
  | { source: 'env'; name: string };

export type LocatorRef =
  | { by: 'role'; role: AriaRole; name?: ValueExpr; exact?: boolean }
  | { by: 'testId'; value: ValueExpr }
  | { by: 'label'; text: ValueExpr; exact?: boolean }
  | { by: 'placeholder'; text: ValueExpr; exact?: boolean }
  | { by: 'text'; text: ValueExpr; exact?: boolean }
  | { by: 'altText'; text: ValueExpr; exact?: boolean }
  | { by: 'title'; text: ValueExpr; exact?: boolean }
  | { by: 'css'; selector: ValueExpr }
  | { by: 'xpath'; selector: ValueExpr };

export interface LocatorTarget {
  base: LocatorRef;
  nth?: number;
  hasText?: ValueExpr;
}

export type AssertionIR =
  | { type: 'visible'; negated?: boolean }
  | { type: 'hidden' }
  | { type: 'enabled'; negated?: boolean }
  | { type: 'checked'; negated?: boolean }
  | { type: 'containsText'; text: ValueExpr; negated?: boolean }
  | { type: 'hasText'; text: ValueExpr; negated?: boolean }
  | { type: 'hasValue'; value: ValueExpr; negated?: boolean }
  | { type: 'hasCount'; count: number; negated?: boolean };

export type PageAssertionIR =
  | { type: 'url'; value: ValueExpr; negated?: boolean }
  | { type: 'title'; value: ValueExpr; negated?: boolean };

export type PredicateIR =
  | { type: 'locatorVisible'; target: LocatorTarget; negated?: boolean }
  | { type: 'locatorChecked'; target: LocatorTarget; negated?: boolean }
  | { type: 'expression'; code: string };

export interface StepBase {
  id: string;
  label?: string;
}

export interface NavigateStep extends StepBase {
  kind: 'navigate';
  url: ValueExpr;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
}

export interface ClickStep extends StepBase {
  kind: 'click';
  target: LocatorTarget;
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  force?: boolean;
  timeoutMs?: number;
}

export interface FillStep extends StepBase {
  kind: 'fill';
  target: LocatorTarget;
  value: ValueExpr;
  timeoutMs?: number;
}

export interface PressStep extends StepBase {
  kind: 'press';
  target: LocatorTarget;
  key: string;
}

export interface CheckStep extends StepBase {
  kind: 'check';
  target: LocatorTarget;
  checked: boolean;
}

export interface SelectOptionStep extends StepBase {
  kind: 'selectOption';
  target: LocatorTarget;
  value: ValueExpr;
}

export interface HoverStep extends StepBase {
  kind: 'hover';
  target: LocatorTarget;
}

export interface AssertStep extends StepBase {
  kind: 'assert';
  target: LocatorTarget;
  assertion: AssertionIR;
  timeoutMs?: number;
}

export interface AssertPageStep extends StepBase {
  kind: 'assertPage';
  assertion: PageAssertionIR;
  timeoutMs?: number;
}

export interface ExtractStep extends StepBase {
  kind: 'extract';
  target: LocatorTarget;
  variable: string;
  property?: 'text' | 'inputValue' | 'count';
}

export interface ConditionStep extends StepBase {
  kind: 'condition';
  predicate: PredicateIR;
  then: Sequence;
  else?: Sequence;
}

export interface LoopStep extends StepBase {
  kind: 'loop';
  source: ValueExpr;
  itemName: string;
  body: Sequence;
}

export interface TryStep extends StepBase {
  kind: 'try';
  body: Sequence;
  catch?: { errorName: string; body: Sequence };
  finally?: Sequence;
}

export interface CallStep extends StepBase {
  kind: 'call';
  target: string;
  args: ValueExpr[];
  assignTo?: string;
}

export interface UseSnippetStep extends StepBase {
  kind: 'useSnippet';
  snippetId: string;
  args: Record<string, ValueExpr>;
  assign?: Record<string, string>;
}

export interface CodeStep extends StepBase {
  kind: 'code';
  code: string;
}

export interface CommentStep extends StepBase {
  kind: 'comment';
  text: string;
}

export type FlowStep =
  | NavigateStep
  | ClickStep
  | FillStep
  | PressStep
  | CheckStep
  | SelectOptionStep
  | HoverStep
  | AssertStep
  | AssertPageStep
  | ExtractStep
  | ConditionStep
  | LoopStep
  | TryStep
  | CallStep
  | UseSnippetStep
  | CodeStep
  | CommentStep;

export type FlowStepKind = FlowStep['kind'];

export interface Sequence {
  steps: FlowStep[];
}

export interface FlowLayout {
  positions: Record<string, { x: number; y: number }>;
  collapsedScopes?: Record<string, boolean>;
}

export type SnippetParamType = 'string' | 'number' | 'boolean';

export interface SnippetParam {
  name: string;
  type: SnippetParamType;
  description?: string;
  required?: boolean;
  defaultValue?: string;
}

export interface SnippetOutput {
  name: string;
  type: SnippetParamType;
  description?: string;
}

export interface SnippetDefinition {
  formatVersion: 2;
  id: string;
  name: string;
  description: string;
  params: SnippetParam[];
  outputs: SnippetOutput[];
  code: string;
  updatedAt?: string;
}

export interface DataColumn {
  name: string;
}

export interface DataCase {
  name: string;
  values: Record<string, string>;
}

export interface DataSet {
  columns: DataColumn[];
  cases: DataCase[];
}

export interface TestOptionsIR {
  tags?: string[];
  annotations?: { type: string; description?: string }[];
  timeoutMs?: number;
}

export interface FlowDocument {
  formatVersion: typeof FLOW_FORMAT_VERSION;
  id: string;
  name: string;
  status: 'stable' | 'draft' | 'failing';
  updatedAt?: string;
  root: Sequence;
  layout: FlowLayout;
  testOptions?: TestOptionsIR;
  data?: DataSet;
}

export type DiagnosticSeverity = 'error' | 'warning';

export interface CompilerDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  stepId?: string;
}

export interface SourceLocation {
  line: number;
  endLine: number;
}

export interface CompileResult {
  source: string;
  diagnostics: CompilerDiagnostic[];
  stepLocations: Record<string, SourceLocation>;
}

export const SCOPED_STEP_KINDS: readonly FlowStepKind[] = ['condition', 'loop', 'try'];

export function isScopedStep(step: FlowStep): step is ConditionStep | LoopStep | TryStep {
  return SCOPED_STEP_KINDS.includes(step.kind);
}

function isSequence(candidate: unknown): candidate is Sequence {
  return (
    candidate != null &&
    typeof candidate === 'object' &&
    Array.isArray((candidate as Sequence).steps)
  );
}

/**
 * Flow files can be edited by hand, so a scope may arrive without the body it
 * is supposed to have. Every walker goes through here, and each one would
 * otherwise throw on a missing sequence rather than reporting it.
 */
export function childSequences(step: FlowStep): Sequence[] {
  switch (step.kind) {
    case 'condition':
      return [step.then, step.else].filter(isSequence);
    case 'loop':
      return [step.body].filter(isSequence);
    case 'try':
      return [step.body, step.catch?.body, step.finally].filter(isSequence);
    default:
      return [];
  }
}

export function walkSteps(
  sequence: Sequence,
  visit: (step: FlowStep, depth: number) => void,
  depth = 0,
): void {
  sequence.steps.forEach((step) => {
    visit(step, depth);
    childSequences(step).forEach((child) => walkSteps(child, visit, depth + 1));
  });
}

export function countSteps(sequence: Sequence): number {
  let total = 0;
  walkSteps(sequence, () => {
    total += 1;
  });
  return total;
}

export function findStep(sequence: Sequence, stepId: string): FlowStep | null {
  let found: FlowStep | null = null;
  walkSteps(sequence, (step) => {
    if (step.id === stepId) {
      found = step;
    }
  });
  return found;
}

/**
 * Stage 14/15: Validation for AI-generated condition-variant (transfer) problems.
 *
 * A transfer problem must actually change the conditions (not just numbers or
 * variable names), keep a valid 100-point rubric, stay strictly within the
 * selected concept scope, and match the exact selected type/difficulty.
 * Unverifiable or invalid output is rejected, never saved as success.
 */

import { Problem, ProblemDifficulty, ProblemType, RubricCriterion } from './types';
import { validateEvaluationRubric } from './evaluationValidation';

/**
 * Selects the approved transfer problem for the CURRENT draft only. An earlier
 * approved generation (different draftId) must never be treated as this draft's
 * approval, even if it shares the same logic session.
 */
export function selectApprovedTransferProblem(
  problems: Problem[],
  draftId: string | undefined
): Problem | null {
  if (!draftId) return null;
  return problems.find((p) => p.isTransfer === true && p.draftId === draftId) || null;
}

export function previousApprovedTransfers(
  problems: Problem[],
  draftId: string | undefined
): Problem[] {
  return problems.filter((p) => p.isTransfer === true && p.draftId !== draftId);
}

export type TransferKind =
  | 'precondition_change'
  | 'counterexample'
  | 'cross_concept'
  | 'representation_change'
  | 'constraint_change'
  | 'complexity_change'
  | 'boundary_case'
  | 'data_structure_change';

export const TRANSFER_KINDS: TransferKind[] = [
  'precondition_change',
  'counterexample',
  'cross_concept',
  'representation_change',
  'constraint_change',
  'complexity_change',
  'boundary_case',
  'data_structure_change',
];

export const TRANSFER_MIN_MINUTES = 5;
export const TRANSFER_MAX_MINUTES = 120;
const MAX_OUTPUT_TEXT_CHARS = 12000;

export interface TransferProblemOutput {
  title: string;
  promptText: string;
  type: ProblemType;
  difficulty: ProblemDifficulty;
  conceptIds: string[];
  transferKind: TransferKind;
  originalCondition: string;
  newCondition: string;
  transferChanges: string;
  understandingFocus: string;
  timeStandardMinutes: number;
  modelAnswer: string;
  rubric: RubricCriterion[];
  hints: string[];
  designIntent: string;
  sourceRefs: string;
  evidenceQuote?: string;
  answerEvidenceVerified: boolean;   // 원답안에서 인용을 확인함
  materialEvidenceVerified: false;   // 강의 자료 근거는 별도 검증 없이는 false
  numericOnlySuspected: boolean;     // 숫자/변수명만 바뀐 것으로 의심됨
  mathFormula?: string;
  codeSnippet?: string;
}

export interface TransferValidationContext {
  allowedConceptIds: string[];
  requiredType: ProblemType;
  requiredDifficulty: ProblemDifficulty;
  originalPrompt: string;
  originalAnswer: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Heuristic: if two prompts differ only in numbers and short identifiers, the
 * "change" is likely cosmetic. This is a review signal, not a hard rejection.
 */
function looksNumericOnly(original: string, next: string): boolean {
  const strip = (s: string) =>
    normalize(s)
      .replace(/\d+(\.\d+)?/g, '#')
      .replace(/\b[a-z]{1,2}\b/g, 'x')
      .replace(/\s+/g, ' ');
  return strip(original) === strip(next);
}

export function validateTransferProblemOutput(
  value: unknown,
  context: TransferValidationContext
): TransferProblemOutput {
  const parsed = asRecord(value);
  if (!parsed) throw new Error('AI 전이 문제 결과 형식이 올바르지 않습니다.');

  const title = asString(parsed.title).trim();
  const promptText = asString(parsed.promptText).trim();
  const modelAnswer = asString(parsed.modelAnswer).trim();
  const transferChanges = asString(parsed.transferChanges).trim();
  const understandingFocus = asString(parsed.understandingFocus).trim();
  const originalCondition = asString(parsed.originalCondition).trim();
  const newCondition = asString(parsed.newCondition).trim();
  const transferKindRaw = asString(parsed.transferKind).trim() as TransferKind;
  const hints = asStringArray(parsed.hints).map((h) => h.trim()).filter(Boolean);

  if (!title || !promptText || !modelAnswer) {
    throw new Error('전이 문제에 필수 항목(제목/지문/모범답안)이 누락되었습니다.');
  }
  if (!TRANSFER_KINDS.includes(transferKindRaw)) {
    throw new Error('전이 문제의 변형 유형이 유효하지 않습니다.');
  }
  if (!originalCondition || !newCondition) {
    throw new Error('전이 문제에 원래 조건과 바뀐 조건이 명시되지 않았습니다.');
  }
  if (normalize(originalCondition) === normalize(newCondition)) {
    throw new Error('원래 조건과 바뀐 조건이 동일합니다. 조건을 실제로 변경해야 합니다.');
  }
  if (transferChanges.length < 10 || !understandingFocus) {
    throw new Error('전이 문제에 바뀐 조건 요약과 확인하려는 이해 요소가 명시되지 않았습니다.');
  }
  if (normalize(promptText) === normalize(context.originalPrompt)) {
    throw new Error('전이 문제가 원문 문제와 동일합니다. 조건을 실제로 변경해야 합니다.');
  }

  // Exact selected type and difficulty (not the whole domain).
  const type = asString(parsed.type) as ProblemType;
  if (type !== context.requiredType) {
    throw new Error(`전이 문제 유형(${type})이 선택한 유형(${context.requiredType})과 다릅니다.`);
  }
  const difficulty = (
    ['advanced_college', 'intermediate', 'graduate_challenging'].includes(asString(parsed.difficulty))
      ? asString(parsed.difficulty)
      : 'advanced_college'
  ) as ProblemDifficulty;
  if (difficulty !== context.requiredDifficulty) {
    throw new Error(`전이 문제 난도(${difficulty})가 선택한 난도(${context.requiredDifficulty})와 다릅니다.`);
  }

  // Concept scope: reject any out-of-scope concept (never silently drop it).
  const rawConceptIds = asStringArray(parsed.conceptIds);
  if (rawConceptIds.length === 0) {
    throw new Error('전이 문제가 선택 개념 범위와 연결되지 않았습니다.');
  }
  if (new Set(rawConceptIds).size !== rawConceptIds.length) {
    throw new Error('전이 문제의 개념 ID가 중복되었습니다.');
  }
  const outOfScope = rawConceptIds.filter((id) => !context.allowedConceptIds.includes(id));
  if (outOfScope.length > 0) {
    throw new Error(`전이 문제에 범위 밖 개념이 포함되어 있습니다: ${outOfScope.join(', ')}`);
  }

  if (hints.length === 0) {
    throw new Error('전이 문제에 단계별 힌트가 없습니다.');
  }

  // Shared rubric rules with the evaluation API (unique ids, labels, positive
  // finite scores, exactly 100 total).
  const rubric = validateEvaluationRubric(parsed.rubric);

  const timeStandardMinutes =
    typeof parsed.timeStandardMinutes === 'number' && Number.isFinite(parsed.timeStandardMinutes)
      ? Math.round(parsed.timeStandardMinutes)
      : NaN;
  if (
    !Number.isFinite(timeStandardMinutes) ||
    timeStandardMinutes < TRANSFER_MIN_MINUTES ||
    timeStandardMinutes > TRANSFER_MAX_MINUTES
  ) {
    throw new Error(
      `전이 문제의 예상 풀이 시간은 ${TRANSFER_MIN_MINUTES}~${TRANSFER_MAX_MINUTES}분이어야 합니다.`
    );
  }

  const totalText =
    title.length +
    promptText.length +
    modelAnswer.length +
    hints.join('').length +
    rubric.map((r) => `${r.label}${r.description}`).join('').length +
    rawConceptIds.join('').length;
  if (totalText > MAX_OUTPUT_TEXT_CHARS) {
    throw new Error('전이 문제 출력이 허용 길이를 초과했습니다.');
  }

  // Answer-evidence is verified against the student's actual answer; material
  // evidence is never claimed without a real material check.
  const evidenceQuote = asString(parsed.evidenceQuote).trim();
  const answerEvidenceVerified =
    evidenceQuote.length > 0 && normalize(context.originalAnswer).includes(normalize(evidenceQuote));

  return {
    title,
    promptText,
    type,
    difficulty,
    conceptIds: rawConceptIds,
    transferKind: transferKindRaw,
    originalCondition,
    newCondition,
    transferChanges,
    understandingFocus,
    timeStandardMinutes,
    modelAnswer,
    rubric,
    hints,
    designIntent: asString(parsed.designIntent).trim() || '조건 변형을 통한 개념 전이 이해 확인',
    sourceRefs: asString(parsed.sourceRefs).trim() || '원문 문제 기반 조건 변형',
    evidenceQuote: evidenceQuote || undefined,
    answerEvidenceVerified,
    materialEvidenceVerified: false,
    numericOnlySuspected: looksNumericOnly(context.originalPrompt, promptText),
    mathFormula: asString(parsed.mathFormula).trim() || undefined,
    codeSnippet: asString(parsed.codeSnippet).trim() || undefined,
  };
}

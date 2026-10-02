/**
 * Stage 14: Validation for AI-generated condition-variant (transfer) problems.
 *
 * A transfer problem must actually change the conditions (not just numbers or
 * variable names), keep a 100-point rubric, and stay within the selected concept
 * scope. Unverifiable or invalid output is rejected, never saved as success.
 */

import { ProblemDifficulty, ProblemType, RubricCriterion } from './types';

export interface TransferProblemOutput {
  title: string;
  promptText: string;
  type: ProblemType;
  difficulty: ProblemDifficulty;
  conceptIds: string[];
  transferChanges: string;
  understandingFocus: string;
  timeStandardMinutes: number;
  modelAnswer: string;
  rubric: RubricCriterion[];
  hints: string[];
  designIntent: string;
  sourceRefs: string;
  mathFormula?: string;
  codeSnippet?: string;
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

export interface TransferValidationContext {
  allowedConceptIds: string[];
  allowedTypes: ProblemType[];
  originalPrompt: string;
  originalAnswer: string;
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
  const hints = asStringArray(parsed.hints).map((h) => h.trim()).filter(Boolean);
  const type = asString(parsed.type) as ProblemType;
  const difficulty = (['advanced_college', 'intermediate', 'graduate_challenging'].includes(
    asString(parsed.difficulty)
  )
    ? asString(parsed.difficulty)
    : 'advanced_college') as ProblemDifficulty;

  if (!title || !promptText || !modelAnswer) {
    throw new Error('전이 문제에 필수 항목(제목/지문/모범답안)이 누락되었습니다.');
  }
  if (transferChanges.length < 10 || !understandingFocus) {
    throw new Error('전이 문제에 원문에서 바뀐 조건과 확인하려는 이해 요소가 명시되지 않았습니다.');
  }
  // Must actually differ from the original problem.
  if (normalize(promptText) === normalize(context.originalPrompt)) {
    throw new Error('전이 문제가 원문 문제와 동일합니다. 조건을 실제로 변경해야 합니다.');
  }
  if (!context.allowedTypes.includes(type)) {
    throw new Error('전이 문제 유형이 현재 과목/선택 유형과 일치하지 않습니다.');
  }
  if (hints.length === 0) {
    throw new Error('전이 문제에 단계별 힌트가 없습니다.');
  }

  const conceptIds = asStringArray(parsed.conceptIds).filter((id) =>
    context.allowedConceptIds.includes(id)
  );
  if (conceptIds.length === 0) {
    throw new Error('전이 문제가 선택 개념 범위와 연결되지 않았습니다.');
  }

  const rawRubric = Array.isArray(parsed.rubric) ? parsed.rubric : [];
  const rubric: RubricCriterion[] = rawRubric
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry, idx) => ({
      id: asString(entry.id).trim() || `r-${idx + 1}`,
      label: asString(entry.label).trim() || `${idx + 1}. 평가 항목`,
      maxScore: typeof entry.maxScore === 'number' && entry.maxScore > 0 ? entry.maxScore : 0,
      weight: typeof entry.weight === 'number' ? entry.weight : 0,
      description: asString(entry.description).trim() || '논리적 서술 및 단계별 엄밀성',
    }));

  const scoreSum = rubric.reduce((sum, r) => sum + r.maxScore, 0);
  if (rubric.length < 3 || Math.abs(scoreSum - 100) > 0.001) {
    throw new Error(`전이 문제 루브릭 배점 합계가 100점이 아닙니다. (현재 ${scoreSum}점)`);
  }

  return {
    title,
    promptText,
    type,
    difficulty,
    conceptIds,
    transferChanges,
    understandingFocus,
    timeStandardMinutes:
      typeof parsed.timeStandardMinutes === 'number' && parsed.timeStandardMinutes > 0
        ? Math.min(120, Math.round(parsed.timeStandardMinutes))
        : 20,
    modelAnswer,
    rubric,
    hints,
    designIntent: asString(parsed.designIntent).trim() || '조건 변형을 통한 개념 전이 이해 확인',
    sourceRefs: asString(parsed.sourceRefs).trim() || '원문 문제 기반 조건 변형',
    mathFormula: asString(parsed.mathFormula).trim() || undefined,
    codeSnippet: asString(parsed.codeSnippet).trim() || undefined,
  };
}

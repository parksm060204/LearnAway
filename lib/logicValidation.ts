/**
 * Stage 13: Validation for AI-generated answer-logic questions.
 *
 * The AI must return 2~3 questions, each grounded in the student's actual answer
 * or a rubric criterion. Fabricated mistakes or empty questions are rejected
 * rather than saved as a successful result.
 */

import { LogicQuestion, RubricCriterion } from './types';

export const LOGIC_QUESTION_MIN = 2;
export const LOGIC_QUESTION_MAX = 3;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function validateLogicQuestionsOutput(
  value: unknown,
  rubric: RubricCriterion[]
): LogicQuestion[] {
  const parsed = asRecord(value);
  if (!parsed) throw new Error('AI 질문 결과 형식이 올바르지 않습니다.');

  const rawList = Array.isArray(parsed.questions) ? parsed.questions : [];
  const rubricIds = new Set(rubric.map((c) => c.id));
  const questions: LogicQuestion[] = [];

  for (const raw of rawList) {
    const item = asRecord(raw);
    if (!item) continue;
    const question = asString(item.question).trim();
    if (!question) continue; // never save an empty question

    const linkedCriterionId = asString(item.linkedCriterionId).trim();
    questions.push({
      id: asString(item.id).trim() || `q-${questions.length + 1}`,
      question,
      linkedCriterionId: rubricIds.has(linkedCriterionId) ? linkedCriterionId : undefined,
      linkedQuote: asString(item.linkedQuote).trim() || undefined,
      guidance: asString(item.guidance).trim() || undefined,
    });
  }

  if (questions.length < LOGIC_QUESTION_MIN) {
    throw new Error(
      `AI가 충분한 핵심 질문(${LOGIC_QUESTION_MIN}~${LOGIC_QUESTION_MAX}개)을 생성하지 못했습니다. 다시 시도해 주세요.`
    );
  }

  return questions.slice(0, LOGIC_QUESTION_MAX);
}

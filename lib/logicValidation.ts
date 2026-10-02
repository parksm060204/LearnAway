/**
 * Stage 13/14: Validation for AI-generated answer-logic questions.
 *
 * The AI must return 2~3 questions, each with a UNIQUE id and grounded either in
 * a valid rubric criterion or in a quote that actually appears in the student's
 * answer / the rubric. Fabricated quotes, duplicate ids, duplicate questions and
 * ungrounded questions are rejected rather than saved as a successful result.
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

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function validateLogicQuestionsOutput(
  value: unknown,
  rubric: RubricCriterion[],
  originalAnswer: string
): LogicQuestion[] {
  const parsed = asRecord(value);
  if (!parsed) throw new Error('AI 질문 결과 형식이 올바르지 않습니다.');

  const rawList = Array.isArray(parsed.questions) ? parsed.questions : [];
  const rubricIds = new Set(rubric.map((c) => c.id));
  const rubricText = normalize(
    rubric.map((c) => `${c.label} ${c.description}`).join(' \n ')
  );
  const answerText = normalize(originalAnswer);
  const questions: LogicQuestion[] = [];
  const seenIds = new Set<string>();
  const seenQuestions = new Set<string>();

  for (const raw of rawList) {
    const item = asRecord(raw);
    if (!item) continue;

    const question = asString(item.question).trim();
    if (!question) continue;

    const id = asString(item.id).trim() || `q-${questions.length + 1}`;
    if (seenIds.has(id)) {
      throw new Error('AI 질문 ID가 중복되었습니다. 다시 생성해 주세요.');
    }
    seenIds.add(id);

    const normalizedQuestion = normalize(question);
    if (seenQuestions.has(normalizedQuestion)) {
      throw new Error('AI가 중복된 질문을 생성했습니다. 다시 생성해 주세요.');
    }
    seenQuestions.add(normalizedQuestion);

    const linkedCriterionId = asString(item.linkedCriterionId).trim();
    const linkedQuote = asString(item.linkedQuote).trim();
    const criterionValid = rubricIds.has(linkedCriterionId);
    const quoteVerified =
      linkedQuote.length > 0 &&
      (answerText.includes(normalize(linkedQuote)) || rubricText.includes(normalize(linkedQuote)));

    if (!criterionValid && !quoteVerified) {
      throw new Error(
        '근거 없는 질문이 포함되어 있습니다. 각 질문은 유효한 루브릭 항목 또는 원답안에 실제로 있는 문장과 연결되어야 합니다.'
      );
    }

    questions.push({
      id,
      question,
      linkedCriterionId: criterionValid ? linkedCriterionId : undefined,
      linkedQuote: quoteVerified ? linkedQuote : undefined,
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

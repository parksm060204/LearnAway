import { ErrorType, EvaluationResult, RubricCriterion } from './types';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('평가 결과 형식이 올바르지 않습니다.');
  return value as Record<string, unknown>;
}

export function validateEvaluationRubric(value: unknown): RubricCriterion[] {
  if (!Array.isArray(value) || !value.length) throw new Error('채점 기준이 없습니다.');
  const ids = new Set<string>();
  const rubric = value.map((item, index) => {
    const criterion = object(item);
    const id = typeof criterion.id === 'string' && criterion.id.trim() ? criterion.id : `crit-${index + 1}`;
    if (ids.has(id)) throw new Error('채점 기준 ID가 중복되었습니다.');
    ids.add(id);
    if (typeof criterion.label !== 'string' || !criterion.label.trim() ||
      typeof criterion.maxScore !== 'number' || !Number.isFinite(criterion.maxScore) || criterion.maxScore <= 0) {
      throw new Error('채점 기준의 이름과 배점을 확인해 주세요.');
    }
    return { id, label: criterion.label, maxScore: criterion.maxScore,
      weight: typeof criterion.weight === 'number' ? criterion.weight : 0,
      description: typeof criterion.description === 'string' ? criterion.description : criterion.label };
  });
  if (Math.abs(rubric.reduce((sum, c) => sum + c.maxScore, 0) - 100) > 0.001) {
    throw new Error('채점 기준의 배점 합계는 100점이어야 합니다.');
  }
  return rubric;
}

/** Missing or malformed model output is an API failure, never a student's zero. */
export function validateEvaluationOutput(value: unknown, rubric: RubricCriterion[]): EvaluationResult {
  const parsed = object(value);
  if (!Array.isArray(parsed.rubricResults) || parsed.rubricResults.length !== rubric.length) {
    throw new Error('AI 평가에 누락되거나 불필요한 채점 항목이 있습니다. 다시 평가해 주세요.');
  }
  const results = parsed.rubricResults.map(object);
  const seen = new Set<unknown>();
  for (const result of results) {
    if (seen.has(result.criterionId) || !rubric.some((c) => c.id === result.criterionId)) {
      throw new Error('AI 평가의 채점 기준 ID가 일치하지 않습니다.');
    }
    seen.add(result.criterionId);
  }
  const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
  let needsReview = parsed.needsReview !== false;
  const rubricResults = rubric.map((criterion) => {
    const result = results.find((r) => r.criterionId === criterion.id)!;
    if (typeof result.score !== 'number' || !Number.isFinite(result.score) ||
      result.score < 0 || result.score > criterion.maxScore) {
      throw new Error('AI 평가 점수가 배점 범위를 벗어나거나 유효하지 않습니다.');
    }
    const evidenceQuote = text(result.evidenceQuote);
    if (!evidenceQuote.trim()) needsReview = true;
    return { criterionId: criterion.id, label: criterion.label, score: result.score,
      maxScore: criterion.maxScore, isVulnerable: result.score < criterion.maxScore * 0.7,
      feedback: text(result.feedback, text(result.deductionReason)),
      evidenceQuote: evidenceQuote || 'AI가 평가 근거를 제공하지 않았습니다. 검토가 필요합니다.',
      deductionReason: text(result.deductionReason), improvementTip: text(result.improvementTip) };
  });
  const calculatedScore = Number(rubricResults.reduce((sum, r) => sum + r.score, 0).toFixed(2));
  const errorTypes: ErrorType[] = ['none', 'concept_confusion', 'condition_misinterpretation', 'calc_or_impl_mistake', 'method_selection_error'];
  return { calculatedScore, rubricResults, feedback: text(parsed.feedback, '종합 피드백이 제공되지 않았습니다.'),
    strengths: text(parsed.strengths), criticalImprovements: text(parsed.criticalImprovements),
    recommendedErrorType: errorTypes.includes(parsed.recommendedErrorType as ErrorType)
      ? parsed.recommendedErrorType as ErrorType : calculatedScore >= 90 ? 'none' : 'concept_confusion',
    staticAnalysisNotice: '본 평가는 AI의 정적 분석 및 논증 검토이며, 코드를 실행하거나 동적 테스트하지 않았습니다.',
    needsReview, isAiEvaluated: true };
}

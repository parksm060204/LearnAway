import {
  AcademicErrorType,
  ErrorType,
  EvaluationResult,
  RubricCriterion,
  RubricResult,
  StructuredErrorRecord,
  toAcademicErrorType,
  toLegacyErrorType,
} from './types';

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

export interface ValidateEvaluationOutputOptions {
  conceptId?: string;
  conceptTitle?: string;
  sourceMaterialId?: string;
  userAnswer?: string;
}

/** Missing or malformed model output is an API failure, never a student's zero. */
export function validateEvaluationOutput(
  value: unknown,
  rubric: RubricCriterion[],
  options?: ValidateEvaluationOutputOptions
): EvaluationResult {
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
  const text = (val: unknown, fallback = '') => typeof val === 'string' ? val : fallback;
  let needsReview = parsed.needsReview !== false;
  const rubricResults: RubricResult[] = rubric.map((criterion) => {
    const result = results.find((r) => r.criterionId === criterion.id)!;
    if (typeof result.score !== 'number' || !Number.isFinite(result.score) ||
      result.score < 0 || result.score > criterion.maxScore) {
      throw new Error('AI 평가 점수가 배점 범위를 벗어나거나 유효하지 않습니다.');
    }
    const evidenceQuote = text(result.evidenceQuote);
    if (!evidenceQuote.trim()) needsReview = true;
    return {
      criterionId: criterion.id,
      label: criterion.label,
      score: result.score,
      maxScore: criterion.maxScore,
      isVulnerable: result.score < criterion.maxScore * 0.7,
      feedback: text(result.feedback, text(result.deductionReason)),
      evidenceQuote: evidenceQuote || 'AI가 평가 근거를 제공하지 않았습니다. 검토가 필요합니다.',
      deductionReason: text(result.deductionReason, result.score === criterion.maxScore ? '감점 요인 없음 (만점 기준 충족)' : '부분 감점'),
      improvementTip: text(result.improvementTip, '풀이 과정의 엄밀성을 보완해 주세요.'),
    };
  });

  const calculatedScore = Number(rubricResults.reduce((sum, r) => sum + r.score, 0).toFixed(2));

  // Resolve Canonical Academic Error Type & Legacy Error Type
  const rawError = parsed.academicErrorType || parsed.errorType || parsed.recommendedErrorType;
  let academicErrorType: AcademicErrorType;
  let legacyErrorType: ErrorType;

  if (calculatedScore >= 90) {
    academicErrorType = 'NO_ERROR';
    legacyErrorType = 'none';
  } else if (rawError) {
    academicErrorType = toAcademicErrorType(rawError);
    legacyErrorType = toLegacyErrorType(academicErrorType);
  } else {
    academicErrorType = 'CONCEPT_MISUNDERSTANDING';
    legacyErrorType = 'concept_confusion';
  }

  // Construct or validate Structured Error Record (P03-05)
  let structuredError: StructuredErrorRecord;
  if (parsed.structuredError && typeof parsed.structuredError === 'object' && !Array.isArray(parsed.structuredError)) {
    const rawStructured = parsed.structuredError as Record<string, unknown>;
    const resolvedError = rawStructured.errorType ? toAcademicErrorType(rawStructured.errorType) : academicErrorType;
    const severityRaw = String(rawStructured.severity || '').toLowerCase();
    const severity = (['critical', 'moderate', 'minor', 'none'].includes(severityRaw)
      ? severityRaw
      : calculatedScore >= 90 ? 'none' : calculatedScore < 50 ? 'critical' : calculatedScore < 80 ? 'moderate' : 'minor') as StructuredErrorRecord['severity'];

    structuredError = {
      errorType: calculatedScore >= 90 ? 'NO_ERROR' : resolvedError,
      legacyErrorType: toLegacyErrorType(resolvedError),
      severity: calculatedScore >= 90 ? 'none' : severity,
      conceptId: text(rawStructured.conceptId, options?.conceptId || ''),
      conceptTitle: text(rawStructured.conceptTitle, options?.conceptTitle || ''),
      evidence: text(rawStructured.evidence, text(parsed.criticalImprovements, '답안 확인 완료')),
      feedback: text(rawStructured.feedback, text(parsed.feedback, '보완이 필요합니다.')),
      evaluationVersion: 'p03-eval-v1',
      evaluatedAt: new Date().toISOString(),
    };
  } else {
    structuredError = {
      errorType: academicErrorType,
      legacyErrorType,
      severity: calculatedScore >= 90 ? 'none' : calculatedScore < 50 ? 'critical' : calculatedScore < 80 ? 'moderate' : 'minor',
      conceptId: options?.conceptId || '',
      conceptTitle: options?.conceptTitle || '',
      evidence: text(parsed.criticalImprovements, text(parsed.feedback, '답안 확인 완료')),
      feedback: text(parsed.feedback, '학술 피드백을 확인해 주세요.'),
      evaluationVersion: 'p03-eval-v1',
      evaluatedAt: new Date().toISOString(),
    };
  }

  return {
    calculatedScore,
    rubricResults,
    feedback: text(parsed.feedback, '종합 피드백이 제공되지 않았습니다.'),
    strengths: text(parsed.strengths, '핵심 전개 방향을 성실히 서술했습니다.'),
    criticalImprovements: text(parsed.criticalImprovements, '전제조건 및 세부 식 전개의 엄밀성을 보완해 주세요.'),
    recommendedErrorType: legacyErrorType,
    academicErrorType,
    structuredError,
    staticAnalysisNotice: '본 평가는 AI의 정적 분석 및 논증 검토이며, 코드를 실행하거나 동적 테스트하지 않았습니다.',
    needsReview,
    isAiEvaluated: true,
  };
}

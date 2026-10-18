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
  conceptIds?: string[];
  allowedConceptIds?: string[];
  conceptTitle?: string;
  sourceMaterialId?: string;
  userAnswer?: string;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

const OMISSION_MARKERS = [
  '해당 서술 없음',
  '서술 없음',
  '답안에 없음',
  '언급 없음',
  '미작성',
  '누락',
  '내용 없음',
  'no mention',
  'not mentioned',
  'not stated',
  'omitted',
];

function isOmissionMarker(text: string): boolean {
  const norm = text.toLowerCase();
  return OMISSION_MARKERS.some((marker) => norm.includes(marker));
}

function verifyQuoteInAnswer(quote: string, answer: string): boolean {
  const trimmed = quote.trim();
  if (!trimmed) return false;
  if (isOmissionMarker(trimmed)) return true; // Valid indication that answer omitted the required step
  const normQuote = normalizeText(trimmed);
  const normAnswer = normalizeText(answer);
  return normAnswer.includes(normQuote);
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
  const text = (val: unknown, fallback = '') => (typeof val === 'string' ? val : fallback);
  let needsReview = parsed.needsReview !== false;

  const rubricResults: RubricResult[] = rubric.map((criterion) => {
    const result = results.find((r) => r.criterionId === criterion.id)!;
    if (
      typeof result.score !== 'number' ||
      !Number.isFinite(result.score) ||
      result.score < 0 ||
      result.score > criterion.maxScore
    ) {
      throw new Error('AI 평가 점수가 배점 범위를 벗어나거나 유효하지 않습니다.');
    }
    const evidenceQuote = text(result.evidenceQuote);
    if (!evidenceQuote.trim()) {
      needsReview = true;
    } else if (typeof options?.userAnswer === 'string' && options.userAnswer.trim()) {
      const verified = verifyQuoteInAnswer(evidenceQuote, options.userAnswer);
      if (!verified) {
        needsReview = true;
      }
    }

    return {
      criterionId: criterion.id,
      label: criterion.label,
      score: result.score,
      maxScore: criterion.maxScore,
      isVulnerable: result.score < criterion.maxScore * 0.7,
      feedback: text(result.feedback, text(result.deductionReason)),
      evidenceQuote: evidenceQuote || 'AI가 평가 근거를 제공하지 않았습니다. 검토가 필요합니다.',
      deductionReason: text(
        result.deductionReason,
        result.score === criterion.maxScore ? '감점 요인 없음 (만점 기준 충족)' : '부분 감점'
      ),
      improvementTip: text(result.improvementTip, '풀이 과정의 엄밀성을 보완해 주세요.'),
    };
  });

  const calculatedScore = Number(rubricResults.reduce((sum, r) => sum + r.score, 0).toFixed(2));

  // Resolve Canonical Academic Error Type & Legacy Error Type
  const rawTopError = parsed.academicErrorType || parsed.errorType || parsed.recommendedErrorType;
  const rawStructured = (parsed.structuredError && typeof parsed.structuredError === 'object' && !Array.isArray(parsed.structuredError))
    ? (parsed.structuredError as Record<string, unknown>)
    : null;
  const rawStructuredError = rawStructured?.errorType || rawStructured?.legacyErrorType;

  // Conflict detection between top classification and structured classification
  if (rawTopError && rawStructuredError) {
    const topParsed = toAcademicErrorType(rawTopError);
    const structParsed = toAcademicErrorType(rawStructuredError);
    if (topParsed !== structParsed) {
      needsReview = true;
    }
  }

  let academicErrorType: AcademicErrorType;

  if (calculatedScore === 100) {
    if (rawTopError && toAcademicErrorType(rawTopError) !== 'NO_ERROR') {
      // 100점 만점인데 오류가 발생했다고 분류한 경우 모순 감지
      needsReview = true;
      academicErrorType = toAcademicErrorType(rawTopError);
    } else {
      academicErrorType = 'NO_ERROR';
    }
  } else {
    // 감점이 있는 경우 (< 100점)
    if (rawTopError) {
      const resolved = toAcademicErrorType(rawTopError);
      if (resolved === 'NO_ERROR') {
        // 감점되었는데 오류 없음으로 보고한 경우:
        needsReview = true;
        academicErrorType = calculatedScore < 90 ? 'UNCERTAIN' : 'NO_ERROR';
      } else {
        academicErrorType = resolved;
      }
    } else if (rawStructuredError) {
      academicErrorType = toAcademicErrorType(rawStructuredError);
    } else {
      // 원인 정보가 전혀 없는 경우: 임의로 개념 이해 부족으로 단정하지 말고 UNCERTAIN 처리
      academicErrorType = 'UNCERTAIN';
      needsReview = true;
    }
  }

  const legacyErrorType: ErrorType = toLegacyErrorType(academicErrorType);

  // Validate allowed concept IDs for structured error
  const allowedConceptIds = new Set<string>();
  if (options?.allowedConceptIds && Array.isArray(options.allowedConceptIds)) {
    options.allowedConceptIds.forEach((id) => id && allowedConceptIds.add(id));
  }
  if (options?.conceptIds && Array.isArray(options.conceptIds)) {
    options.conceptIds.forEach((id) => id && allowedConceptIds.add(id));
  }
  if (options?.conceptId) {
    allowedConceptIds.add(options.conceptId);
  }

  let finalConceptId = options?.conceptId || '';
  if (rawStructured?.conceptId && typeof rawStructured.conceptId === 'string' && rawStructured.conceptId.trim()) {
    const candidateId = rawStructured.conceptId.trim();
    if (allowedConceptIds.size > 0 && !allowedConceptIds.has(candidateId)) {
      // 임의/타 개념 ID -> 권위 있는 ID가 아니므로 검토 필요 및 기본 conceptId로 대체
      needsReview = true;
      finalConceptId = options?.conceptId || Array.from(allowedConceptIds)[0] || '';
    } else {
      finalConceptId = candidateId;
    }
  }

  // Validate structured error evidence quote
  const structuredEvidence = rawStructured ? text(rawStructured.evidence) : '';
  if (academicErrorType !== 'NO_ERROR') {
    if (!structuredEvidence.trim()) {
      needsReview = true;
    } else if (typeof options?.userAnswer === 'string' && options.userAnswer.trim()) {
      const verified = verifyQuoteInAnswer(structuredEvidence, options.userAnswer);
      if (!verified) {
        needsReview = true;
      }
    }
  }

  // Determine Severity
  let severity: StructuredErrorRecord['severity'];
  const rawSeverity = rawStructured ? String(rawStructured.severity || '').toLowerCase() : '';
  if (academicErrorType === 'NO_ERROR') {
    severity = 'none';
  } else if (['critical', 'moderate', 'minor'].includes(rawSeverity)) {
    severity = rawSeverity as StructuredErrorRecord['severity'];
  } else if (calculatedScore >= 90) {
    severity = 'minor'; // 90점 이상에서 계산 실수 등은 경미한(minor) 오류
  } else if (calculatedScore < 50) {
    severity = 'critical';
  } else if (calculatedScore < 80) {
    severity = 'moderate';
  } else {
    severity = 'minor';
  }

  const structuredError: StructuredErrorRecord = {
    errorType: academicErrorType,
    legacyErrorType,
    severity,
    conceptId: finalConceptId,
    conceptTitle: text(rawStructured?.conceptTitle, options?.conceptTitle || ''),
    evidence:
      structuredEvidence ||
      (academicErrorType === 'NO_ERROR' ? '답안 확인 완료' : '답안에 해당 서술 없음'),
    feedback: text(
      rawStructured?.feedback,
      text(parsed.feedback, text(parsed.criticalImprovements, '학술 피드백을 확인해 주세요.'))
    ),
    evaluationVersion: 'p03-eval-v1',
    evaluatedAt: new Date().toISOString(),
  };

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

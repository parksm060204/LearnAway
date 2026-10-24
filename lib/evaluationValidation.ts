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
  isProvisionalLocal?: boolean;
}

export const CANONICAL_OMISSION_DIAGNOSES = new Set([
  '답안에 해당 서술 없음',
  '해당 서술 없음',
  '답안에 서술 없음',
  '서술 없음',
  '답안에 없음',
  '언급 없음',
  '답안에 언급 없음',
  '내용 없음',
  '미작성',
  '필요한 서술 누락',
  '필요 서술 누락',
  '조건 누락',
  '누락',
  'no mention',
  'not mentioned',
  'not stated',
  'omitted',
  'omitted in answer',
]);

export function isOmissionDiagnosis(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const cleaned = text
    .trim()
    .replace(/^["'“”‘’([{\s]+|["'“”‘’)}\].;\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return CANONICAL_OMISSION_DIAGNOSES.has(cleaned);
}

export function normalizeWhitespacePreservingCase(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function isQuoteGroundingVerified(quote: string, answer: string): boolean {
  const trimmedQuote = quote.trim();
  const trimmedAnswer = answer.trim();
  if (!trimmedQuote || !trimmedAnswer) return false;

  // Strip wrapping markdown backticks or outer quotes from model quotation
  const unwrappedQuote = trimmedQuote.replace(/^[`"'\s]+|[`"'\s]+$/g, '').trim();
  if (!unwrappedQuote) return false;

  const normQuote = normalizeWhitespacePreservingCase(unwrappedQuote);
  const normAnswer = normalizeWhitespacePreservingCase(trimmedAnswer);

  if (normAnswer.includes(normQuote)) return true;

  // If quote has LaTeX math delimiters like $A = 1$ or $$A = 1$$
  const mathUnwrapped = unwrappedQuote.replace(/^\$+|\$+$/g, '').trim();
  if (mathUnwrapped) {
    const normMath = normalizeWhitespacePreservingCase(mathUnwrapped);
    if (normAnswer.includes(normMath)) return true;
  }

  return false;
}

export function verifyQuoteInAnswer(quote: string, answer: string): boolean {
  const trimmed = quote.trim();
  if (!trimmed) return false;
  if (isOmissionDiagnosis(trimmed)) return true; // Canonical omission diagnosis
  return isQuoteGroundingVerified(trimmed, answer);
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
        // 감점되었는데 오류 없음으로 보고한 경우: 점수와 무관하게 모순 감지 및 UNCERTAIN 처리
        needsReview = true;
        academicErrorType = 'UNCERTAIN';
      } else {
        academicErrorType = resolved;
      }
    } else if (rawStructuredError) {
      const structResolved = toAcademicErrorType(rawStructuredError);
      if (structResolved === 'NO_ERROR') {
        needsReview = true;
        academicErrorType = 'UNCERTAIN';
      } else {
        academicErrorType = structResolved;
      }
    } else {
      // 원인 정보가 전혀 없는 경우: 임의로 개념 이해 부족으로 단정하지 말고 UNCERTAIN 처리
      academicErrorType = 'UNCERTAIN';
      needsReview = true;
    }
  }

  const legacyErrorType: ErrorType = toLegacyErrorType(academicErrorType);

  // Validate allowed concept IDs for structured error
  const hasAuthoritativeSet = Array.isArray(options?.allowedConceptIds);
  const allowedConceptIds = new Set<string>();
  if (hasAuthoritativeSet) {
    // Registered problems: strictly use the concept set authorized by server!
    options!.allowedConceptIds!.forEach((id) => id && allowedConceptIds.add(id));
  } else if (options?.isProvisionalLocal) {
    // Provisional local problems: allow client concept IDs
    if (options.conceptIds && Array.isArray(options.conceptIds)) {
      options.conceptIds.forEach((id) => id && allowedConceptIds.add(id));
    }
    if (options.conceptId) {
      allowedConceptIds.add(options.conceptId);
    }
  }

  // Pick default conceptId within authoritative set if available
  let defaultConceptId = '';
  if (options?.conceptId && allowedConceptIds.has(options.conceptId)) {
    defaultConceptId = options.conceptId;
  } else if (allowedConceptIds.size > 0) {
    defaultConceptId = Array.from(allowedConceptIds)[0];
  } else {
    defaultConceptId = options?.conceptId || '';
  }

  let finalConceptId = defaultConceptId;
  const candidateRaw =
    (rawStructured?.conceptId && typeof rawStructured.conceptId === 'string' && rawStructured.conceptId.trim())
      ? rawStructured.conceptId.trim()
      : (parsed.conceptId && typeof parsed.conceptId === 'string' && parsed.conceptId.trim())
        ? (parsed.conceptId as string).trim()
        : '';

  if (candidateRaw) {
    const candidateId = candidateRaw;
    if (allowedConceptIds.size > 0) {
      if (!allowedConceptIds.has(candidateId)) {
        // Not in server authoritative set! Flag for review and fall back to authorized ID
        needsReview = true;
        finalConceptId = defaultConceptId;
      } else {
        finalConceptId = candidateId;
      }
    } else {
      // No authorized concepts in registered problem: flag review
      if (!options?.isProvisionalLocal) {
        needsReview = true;
      }
      finalConceptId = defaultConceptId || candidateId;
    }
  } else if (allowedConceptIds.size === 0 && !options?.isProvisionalLocal) {
    needsReview = true;
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
    conceptId: finalConceptId,
    staticAnalysisNotice: '본 평가는 AI의 정적 분석 및 논증 검토이며, 코드를 실행하거나 동적 테스트하지 않았습니다.',
    needsReview,
    isAiEvaluated: true,
  };
}

export type Timezone = 'Asia/Seoul';

export type ErrorType =
  | 'none'
  | 'concept_confusion'
  | 'condition_misinterpretation'
  | 'calc_or_impl_mistake'
  | 'method_selection_error';

export const ERROR_TYPE_LABELS: Record<ErrorType, string> = {
  none: '정상 완제 (오류 없음)',
  concept_confusion: '개념 혼동',
  condition_misinterpretation: '조건 해석 오류',
  calc_or_impl_mistake: '계산 / 구현 실수',
  method_selection_error: '방법 선택 오류',
};

// =========================================================================
// Plan 03: Canonical Academic Error Taxonomy (P03-05)
// =========================================================================
export type AcademicErrorType =
  | 'NO_ERROR'
  | 'CONCEPT_MISUNDERSTANDING'
  | 'FORMULA_MISAPPLICATION'
  | 'CALCULATION_ERROR'
  | 'LOGICAL_ERROR'
  | 'CONDITION_OMISSION'
  | 'TERMINOLOGY_ERROR'
  | 'INCOMPLETE_REASONING'
  | 'ANSWER_FORMAT_ERROR'
  | 'UNCERTAIN';

export interface AcademicErrorInfo {
  code: AcademicErrorType;
  label: string;
  description: string;
  legacyType: ErrorType;
}

export const ACADEMIC_ERROR_LABELS: Record<AcademicErrorType, AcademicErrorInfo> = {
  NO_ERROR: {
    code: 'NO_ERROR',
    label: '정상 완제 (오류 없음)',
    description: '핵심 개념, 풀이 전개 및 최종 결론이 학술적으로 타당함',
    legacyType: 'none',
  },
  CONCEPT_MISUNDERSTANDING: {
    code: 'CONCEPT_MISUNDERSTANDING',
    label: '개념 이해 부족',
    description: '핵심 개념의 정의, 성질, 또는 의미를 오해함',
    legacyType: 'concept_confusion',
  },
  FORMULA_MISAPPLICATION: {
    code: 'FORMULA_MISAPPLICATION',
    label: '공식의 잘못된 적용',
    description: '문제 조건에 맞지 않는 정리를 적용하거나 전제조건을 무시함',
    legacyType: 'method_selection_error',
  },
  CALCULATION_ERROR: {
    code: 'CALCULATION_ERROR',
    label: '계산 실수',
    description: '접근법과 논리는 맞으나 중간 산술/대수 계산 및 부호 착오',
    legacyType: 'calc_or_impl_mistake',
  },
  LOGICAL_ERROR: {
    code: 'LOGICAL_ERROR',
    label: '논리 전개 오류',
    description: '단계 간의 인과관계 결여, 순환논증, 또는 논리적 비약',
    legacyType: 'concept_confusion',
  },
  CONDITION_OMISSION: {
    code: 'CONDITION_OMISSION',
    label: '조건 누락',
    description: '문제에 주어진 필수 제약 조건, 정의역, 또는 특수 조건을 간과함',
    legacyType: 'condition_misinterpretation',
  },
  TERMINOLOGY_ERROR: {
    code: 'TERMINOLOGY_ERROR',
    label: '용어 사용 오류',
    description: '학술 용어, 표기법, 또는 기호의 부적절한 사용',
    legacyType: 'concept_confusion',
  },
  INCOMPLETE_REASONING: {
    code: 'INCOMPLETE_REASONING',
    label: '풀이 과정 부족',
    description: '정답만 제시하거나 핵심 증명/유도 단계가 생략됨',
    legacyType: 'concept_confusion',
  },
  ANSWER_FORMAT_ERROR: {
    code: 'ANSWER_FORMAT_ERROR',
    label: '답안 형식 오류',
    description: '요구된 단위, 표현 형태, 또는 제출 양식 미준수',
    legacyType: 'condition_misinterpretation',
  },
  UNCERTAIN: {
    code: 'UNCERTAIN',
    label: '원인 확정 불가',
    description: '답안 서술이 모호하여 오류 원인을 단정할 수 없음',
    legacyType: 'concept_confusion',
  },
};

export function toAcademicErrorType(val: unknown): AcademicErrorType {
  if (typeof val === 'string') {
    const upper = val.toUpperCase().trim();
    if (upper in ACADEMIC_ERROR_LABELS) return upper as AcademicErrorType;
    const lower = val.toLowerCase().trim();
    if (lower === 'none' || lower === 'no_error') return 'NO_ERROR';
    if (lower === 'concept_confusion' || lower === 'concept') return 'CONCEPT_MISUNDERSTANDING';
    if (lower === 'condition_misinterpretation') return 'CONDITION_OMISSION';
    if (lower === 'calc_or_impl_mistake' || lower === 'calculation') return 'CALCULATION_ERROR';
    if (lower === 'method_selection_error' || lower === 'logic') return 'LOGICAL_ERROR';
  }
  return 'UNCERTAIN';
}

export function toLegacyErrorType(val: unknown): ErrorType {
  if (typeof val === 'string') {
    const upper = val.toUpperCase().trim();
    if (upper in ACADEMIC_ERROR_LABELS) {
      return ACADEMIC_ERROR_LABELS[upper as AcademicErrorType].legacyType;
    }
    const lower = val.toLowerCase().trim() as ErrorType;
    if (['none', 'concept_confusion', 'condition_misinterpretation', 'calc_or_impl_mistake', 'method_selection_error'].includes(lower)) {
      return lower;
    }
  }
  return 'concept_confusion';
}

export interface StructuredErrorRecord {
  errorType: AcademicErrorType;
  legacyErrorType: ErrorType;
  severity: 'critical' | 'moderate' | 'minor' | 'none';
  conceptId?: string;
  conceptTitle?: string;
  evidence: string;
  feedback: string;
  evaluationVersion: string;
  evaluatedAt: string;
}

export type ProblemType =
  // Math / Stats types
  | 'essay_descriptive'       // 대학 논술·서술형
  | 'calc_derivation'         // 계산 유도형
  | 'proof_counterexample'    // 증명 및 반례
  | 'error_spotting'          // 오류 검증형
  // Coding / CS types
  | 'impl_descriptive'        // 구현 및 서술형
  | 'algorithm_optimization'  // 알고리즘 최적화 설명
  | 'complexity_proof'        // 시간/공간 복잡도 증명
  | 'debug_counterexample'    // 디버깅 및 반례 분석
  // Plan 03 University Examination Types
  | 'concept_explanation'     // 개념 설명형
  | 'multiple_choice'         // 객관식
  | 'short_answer'            // 단답형
  | 'composite_application';  // 복합 개념 응용형

export type ConceptStatus =
  | 'review_target'   // 복습 대상 (SCORE < 50)
  | 'recommend_d1'    // D+1 권장 (SCORE 50 ~ 65)
  | 'stable'          // 안정 구간 (SCORE 65 ~ 80)
  | 'maintained'      // 유지 상태 (SCORE 80 ~ 90)
  | 'newly_learned'   // 신규 습득 (SCORE >= 90 or 최근 3일 이내)
  | 'unstudied';      // 미학습 (사용자 자료에서 추출 승인되었으나 아직 학습을 시작하지 않음)

export interface Subject {
  id: string;
  ownerId?: string;        // 사용자 계정 연결 확장용 소유자 ID (로그인 미구현)
  name: string;
  code: string;
  semester?: string;
  examAt?: string;          // ISO string e.g. "2026-10-12T10:00:00+09:00", optional
  examEndTime?: string;    // e.g. "12:00"
  location?: string;
  timezone: Timezone;
  scope?: string;
  chapters?: string[];
  lastEvaluatedAt?: string; // ISO string
  engineName?: string;
  domain?: 'math_stats' | 'computer_science';
  isDemo?: boolean;        // 초기 예시 과목 데모 데이터 표기
}

export type MaterialKind = 'pdf' | 'transcript' | 'handout';

export type MaterialConversionStatus = 'ready' | 'converting' | 'failed' | 'needs_review';

export interface MaterialPage {
  pageNumber: number;
  markdown: string;
  hasText: boolean;
  rawText?: string;
}

export interface Material {
  id: string;
  subjectId: string;
  kind: MaterialKind;
  title: string;
  sourceRefs: string;     // e.g. "제3장 조건부분포 p.40 ~ p.58" or "전사본 1~24발화"
  pageCount?: number;
  durationMinutes?: number;
  parsedMarkdown?: string;
  rawText?: string;
  pages?: MaterialPage[];
  status: MaterialConversionStatus;
  statusMessage?: string;
  isConverted: boolean;
  isDemo?: boolean;        // true: 초기 데모 자료, false: 사용자 업로드 자료
  uploadedAt: string;
  lastEditedAt?: string;
  speakerCount?: number;
  speakers?: string[];
  hasAiConcepts?: boolean; // AI 개념 추출 완료 여부 (false면 'AI 개념 미추출')
  hasAiProblems?: boolean; // AI 문제 생성 완료 여부 (false면 'AI 문제 미생성')
  // Local-first storage policy + identity. Missing policy on a legacy material
  // means "keep the existing behaviour" (treated as already synced).
  storagePolicy?: MaterialStoragePolicy;
  originalHash?: string; // hash of the original file (identity / reconnect)
  fileSize?: number;     // original file size in bytes
  // Local-only body identity (hash of the converted markdown). Used to verify a
  // reconnected .md file; never sent to the server (not in the upsert mapping).
  bodyHash?: string;
}

export interface MaterialStoragePolicy {
  /** Upload the converted body (markdown/rawText/pages) to Cloud Storage. */
  syncBody: boolean;
  /** Back up the original PDF to Cloud Storage. */
  backupOriginal: boolean;
}

export interface RubricCriterion {
  id: string;
  label: string;
  maxScore: number;
  weight: number;
  description: string;
}

export interface RubricResult {
  criterionId: string;
  label: string;
  score: number;
  maxScore: number;
  isVulnerable?: boolean;
  feedback?: string;
  evidenceQuote?: string;     // 답안에서 확인한 근거
  deductionReason?: string;   // 감점 이유 (감점 없을 시 "만점 기준 충족")
  improvementTip?: string;    // 개선 및 보완 방법
}

export interface ReviewEvent {
  id: string;
  conceptId: string;
  at: string;             // ISO date e.g. "2026-09-26T15:30:00+09:00"
  dayOffset: number;      // Days relative to reference date (e.g. -9, -6, -2, 0)
  kind: 'initial_study' | 'attempt' | 'review' | 'scheduled' | 'assisted_revision';
  title: string;
  resultScore: number;    // 0 ~ 100
  confidence?: number;    // 1 ~ 5
  errorType?: ErrorType;
  hintCount?: number;
  notes?: string;
  sourceRef: string;
  evaluationSummary?: string;
  rubricScores?: RubricResult[];
  attemptId?: string;
  strengths?: string;
  criticalImprovements?: string;
  needsReview?: boolean;
  solvingReason?: string;
  methodSelectionDiagnosis?: MethodSelectionDiagnosis;
  // Plan 03 fields:
  academicErrorType?: AcademicErrorType;
  structuredError?: StructuredErrorRecord;
  sourceProvenance?: ProblemSourceProvenance;
}

export interface ConceptEvidence {
  type: 'page' | 'transcript_block' | 'section';
  pageNumber?: number;
  blockIndex?: number;
  timestamp?: string;
  speaker?: string;
  quote: string;
  verified: boolean;
  verificationNote?: string;
}

export interface ConceptDraft {
  id: string;
  subjectId: string;
  materialId: string;
  materialTitle?: string;
  title: string;
  domain: 'math_stats' | 'computer_science';
  description: string;
  coreDefinitionFormulaOrAlgorithm?: string;
  prerequisites: string[];
  relatedConcepts: string[];
  commonMisconceptions: string[];
  examples: string[];
  sourceEvidence: ConceptEvidence;
  additionalEvidences?: ConceptEvidence[];
  status: 'draft' | 'approved' | 'rejected';
  isApproved: boolean;
  sourceMarkdownHash: string;
  createdAt: string;
  updatedAt: string;
  editedByUser?: boolean;
  needsSourceReview?: boolean;
  // Server-authoritative contract fields (present when loaded from Supabase).
  contentVersion?: number;
  approvalState?: 'pending' | 'approved' | 'failed';
  approvedConceptId?: string;
}

export interface Concept {
  id: string;
  subjectId: string;
  materialIds: string[];
  title: string;
  chapterRef: string;
  firstLearnedAt?: string;
  firstLearnedDayOffset?: number;
  lastAttemptAt?: string;
  lastAttemptDayOffset?: number;
  baseScore: number;
  currentScore: number;
  status: ConceptStatus;
  order: number;
  events: ReviewEvent[];
  exerciseCount: number;
  isDemo?: boolean;       // true: 데모 개념, false: 사용자 자료 추출 개념
  isLearned?: boolean;    // 사용자가 '학습 완료'로 표시했는지 여부
  description?: string;
  coreDefinitionFormulaOrAlgorithm?: string;
  prerequisites?: string[];
  relatedConcepts?: string[];
  commonMisconceptions?: string[];
  examples?: string[];
  sourceEvidence?: ConceptEvidence;
  draftId?: string;
  needsSourceReview?: boolean;
  // Stage 5 fields: Spaced repetition recommendation & postpone tracking
  postponeDays?: number;         // 미루기 누적 일수 (기본 0)
  postponedUntil?: string;       // 미루기 적용 목표 일자 (ISO 또는 YYYY-MM-DD)
  recommendedReviewAt?: string;  // 계산된 다음 권장 복습 시각 (ISO)
  lastCalculatedAt?: string;     // 최근 스케줄 계산 시각
  // Plan 04: Mastery vs Retention separation
  masteryScore?: number;         // 개념 이해 및 적용 숙련도 (0~100)
  retentionScore?: number;       // 현재 기억 회상 유지율 (0~100, currentScore와 동등)
}

// =========================================================================
// Plan 04: Adaptive Review Problem Kinds (Types A ~ E) & Explainability
// =========================================================================
export type RecommendedPracticeKind =
  | 'original_rechallenge'   // 유형 A: 원문제 재도전
  | 'similar_problem'        // 유형 B: 유사 개념 문제 (기본/표준)
  | 'variant_problem'        // 유형 C: 조건 변형 문제 (조건/수치 변경)
  | 'transfer_problem'       // 유형 D: 전이 이해 문제 (상황 전이)
  | 'composite_application'; // 유형 E: 복합 개념 응용

export interface RecommendedPracticeKindInfo {
  kind: RecommendedPracticeKind;
  label: string;
  shortLabel: string;
  typeCode: string;
  description: string;
}

export const RECOMMENDED_PRACTICE_KIND_LABELS: Record<RecommendedPracticeKind, RecommendedPracticeKindInfo> = {
  original_rechallenge: {
    kind: 'original_rechallenge',
    label: '유형 A: 원문제 재도전',
    shortLabel: '원문제 재도전',
    typeCode: 'Type A',
    description: '오답 원인 분석 후 원문제를 가리고 독립적으로 재해결',
  },
  similar_problem: {
    kind: 'similar_problem',
    label: '유형 B: 유사 개념 문제',
    shortLabel: '유사 문제',
    typeCode: 'Type B',
    description: '동일 개념의 표준 난이도 문제로 기본 이해 및 풀이 절차 강화',
  },
  variant_problem: {
    kind: 'variant_problem',
    label: '유형 C: 조건 변형 문제',
    shortLabel: '변형 문제',
    typeCode: 'Type C',
    description: '문제 조건이나 풀이 경로를 일부 변형하여 논리 전개 유연성 확인',
  },
  transfer_problem: {
    kind: 'transfer_problem',
    label: '유형 D: 전이 이해 문제',
    shortLabel: '전이 문제',
    typeCode: 'Type D',
    description: '기존 개념을 새로운 맥락이나 제약에 적용하여 전이 능력 검증',
  },
  composite_application: {
    kind: 'composite_application',
    label: '유형 E: 복합 개념 응용',
    shortLabel: '복합 응용',
    typeCode: 'Type E',
    description: '복수 개념을 결합해 다단계 추론을 요구하는 대학 시험 실전 문제',
  },
};

export interface ReviewExplanationDetails {
  whyPriority: string;       // 왜 이 개념이 우선순위인가?
  whyDateMoved: string;      // 왜 복습 날짜가 앞당겨졌는가? (또는 조정되었는가?)
  whyProblemType: string;    // 왜 특정 문제 유형이 추천되었는가?
  dailyWorkload: string;     // 오늘의 학습량이 얼마나 되는가?
}

export interface ReviewRecommendation {
  conceptId: string;
  recommendedAt: string;          // ISO string e.g. "2026-09-30T10:00:00+09:00"
  recommendedDateStr: string;     // YYYY-MM-DD in Asia/Seoul
  daysUntilReview: number;        // negative = overdue, 0 = today, positive = future days
  urgencyScore: number;           // Higher score = higher priority
  priorityScore?: number;         // Higher score = higher priority (alias to urgencyScore)
  priorityRank: number;           // Deterministic rank 1, 2, 3...
  priorityReason: string;         // Human-readable rationale
  isDueTodayOrOverdue: boolean;   // true if daysUntilReview <= 0
  factors: {
    lastScore: number;
    elapsedDays: number;
    effectiveTau: number;
    confidenceFactor: number;
    hintPenalty: number;
    vulnerableCriterionCount: number;
    examProximityWeight: number;
    postponeDays: number;
    masteryScore?: number;
    dependencyRiskScore?: number;
  };
  // Plan 04 fields:
  masteryScore?: number;          // 개념 숙련도 (0~100)
  retentionScore?: number;        // 기억 유지율 (0~100)
  recommendedPracticeKind?: RecommendedPracticeKind; // 추천 문제 유형 (유형 A~E)
  explanationDetails?: ReviewExplanationDetails;     // 4대 핵심 질문 규칙 기반 설명
  // Stage 10 fields: personal review-interval adjustment layer
  baseIntervalDays?: number;        // 모델이 산출한 기본 권장 간격(일)
  intervalMultiplier?: number;      // 개인별 보정 배율 (1.0 = 기본)
  isPersonalized?: boolean;         // 개인별 보정이 실제로 적용되었는지
  personalizationNote?: string;     // 개인별 보정 사유 (데이터 부족/조정 방향 등)
}

export type ProblemDifficulty = 'advanced_college' | 'intermediate' | 'graduate_challenging';

export const PROBLEM_DIFFICULTY_LABELS: Record<ProblemDifficulty, string> = {
  advanced_college: '고난도·대학 학부 시험 수준 (기본)',
  intermediate: '중간고사 표준형 (응용 및 개념 통합)',
  graduate_challenging: '대학원·심화 도전형 (일반화 및 엄밀 증명)',
};

// =========================================================================
// Plan 03: 5-Level Academic Difficulty (P03-03)
// =========================================================================
export type AcademicDifficultyLevel = 1 | 2 | 3 | 4 | 5;

export interface AcademicDifficultyInfo {
  level: AcademicDifficultyLevel;
  label: string;
  shortName: string;
  description: string;
  legacyDifficulty: ProblemDifficulty;
}

export const ACADEMIC_DIFFICULTY_LEVELS: Record<AcademicDifficultyLevel, AcademicDifficultyInfo> = {
  1: {
    level: 1,
    label: 'Level 1 — 기초 (정의·공식·기본 개념)',
    shortName: 'Level 1 (기초)',
    description: '정의, 공식, 기본 개념을 정확히 이해했는지 확인',
    legacyDifficulty: 'intermediate',
  },
  2: {
    level: 2,
    label: 'Level 2 — 적용 (단일 개념·공식 적용)',
    shortName: 'Level 2 (적용)',
    description: '하나의 개념이나 공식을 실제 문제 상황에 직접 적용',
    legacyDifficulty: 'intermediate',
  },
  3: {
    level: 3,
    label: 'Level 3 — 응용 (조건 해석·다단계 전개)',
    shortName: 'Level 3 (응용)',
    description: '조건을 해석하고 둘 이상의 풀이 단계를 체계적으로 수행',
    legacyDifficulty: 'advanced_college',
  },
  4: {
    level: 4,
    label: 'Level 4 — 복합 (다중 개념 융합)',
    shortName: 'Level 4 (복합)',
    description: '여러 개념을 연결하고 새로운 조건에 합성하여 적용',
    legacyDifficulty: 'advanced_college',
  },
  5: {
    level: 5,
    label: 'Level 5 — 고난도 (엄밀 증명·복합 추론)',
    shortName: 'Level 5 (고난도)',
    description: '복합적 추론, 엄밀 증명, 계산 및 일반화·반례 분석 수행',
    legacyDifficulty: 'graduate_challenging',
  },
};

export function toAcademicDifficultyLevel(val: unknown): AcademicDifficultyLevel {
  if (typeof val === 'number' && Number.isFinite(val)) {
    if (val <= 1) return 1;
    if (val >= 5) return 5;
    const rounded = Math.round(val);
    if ([1, 2, 3, 4, 5].includes(rounded)) return rounded as AcademicDifficultyLevel;
  }
  if (typeof val === 'string') {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) {
      if (parsed <= 1) return 1;
      if (parsed >= 5) return 5;
      return parsed as AcademicDifficultyLevel;
    }
    const lower = val.toLowerCase().trim();
    if (lower === 'easy' || lower === 'basic') return 1;
    if (lower === 'intermediate' || lower === 'standard') return 2;
    if (lower === 'medium' || lower === 'advanced_college' || lower === 'advanced') return 3;
    if (lower === 'challenging' || lower === 'applied') return 4;
    if (lower === 'hard' || lower === 'graduate_challenging' || lower === 'research') return 5;
  }
  return 3;
}

export type SourceVerificationStatus = 'verified' | 'unverified' | 'needs_review';

export interface ProblemSourceProvenance {
  sourceMaterialId?: string;
  sourceConceptIds?: string[];
  sourcePage?: string;
  sourceExcerpt?: string;
  sourceContentVersion?: string;
  sourceVerificationStatus?: SourceVerificationStatus;
}

/** Stage 11: per-material source reference captured at generation time. */
export interface ProblemSourceRef {
  materialId: string;
  title: string;
  markdownHash: string; // 생성 당시 해당 자료 본문 해시
}

export interface ProblemDraftVerification {
  hasRequiredFields: boolean;
  isScore100: boolean;
  scoreSum: number;
  hasConceptLink: boolean;
  isSourceVerified: boolean;
  note?: string;
}

export interface ProblemDraft {
  id: string;
  subjectId: string;
  conceptIds: string[];
  conceptTitles: string[];
  title: string;
  type: ProblemType;
  difficulty: ProblemDifficulty;
  categoryLabel: string;
  categoryNumber: number;
  promptText: string;
  mathFormula?: string;
  codeSnippet?: string;
  designIntent: string;           // 출제 의도 및 배경
  appliedConditionNote?: string;   // 원문에 없는 새 상황은 AI가 설계한 응용 조건임을 명시
  sourceRefs: string;              // 학습 자료 출처
  sourceEvidenceQuote?: string;    // 원문 인용 근거
  sourceMarkdownHash?: string;     // 분석/생성에 참조된 자료 버전 해시 (하위 호환)
  sourceMaterials?: ProblemSourceRef[]; // 자료별 출처 ID·제목·생성 당시 본문 해시
  // Stage 14/15: 조건 변형·전이 문제 (구조화된 변형 정보)
  isTransfer?: boolean;
  sourceProblemId?: string;
  logicSessionId?: string;
  transferChanges?: string;   // 원문에서 바뀐 조건 설명(요약)
  understandingFocus?: string; // 확인하려는 이해 요소
  transferKind?: string;      // 변형 유형 (예: precondition_change, counterexample, cross_concept, complexity_change ...)
  originalCondition?: string; // 원래 조건
  newCondition?: string;      // 바뀐 조건
  timeStandardMinutes: number;
  timeBreakdownDesc: string;
  coreEvaluationHighlight: string;
  itemCountDesc: string;
  hints: string[];
  modelAnswer: string;
  rubric: RubricCriterion[];       // 합계 100점
  status: 'draft' | 'needs_review' | 'approved' | 'rejected';
  isApproved: boolean;
  isDemo?: boolean;
  verificationStatus: ProblemDraftVerification;
  createdAt: string;
  updatedAt: string;
  editedByUser?: boolean;
  // Server-authoritative contract fields (present when loaded from Supabase).
  contentVersion?: number;
  approvalState?: 'pending' | 'approved' | 'failed';
  approvedProblemId?: string;
  // Plan 03 academic assessment fields:
  difficultyLevel?: AcademicDifficultyLevel;
  sourceMaterialId?: string;
  sourceConceptIds?: string[];
  sourcePage?: string;
  sourceExcerpt?: string;
  sourceContentVersion?: string;
  sourceVerificationStatus?: SourceVerificationStatus;
  needsSourceReview?: boolean;
  isOutdated?: boolean;
}

export interface Problem {
  id: string;
  conceptIds: string[];
  subjectId: string;
  title: string;
  type: ProblemType;
  categoryLabel: string;
  categoryNumber: number;
  promptText: string;
  mathFormula?: string;
  codeSnippet?: string;
  timeStandardMinutes: number;
  timeBreakdownDesc: string;
  coreEvaluationHighlight: string;
  itemCountDesc: string;
  sourceRefs: string;
  hints: string[];
  modelAnswer: string;
  rubric: RubricCriterion[];
  // Stage 3 fields:
  isDemo?: boolean;              // true: 0단계 데모 문제, false: AI 생성 승인 문제
  isApproved?: boolean;          // 승인 완료 플래그
  draftId?: string;              // 연계 초안 ID
  difficulty?: ProblemDifficulty;
  designIntent?: string;         // 출제 의도
  appliedConditionNote?: string; // AI 설계 응용 조건
  sourceMarkdownHash?: string;   // 생성 당시 원문 해시
  isOutdated?: boolean;          // 원문 Markdown 사후 수정 시 구버전 플래그
  createdAt?: string;
}

// Stage 6: Problem Quality, Reporting, Versioning & Review Types
export type ProblemReportType =
  | 'missing_or_vague_condition'       // 조건 누락·모호함
  | 'incorrect_model_answer'          // 모범 답안 오류
  | 'rubric_error'                    // 채점 기준 오류
  | 'source_mismatch'                 // 출처 불일치
  | 'multiple_answers_possible'       // 복수 정답 가능성
  | 'inappropriate_difficulty_or_scope' // 난도·범위 부적합
  | 'other';                          // 기타

export const PROBLEM_REPORT_TYPE_LABELS: Record<ProblemReportType, string> = {
  missing_or_vague_condition: '조건 누락·모호함',
  incorrect_model_answer: '모범 답안 오류',
  rubric_error: '채점 기준 오류',
  source_mismatch: '출처 불일치',
  multiple_answers_possible: '복수 정답 가능성',
  inappropriate_difficulty_or_scope: '난도·범위 부적합',
  other: '기타',
};

export type ProblemQualityStatus =
  | 'normal'              // 정상
  | 'reported'            // 신고 접수
  | 'under_review'        // 검토 중
  | 'review_after_edit'   // 수정 후 재검토
  | 'reapproved'          // 재승인
  | 'suspended';          // 사용 중지

export const PROBLEM_QUALITY_STATUS_LABELS: Record<ProblemQualityStatus, string> = {
  normal: '정상',
  reported: '신고 접수',
  under_review: '검토 중',
  review_after_edit: '수정 후 재검토',
  reapproved: '재승인',
  suspended: '사용 중지',
};

export type ProblemReportStatus = 'open' | 'under_review' | 'resolved' | 'dismissed';

export interface ProblemReport {
  id: string;
  problemId: string;
  attemptId?: string;
  type: ProblemReportType;
  details: string;
  createdAt: string;
  status: ProblemReportStatus;
  resolutionNote?: string;
  resolvedAt?: string;
}

export interface ProblemVersionSnapshot {
  version: number;
  title: string;
  promptText: string;
  type?: ProblemType;
  conceptIds?: string[];
  appliedConditionNote?: string;
  mathFormula?: string;
  codeSnippet?: string;
  timeStandardMinutes?: number;
  hints: string[];
  modelAnswer: string;
  rubric: RubricCriterion[];
  editedAt: string;
  editReason?: string;
  difficultyLevel?: AcademicDifficultyLevel;
  sourceMaterialId?: string;
  sourceConceptIds?: string[];
  sourceExcerpt?: string;
  sourcePage?: string;
  sourceContentVersion?: string;
  sourceVerificationStatus?: SourceVerificationStatus;
}

export interface UnsavedProblemRevision {
  problemId: string;
  revisionId?: string;
  generation?: number;
  baseVersion: number;
  revisionVersion: number;
  title: string;
  promptText: string;
  mathFormula?: string;
  codeSnippet?: string;
  hints: string[];
  modelAnswer: string;
  rubric: RubricCriterion[];
  timeStandardMinutes?: number;
  editReason: string;
  revisedAt: string;
  syncStatus: 'pending' | 'syncing' | 'failed' | 'conflict' | 'synced';
  syncError?: string;
  baseSnapshot?: ProblemVersionSnapshot;
}

export interface ConceptScheduleAdjustment {
  conceptId: string;
  postponeDays: number;
  postponedUntil?: string;
  updatedAt: string;
}

export type AttemptSaveStatus =
  | 'complete'           // 저장 및 모든 링크 정상 반영
  | 'retryable_failure'  // Attempt/ReviewEvent/Plan 반영 실패 -> 동일 payload 재시도 권장
  | 'link_conflict'      // 계획이 이미 다른 Attempt로 완료됨 / 불일치 -> 사용자 확인 필요
  | 'target_missing'     // 대상 계획을 찾을 수 없거나 건너뜀 -> 계획 없이 저장 가능
  | 'already_completed'; // 동일 Attempt의 재시도 (이미 완료)

export function isProblemAvailableForPractice(problem: Problem): boolean {
  const status = problem.qualityStatus || 'normal';
  return problem.isApproved !== false && !problem.isOutdated &&
    (status === 'normal' || status === 'reapproved');
}

export interface ProblemQualityRuleCheck {
  hasRequiredFields: boolean;
  isRubric100: boolean;
  rubricSum: number;
  isSourceVerified: boolean;
  details: string;
}

export interface ProblemQualityReviewResult {
  isReportJustified: boolean;
  severity: 'critical' | 'moderate' | 'minor' | 'none';
  recommendation: 'edit_required' | 'suspend' | 'dismiss_report';
  analysisSummary: string;
  suggestedFixes?: string;
  ruleChecks: ProblemQualityRuleCheck;
  canAutoReapprove: false; // Explicit invariant: AI cannot auto-reapprove
}

export interface Problem {
  id: string;
  conceptIds: string[];
  subjectId: string;
  title: string;
  type: ProblemType;
  categoryLabel: string;
  categoryNumber: number;
  promptText: string;
  mathFormula?: string;
  codeSnippet?: string;
  timeStandardMinutes: number;
  timeBreakdownDesc: string;
  coreEvaluationHighlight: string;
  itemCountDesc: string;
  sourceRefs: string;
  hints: string[];
  modelAnswer: string;
  rubric: RubricCriterion[];
  // Stage 3 fields:
  isDemo?: boolean;              // true: 0단계 데모 문제, false: AI 생성 승인 문제
  isApproved?: boolean;          // 승인 완료 플래그
  draftId?: string;              // 연계 초안 ID
  difficulty?: ProblemDifficulty;
  designIntent?: string;         // 출제 의도
  appliedConditionNote?: string; // AI 설계 응용 조건
  sourceMarkdownHash?: string;   // 생성 당시 원문 해시 (하위 호환)
  sourceMaterials?: ProblemSourceRef[]; // 자료별 출처 ID·제목·생성 당시 본문 해시
  // Stage 14/15: 조건 변형·전이 문제 (구조화된 변형 정보)
  isTransfer?: boolean;
  sourceProblemId?: string;
  logicSessionId?: string;
  transferChanges?: string;
  understandingFocus?: string;
  transferKind?: string;
  originalCondition?: string;
  newCondition?: string;
  isOutdated?: boolean;          // 원문 Markdown 사후 수정 시 구버전 플래그
  needsSourceReview?: boolean;   // 출처 불명확(자료별 해시 없음)으로 사용자 확인 필요
  createdAt?: string;
  // Stage 6 fields:
  version?: number;                      // 문제 버전 (기본 1)
  qualityStatus?: ProblemQualityStatus;  // 품질 검토 상태 (정상, 신고 접수, 검토 중, 수정 후 재검토, 재승인, 사용 중지)
  reports?: ProblemReport[];             // 누적 신고 기록
  versionHistory?: ProblemVersionSnapshot[]; // 이전 버전 스냅샷 이력
  lastReviewedAt?: string;               // 최근 검토 시각
  reviewNotes?: string;                  // 검토/처리 메모
  // Plan 03 academic assessment fields:
  difficultyLevel?: AcademicDifficultyLevel;
  sourceMaterialId?: string;
  sourceConceptIds?: string[];
  sourcePage?: string;
  sourceExcerpt?: string;
  sourceContentVersion?: string;
  sourceVerificationStatus?: SourceVerificationStatus;
}

// Stage 8: Solving Reason Explanation & Method Selection Diagnosis
export type MethodReasonCriterionKey =
  | 'appropriate_method'         // 적절한 방법 선택
  | 'precondition_understanding'  // 전제조건 이해
  | 'constraint_alignment'       // 문제의 제약과의 연결
  | 'alternatives_limitations';   // 대안·한계 인식

export type MethodReasonRating =
  | 'proficient'        // 충분
  | 'partially_met'     // 부분 충족
  | 'needs_improvement' // 보완 필요
  | 'not_applicable';   // 평가 불가

export const METHOD_REASON_CRITERION_LABELS: Record<MethodReasonCriterionKey, string> = {
  appropriate_method: '적절한 방법 선택',
  precondition_understanding: '전제조건 이해',
  constraint_alignment: '문제의 제약과의 연결',
  alternatives_limitations: '대안·한계 인식',
};

export const METHOD_REASON_RATING_LABELS: Record<MethodReasonRating, string> = {
  proficient: '충분',
  partially_met: '부분 충족',
  needs_improvement: '보완 필요',
  not_applicable: '평가 불가',
};

export interface MethodReasonCriterionResult {
  key: MethodReasonCriterionKey;
  label: string;
  rating: MethodReasonRating;
  evidence: string;      // 학생 답안 또는 이유 설명에서 확인한 근거 인용
  feedback: string;      // 구체적 첨삭 및 평가 피드백
}

export interface MethodSelectionDiagnosis {
  isApplicable: boolean;                 // 문제 유형 및 풀이 접근상 방법 선택 평가 가능 여부
  applicabilityAssessment: string;       // AI의 평가 가능 여부 판단 및 사유
  criteria: MethodReasonCriterionResult[]; // 4개 항목 진단 결과
  summary: string;                       // 방법 선택 이유 종합 진단 요약
  suggestedImprovements: string[];       // 구체적인 보완 문장 제안
  nextConceptsToReview: string[];        // 다음에 확인할 개념 제안
  evaluatedAt: string;                   // 진단 일시 (ISO 문자열)
}

export interface EvaluationResult {
  calculatedScore: number;
  rubricResults: RubricResult[];
  feedback: string;
  strengths: string;
  criticalImprovements: string;
  recommendedErrorType: ErrorType;
  staticAnalysisNotice: string;
  needsReview: boolean;
  isAiEvaluated: boolean;
  qualityStatusNotice?: string;
  // Stage 8 field:
  methodSelectionDiagnosis?: MethodSelectionDiagnosis;
  // Plan 03 fields:
  academicErrorType?: AcademicErrorType;
  structuredError?: StructuredErrorRecord;
  sourceProvenance?: ProblemSourceProvenance;
  conceptId?: string;
}

export interface Attempt {
  id: string;
  problemId: string;
  conceptId: string;
  conceptIds?: string[];           // 다중 개념 연결 목록
  subjectId: string;
  at: string;
  answer: string;
  confidence: number;
  errorType: ErrorType;
  hintCount: number;
  reasoningNotes: string;
  calculatedScore: number;
  rubricResults: RubricResult[];
  evaluatorFeedback: string;
  strengths?: string;
  criticalImprovements?: string;
  staticAnalysisNotice?: string;
  needsReview?: boolean;
  isAiEvaluated?: boolean;         // 실제 AI 평가 여부
  modelAnswerSnapshot?: string;    // 풀이 당시 모범 답안 스냅샷
  problemTitleSnapshot?: string;   // 풀이 당시 문제 제목 스냅샷
  problemPromptSnapshot?: string;  // 풀이 당시 문제 지문 스냅샷
  // Stage 6 fields:
  problemVersion?: number;         // 풀이 당시 문제 버전 (기본 1)
  rubricSnapshot?: RubricCriterion[]; // 풀이 당시 루브릭 기준 스냅샷
  mockExamSessionId?: string;
  // Stage 8 fields:
  solvingReason?: string;                  // 학생이 작성한 방법 선택 이유 원문
  isReasonNotApplicable?: boolean;         // '해당 없음' 선택 여부
  reasonNotApplicableJustification?: string; // 해당 없음 사유
  methodSelectionDiagnosis?: MethodSelectionDiagnosis; // 방법 선택 이유 진단 결과
  // Stage 13 fields: answer-logic strengthening provenance
  attemptOrigin?: 'independent' | 'assisted_revision' | 'rechallenge'; // 기본 independent
  logicSessionId?: string;                 // 논리 강화 세션에서 생성된 보완 답안
  sourceAttemptId?: string;                // 보완/재도전의 원본 Attempt ID
  rechallengeReservationId?: string;       // 재도전 예약에서 생성된 기록
  // Stage 14 fields:
  isTransfer?: boolean;                    // 조건 변형·전이 문제 풀이 여부
  sourceProblemId?: string;                // 전이 문제의 원본 문제 ID
  planItemId?: string;                     // 실행한 학습 계획 항목 ID
  modelAnswerRevealed?: boolean;           // 풀이 중 모범답안을 열람했는지
  helpUsage?: 'independent' | 'hints' | 'model_answer' | 'assisted'; // 도움 사용 여부
  // Plan 03 fields:
  academicErrorType?: AcademicErrorType;
  structuredError?: StructuredErrorRecord;
  sourceProvenance?: ProblemSourceProvenance;
}

export interface MockExamSession {
  id: string;
  subjectId: string;
  createdAt: string;
  endsAt: string;
  submittedAt?: string;
  durationMinutes: number;
  status: 'in_progress' | 'submitted' | 'graded' | 'recorded' | 'abandoned';
  selectedConceptIds: string[];
  selectedTypes: ProblemType[];
  problems: Problem[]; // 시험 시작 당시 고정된 문제·정답·채점 기준
  answers: Record<string, string>;
  evaluations: Record<string, EvaluationResult>;
  recordedAttemptIds?: string[];
  // Stage 8 fields:
  reasons?: Record<string, string>; // 문항별 방법 선택 이유
  isReasonNotApplicable?: Record<string, boolean>; // 문항별 해당 없음 선택 여부
  reasonNotApplicableJustification?: Record<string, string>; // 문항별 해당 없음 사유
  /** Server-authoritative optimistic-lock version. Not part of the exam content. */
  serverVersion?: number;
  /** Server-authoritative last-modified time (from the cloud row). */
  serverUpdatedAt?: string;
}

export interface RetentionModelSettings {
  tau: number;       // Base time constant (days), e.g. 3.5
  alpha: number;     // Power law exponent, e.g. 0.45
  threshold: number; // Critical review threshold score, e.g. 50.0
}

// =========================================================================
// Stage 13: Answer-Logic Strengthening Session & Delayed Rechallenge
// =========================================================================

export interface LogicQuestion {
  id: string;
  question: string;
  linkedCriterionId?: string; // 연결된 루브릭 기준 ID
  linkedQuote?: string;       // 실제 답안/루브릭에서 확인한 근거 인용
  guidance?: string;          // 답변 시 고려할 방향(정답 아님)
}

/** 질문 세트 버전 (재생성 시 이력으로 보존, 이전 응답이 새 질문에 붙지 않도록 구분) */
export interface LogicQuestionSet {
  version: number;
  questions: LogicQuestion[];
  answers: Record<string, string>;
  generatedAt: string;
  model?: string;
  inputHash: string;
}

export type LogicSessionStatus =
  | 'draft'              // 세션 생성, 질문 미생성
  | 'questions_ready'    // AI 질문 생성 완료
  | 'revised_evaluated'  // 보완 답안 평가 완료(확정 전)
  | 'completed';         // 보완 답안 확정 저장 완료

export interface LogicStrengthenSession {
  id: string;
  subjectId: string;
  conceptId: string;
  problemId: string;
  problemVersion: number;
  sourceAttemptId: string;
  createdAt: string;
  updatedAt: string;
  status: LogicSessionStatus;

  // 문제/평가 스냅샷 (원본 Attempt 보존, 재평가하지 않음)
  problemTitleSnapshot: string;
  problemPromptSnapshot: string;
  modelAnswerSnapshot: string;
  // 문제 조건/수식/코드 스냅샷 (현재 문제와 섞지 않기 위해 세션에 고정)
  problemFormulaSnapshot?: string;
  problemCodeSnapshot?: string;
  problemConditionNoteSnapshot?: string;
  rubricSnapshot: RubricCriterion[];
  sourceMarkdownHash?: string;
  sourceMaterials?: ProblemSourceRef[];
  sessionRound: number;             // 보완 회차 (질문 세트 버전과 분리)

  originalAnswer: string;
  originalScore: number;
  originalRubricResults: RubricResult[];
  originalSolvingReason?: string;
  originalIsReasonNotApplicable?: boolean;
  originalDiagnosisSummary?: string;

  // AI 생성 질문 (2~3개) + 세트 버전/이력
  questions: LogicQuestion[];
  questionsGeneratedAt?: string;
  questionsModel?: string;
  questionsInputHash?: string;      // 재사용 판단용 입력 해시
  questionSetVersion: number;       // 현재 질문 세트 버전 (1부터)
  questionSets: LogicQuestionSet[]; // 이전 세트(질문+응답) 이력

  // 학생 응답 및 보완 답안
  questionAnswers: Record<string, string>;
  revisedAnswer: string;
  revisedEvaluation?: EvaluationResult;
  revisedEvaluatedAt?: string;
  revisedEvaluatedAnswer?: string;       // 평가 시점의 답안 스냅샷
  revisedEvaluationInputHash?: string;   // 평가 시점 입력 해시
  revisedAttemptId?: string; // 확정 시 생성된 별도 Attempt

  // Stage 14/15: 전이 문제 초안 연결
  transferDraftId?: string;
  transferDraftVersion?: number;    // 전이 초안 버전 (재생성 구분)
  transferInputHash?: string;       // 동일 입력 재사용 판단용
}

export type RechallengeReservationStatus = 'scheduled' | 'completed' | 'cancelled';

export interface RechallengeReservation {
  id: string;
  subjectId: string;
  subjectName: string;
  conceptId: string;
  problemId: string;
  problemVersion: number;
  problemTitle?: string;
  problemType?: ProblemType;
  scheduledDate: string; // YYYY-MM-DD (Asia/Seoul)
  estimatedMinutes: number;
  createdAt: string;
  status: RechallengeReservationStatus;
  sourceLogicSessionId?: string;
  sourceAttemptId?: string;
  isTransfer?: boolean; // 전이 문제 예약 여부
  completedAttemptId?: string; // 완료 처리 시 연결된 Attempt (덮어쓰지 않음)
  completedAt?: string;
  note?: string;
}

// Stage 9: Exam Date-Driven Study Plan Types
export type StudyPlanItemKind =
  | 'initial_study'       // 최초 학습: 미학습 개념 원문/설명
  | 'recommended_review'  // 권장 복습: 복습 기한 경과 또는 오늘 복습 필요
  | 'vulnerability_fix'   // 취약점 보완: 최근 오답 및 취약 루브릭 보완 문제풀이
  | 'mixed_mock_exam'     // 혼합 모의시험: 종합 평가
  | 'rechallenge';        // 지연 재도전: 보완 후 독립적으로 다시 풀기 예약

export type StudyPlanItemStatus =
  | 'pending'     // 미완료
  | 'in_progress' // 진행 중 (예: 모의시험 진행 중)
  | 'completed'   // 완료 (실제 Attempt/ReviewEvent/MockExam 기록 완료)
  | 'postponed'   // 내일로 미룸
  | 'skipped';    // 이번 계획에서 건너뜀

export interface WeekdayStudyTime {
  dayOfWeek: number;    // 0 = 일, 1 = 월, 2 = 화, 3 = 수, 4 = 목, 5 = 금, 6 = 토
  minutes: number;      // 분 (0 = 휴식일)
  isRestDay: boolean;   // 휴식일 여부
}

export interface SubjectPlanConfig {
  subjectId: string;
  selectedConceptIds: string[]; // 시험 범위 개념 목록 (명시적 선택)
  selectedProblemTypes: ProblemType[]; // 문제 유형 선택
  includeMockExam: boolean; // 모의시험 포함 여부
  mockExamTargetMinutes: number; // 모의시험 목표 시간 (분, 기본 45분)
}

export interface StudyPlanSettings {
  defaultDailyMinutes: number; // 전 과목 합산 기본 60분
  weekdaySettings: Record<number, WeekdayStudyTime>; // 0~6 요일별 시간 및 휴식일
  subjectConfigs: Record<string, SubjectPlanConfig>; // 과목별 설정
  updatedAt: string;
}

export interface StudyPlanItem {
  id: string; // 고유 ID (e.g. `spi-${date}-${kind}-${conceptId}-${problemId || 'mock'}`)
  subjectId: string;
  subjectName: string;
  conceptId?: string;
  conceptName?: string;
  conceptIds?: string[]; // 복합 문제 또는 모의시험용
  problemId?: string;
  problemTitle?: string;
  problemType?: ProblemType;
  kind: StudyPlanItemKind;
  assignedDate: string; // YYYY-MM-DD (Asia/Seoul)
  estimatedMinutes: number; // 예상 학습/풀이 시간
  isEstimatedTime: boolean; // 최초 학습 등 추정 시간 여부 플래그
  priorityScore: number; // 우선순위 계산값 (내림차순 정렬)
  priorityReason: string; // 실제 데이터에 근거한 추천 이유
  status: StudyPlanItemStatus;
  round?: number;        // 복습 회차 (1부터). 같은 회차의 실제 기록만 완료로 연결한다.
  earliestDate?: string; // 배정 가능 시작일 (YYYY-MM-DD, 권장일/시험 제약 반영)

  // Snapshots for persistence & history:
  snapshotTitle: string;
  snapshotDetail: string;

  // Completion linkage:
  completedAt?: string;
  completedAttemptId?: string;
  completedEventId?: string;
  completedMockSessionId?: string;

  // Problem quarantine / shortage flag:
  needsProblemGeneration?: boolean; // 승인된 문제가 없어 생성 필요한 경우
  isOutdatedProblem?: boolean;      // 원문 변경으로 재확인 필요한 경우
  warningNote?: string;             // 미루는 날짜가 시험 이후 등 경고

  // Mock exam launch configuration (mixed_mock_exam items):
  // 계획에서 모의시험을 시작할 때 범위·유형·시간을 그대로 전달하기 위한 스냅샷.
  mockExamConfig?: {
    conceptIds: string[];
    selectedTypes: ProblemType[];
    minutes: number;
  };

  // Rechallenge reservation linkage (rechallenge items):
  rechallengeId?: string;

  // Plan 04: Adaptive review problem kind & explainability
  recommendedPracticeKind?: RecommendedPracticeKind;
  explanationDetails?: ReviewExplanationDetails;

  /** Server-authoritative last-modified time (from the cloud row). */
  serverUpdatedAt?: string;
}

export interface DailyStudyPlan {
  date: string; // YYYY-MM-DD
  dayOfWeek: number; // 0~6
  dayLabel: string; // "2026.09.30 (수)"
  availableMinutes: number; // 해당 날짜 가용 시간
  isRestDay: boolean; // 휴식일 여부
  assignedMinutes: number; // 배정된 시간 합계
  items: StudyPlanItem[];
  unassignedItems: StudyPlanItem[]; // 예산 초과 미배정 항목
}

export interface StudyPlanScopeRemaining {
  subjectId: string;
  subjectName: string;
  totalScopeConcepts: number;
  unstudiedConceptsCount: number;
  studiedConceptsCount: number;
  unstudiedConceptTitles: string[];
}

export interface StudyPlanSummary {
  todayDate: string; // YYYY-MM-DD
  todayAvailableMinutes: number;
  todayAssignedMinutes: number;
  todayCompletedCount: number;
  todayPendingCount: number;
  todayUnassignedCount: number;
  totalShortageMinutes: number; // 시험일까지 처리 못할 예상 부족 시간
  scopeRemainingBySubject: StudyPlanScopeRemaining[];
  days: DailyStudyPlan[]; // 날짜별 계획
}

export const STUDY_PLAN_ITEM_KIND_LABELS: Record<StudyPlanItemKind, string> = {
  initial_study: '최초 학습',
  recommended_review: '권장 복습',
  vulnerability_fix: '취약점 보완',
  mixed_mock_exam: '혼합 모의시험',
  rechallenge: '지연 재도전',
};

export const DEFAULT_WEEKDAY_SETTINGS: Record<number, WeekdayStudyTime> = {
  0: { dayOfWeek: 0, minutes: 60, isRestDay: false }, // 일
  1: { dayOfWeek: 1, minutes: 60, isRestDay: false }, // 월
  2: { dayOfWeek: 2, minutes: 60, isRestDay: false }, // 화
  3: { dayOfWeek: 3, minutes: 60, isRestDay: false }, // 수
  4: { dayOfWeek: 4, minutes: 60, isRestDay: false }, // 목
  5: { dayOfWeek: 5, minutes: 60, isRestDay: false }, // 금
  6: { dayOfWeek: 6, minutes: 60, isRestDay: false }, // 토
};

export const DEFAULT_STUDY_PLAN_SETTINGS: StudyPlanSettings = {
  defaultDailyMinutes: 60,
  weekdaySettings: DEFAULT_WEEKDAY_SETTINGS,
  subjectConfigs: {},
  updatedAt: '2026-09-30T09:00:00+09:00',
};

// =========================================================================
// Stage 10: Personal Review Recommendation & Learning Analytics Types
// =========================================================================

/**
 * 복습 성향 (제품 초기 설정값, 검증된 학술 상수가 아님)
 * - dense: 촘촘하게 (간격을 짧게)
 * - standard: 기본
 * - relaxed: 여유 있게 (간격을 길게)
 */
export type ReviewTendency = 'dense' | 'standard' | 'relaxed';

export const REVIEW_TENDENCY_LABELS: Record<ReviewTendency, string> = {
  dense: '촘촘하게',
  standard: '기본',
  relaxed: '여유 있게',
};

export interface PersonalizationSettings {
  enabled: boolean;        // 개인별 추천 사용 여부 (기본 false)
  tendency: ReviewTendency; // 복습 성향 (기본 'standard')
  autoAdjust: boolean;     // 자동 보정 사용 여부 (기본 false)
  updatedAt: string;
}

export const DEFAULT_PERSONALIZATION_SETTINGS: PersonalizationSettings = {
  enabled: false,
  tendency: 'standard',
  autoAdjust: false,
  updatedAt: '2026-09-30T09:00:00+09:00',
};

export type PersonalizationDirection = 'shorten' | 'lengthen' | 'neutral';

export interface PersonalizationSubjectSignal {
  subjectId: string;
  subjectName: string;
  eligible: boolean;                // 최소 기록/날짜/문제 수 조건 충족 여부
  attemptCount: number;
  distinctDays: number;
  distinctProblems: number;
  recentAverageScore: number | null;
  hintDependencyRatio: number;
  repeatErrorCount: number;
  direction: PersonalizationDirection;
  targetMultiplier: number;
  evidenceStrength: number;
  reason: string;
}

export interface PersonalizationCorrectionState {
  ruleVersion: string;              // 보정 규칙 버전
  computedAt: string;               // 계산 시각 (ISO)
  dataSufficient: boolean;          // 자동 보정 가능한 근거 확보 여부
  basisRefs: string[];              // 사용한 기록(Attempt) ID 참조
  tendencyMultiplier: number;       // 성향 배율
  autoMultiplier: number;           // 자동 보정 배율 (데이터 부족 시 1)
  appliedMultiplier: number;        // 최종 적용 배율 (0.75 ~ 1.25)
  reasons: string[];                // 보정 근거 요약
  usedAttemptCount: number;
  usedDistinctDays: number;
  usedDistinctProblems: number;
  perSubject: PersonalizationSubjectSignal[];
}

export const PERSONALIZATION_RULE_VERSION = 'personal-interval-v1';


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
  | 'debug_counterexample';   // 디버깅 및 반례 분석

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
  status: 'draft' | 'approved' | 'rejected';
  isApproved: boolean;
  sourceMarkdownHash: string;
  createdAt: string;
  updatedAt: string;
  editedByUser?: boolean;
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
  // Stage 5 fields: Spaced repetition recommendation & postpone tracking
  postponeDays?: number;         // 미루기 누적 일수 (기본 0)
  postponedUntil?: string;       // 미루기 적용 목표 일자 (ISO 또는 YYYY-MM-DD)
  recommendedReviewAt?: string;  // 계산된 다음 권장 복습 시각 (ISO)
  lastCalculatedAt?: string;     // 최근 스케줄 계산 시각
}

export interface ReviewRecommendation {
  conceptId: string;
  recommendedAt: string;          // ISO string e.g. "2026-09-30T10:00:00+09:00"
  recommendedDateStr: string;     // YYYY-MM-DD in Asia/Seoul
  daysUntilReview: number;        // negative = overdue, 0 = today, positive = future days
  urgencyScore: number;           // Higher score = higher priority
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
  };
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
  mathFormula?: string;
  codeSnippet?: string;
  timeStandardMinutes?: number;
  hints: string[];
  modelAnswer: string;
  rubric: RubricCriterion[];
  editedAt: string;
  editReason?: string;
}

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
  // Stage 8 field:
  methodSelectionDiagnosis?: MethodSelectionDiagnosis;
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


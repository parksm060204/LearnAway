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
  kind: 'initial_study' | 'attempt' | 'review' | 'scheduled';
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
}

export type ProblemDifficulty = 'advanced_college' | 'intermediate' | 'graduate_challenging';

export const PROBLEM_DIFFICULTY_LABELS: Record<ProblemDifficulty, string> = {
  advanced_college: '고난도·대학 학부 시험 수준 (기본)',
  intermediate: '중간고사 표준형 (응용 및 개념 통합)',
  graduate_challenging: '대학원·심화 도전형 (일반화 및 엄밀 증명)',
};

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
  sourceMarkdownHash?: string;     // 분석/생성에 참조된 자료 버전 해시
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
  return status === 'normal' || status === 'reapproved';
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
  sourceMarkdownHash?: string;   // 생성 당시 원문 해시
  isOutdated?: boolean;          // 원문 Markdown 사후 수정 시 구버전 플래그
  createdAt?: string;
  // Stage 6 fields:
  version?: number;                      // 문제 버전 (기본 1)
  qualityStatus?: ProblemQualityStatus;  // 품질 검토 상태 (정상, 신고 접수, 검토 중, 수정 후 재검토, 재승인, 사용 중지)
  reports?: ProblemReport[];             // 누적 신고 기록
  versionHistory?: ProblemVersionSnapshot[]; // 이전 버전 스냅샷 이력
  lastReviewedAt?: string;               // 최근 검토 시각
  reviewNotes?: string;                  // 검토/처리 메모
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
}

export interface MockExamSession {
  id: string;
  subjectId: string;
  createdAt: string;
  endsAt: string;
  submittedAt?: string;
  durationMinutes: number;
  status: 'in_progress' | 'submitted' | 'graded' | 'recorded';
  selectedConceptIds: string[];
  selectedTypes: ProblemType[];
  problems: Problem[]; // 시험 시작 당시 고정된 문제·정답·채점 기준
  answers: Record<string, string>;
  evaluations: Record<string, EvaluationResult>;
  recordedAttemptIds?: string[];
}

export interface RetentionModelSettings {
  tau: number;       // Base time constant (days), e.g. 3.5
  alpha: number;     // Power law exponent, e.g. 0.45
  threshold: number; // Critical review threshold score, e.g. 50.0
}

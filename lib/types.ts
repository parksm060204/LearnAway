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
  | 'newly_learned';  // 신규 습득 (SCORE >= 90 or 최근 3일 이내)

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

export interface Material {
  id: string;
  subjectId: string;
  kind: MaterialKind;
  title: string;
  sourceRefs: string;     // e.g. "제3장 조건부분포 p.40 ~ p.58"
  pageCount?: number;
  durationMinutes?: number;
  parsedMarkdown?: string;
  isConverted: boolean;
  uploadedAt: string;
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
}

export interface Concept {
  id: string;
  subjectId: string;
  materialIds: string[];
  title: string;
  chapterRef: string;
  firstLearnedAt: string;
  firstLearnedDayOffset: number;
  lastAttemptAt?: string;
  lastAttemptDayOffset?: number;
  baseScore: number;
  currentScore: number;
  status: ConceptStatus;
  order: number;
  events: ReviewEvent[];
  exerciseCount: number;
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
}

export interface Attempt {
  id: string;
  problemId: string;
  conceptId: string;
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
}

export interface RetentionModelSettings {
  tau: number;       // Base time constant (days), e.g. 3.5
  alpha: number;     // Power law exponent, e.g. 0.45
  threshold: number; // Critical review threshold score, e.g. 50.0
}

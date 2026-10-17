# Plan 03: 대학 전공 시험 특화 AI 문제 생성 엔진 (02-problem-generation.md)

## 1. 개요

대학 전공 시험 특화 문제 생성 엔진(`app/api/generate-problems/route.ts`)은 강의자료 Markdown과 추출된 핵심 개념을 원천 근거(Source Grounding)로 삼아 시험 수준의 문제를 생성한다.
단순 객관식 문항이 아닌 서술형, 증명형, 계산 유도형, 디버깅 분석형 문제를 생성하며 5단계 학술 난이도와 구조적 일관성을 강제한다.

## 2. 5단계 학술 난이도 체계 (Academic Difficulty Scale)

| Level | 학술 명칭 | 소요 시간 | 루브릭 기준 수 | 출제 및 평가 특성 |
| :---: | :--- | :---: | :---: | :--- |
| **1** | 개념 정의 및 기본 대입 (Basic Definition) | 10분 내외 | 2~3개 | 핵심 정의, 성질의 직접 확인, 기본 공식 1회 대입 |
| **2** | 단일 정리 응용 (Standard Application) | 10~15분 | 2~3개 | 표준적인 전공 시험 문제, 1~2단계 공식 전개 및 기본 조건 해석 |
| **3** | 다단계 유도 및 복합 조건 (Multi-step Derivation) | 15~20분 | 3개 내외 | 복수 개념의 결합, 전제 조건 검증, 중간 변수 치환 및 유도 |
| **4** | 전공 심화 종합 증명 (Advanced Synthesis) | 20~30분 | 3개 이상 | 정규 대학 기말고사 킬러 문항, 엄밀한 논증, 엣지 케이스 분석 |
| **5** | 대학원 수준 종합 탐구 (Graduate / Research) | 30분 이상 | 4개 이상 | 비정형 문제, 독창적 모델링, 일반화 증명 및 반례 구성 |

### 구조적 난이도 검증 규칙 (Structural Validation)
- Level 4 및 Level 5 문항: 루브릭 평가 기준이 최소 3개 이상이어야 하며, 표준 소요 시간이 15분 이상이어야 함.
- Level 1 문항: 루브릭 기준이 4개 이상이고 소요 시간이 25분을 초과하는 등 과도한 복잡도를 가질 경우 기초 난이도 선언 불일치로 감지 및 보정.

## 3. 전공별 문항 유형 체계

### 3.1 수학 및 통계학 (Math & Statistics)
- `essay_descriptive`: 대학 논술·서술형 (개념의 직관적 해석과 학술적 서술)
- `calc_derivation`: 계산 유도형 (정리로부터 최종 결론까지의 대수적 전개)
- `proof_counterexample`: 증명 및 반례 (엄밀한 수학적 귀납법, 귀류법, 반례 제시)
- `error_spotting`: 오류 검증형 (주어진 잘못된 풀이 과정의 비약과 오류 탐지)
- `concept_explanation`: 개념 설명형 (용어 및 성질의 상호 관계 서술)
- `composite_application`: 복합 개념 응용형 (2개 이상의 상호 연계 개념 융합)

### 3.2 컴퓨터과학 및 코딩 (Computer Science)
- `impl_descriptive`: 구현 및 설계 서술형 (자료구조 및 아키텍처 설계)
- `algorithm_optimization`: 알고리즘 최적화 설명 (시간/공간 최적화 기법 설명)
- `complexity_proof`: 시간/공간 복잡도 증명 (점근적 표기법, 마스터 정리 적용)
- `debug_counterexample`: 디버깅 및 반례 분석 (동시성/경쟁조건, 버퍼오버플로 등 결함 탐지)

## 4. 원본 강의자료 근거 및 출처 추적 (Source Provenance)

모든 생성 문항(`ProblemDraft`, `Problem`)은 다음 출처 정보를 영속화한다:
- `sourceMaterialId`: 문제 출제의 근거가 된 강의자료 ID
- `sourceConceptIds`: 연계된 핵심 개념 ID 목록
- `sourcePage`: 강의자료 원문의 페이지 번호 (슬라이드 번호)
- `sourceExcerpt`: 출제의 직접 근거가 된 2~3문장의 원문 발췌문
- `sourceContentVersion`: 출제 당시의 원문 해시 및 버전
- `sourceVerificationStatus`: `'verified' | 'unverified' | 'needs_review'`

## 5. 중복 문항 방지 (Deduplication)

동일 개념에서 반복 출제 시 프롬프트 텍스트의 정규화(공백 축약, 소문자화, 특수기호 정규화) 및 Jaccard 유사도 검사를 통해 한 세션 내 중복 문항 생성을 원천 차단한다.

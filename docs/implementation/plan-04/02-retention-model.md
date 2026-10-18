# Plan 04 — 02. 기억 유지율 및 개념 숙련도 모델 (Retention & Mastery Model)

## 1. 모델링 철학: 이원화 분리 원칙 (Decoupled Dual-Metric)

학습 과학에서 학생의 인지 상태는 단일 스칼라 값으로 환원될 수 없다.
LearnAway Plan 04는 다음 두 축을 수학적·아키텍처적으로 엄격히 분리한다.

1. **기억 유지율 ($R(t)$, Retention Score)**:
   - "현재 시점에서 해당 개념의 핵심 명제·정리·공식을 머릿속에서 인출(Retrieval)할 수 있는 예상 확률."
   - 시간 $t$의 경과에 따라 비가역적으로 단조 감소(Decay).
2. **개념 숙련도 ($M$, Mastery Score)**:
   - "학생이 해당 개념의 본질적 의미, 전제조건, 증명 구조 및 응용 능력을 얼마나 깊이 체득하고 있는가."
   - 시간 경과에 의해 즉각 소멸하지 않으며, 학생이 푼 문제들의 난이도, 부분점수, 오답의 원인, 힌트 의존도, 반복 성공 여부에 따라 누적 형성됨.

---

## 2. 수학적 정의 및 수식 체계

### A. 멱법칙 기억 유지 모델 (Power-Law Retention Decay)

학습자의 장기 기억 감쇠는 Ebbinghaus 지수 모델보다 인지 심리학적으로 안정성이 검증된 **Wickelgren-Wixted 멱법칙(Power Law)** 형태를 기본 모델로 채택한다:

$$R(t) = S_0 \cdot \left(1 + \frac{t}{\tau}\right)^{-\alpha}$$

- **$S_0$**: 직전 복습/풀이 시점의 유효 획득 점수 ($0 \le S_0 \le 100$).
- **$t$**: 마지막 유효 복습 이후 실제 경과 일수 ($t \ge 0$, Asia/Seoul 캘린더 기준).
- **$\tau$**: 유효 기억 안정성 지수(Effective Memory Stability, 단위: 일). 복습 횟수, 확신도, 힌트 수, 루브릭 감점 수에 따라 동적 결정.
- **$\alpha$**: 감쇠 계수(Decay Rate, 기본값 $0.45$).

#### 최적 복습 간격 ($t^*$)의 역산:
유지율이 임계치 $\theta$ (기본값 60점)에 도달하는 최적 복습 시점 $t^*$는 멱법칙의 역함수로 결정론적으로 유도된다:

$$t^* = \tau \cdot \left[ \left(\frac{S_0}{\theta}\right)^{1/\alpha} - 1 \right]$$

- 만약 $S_0 \le \theta$인 경우, 즉시 오늘($t^* = 0$) 복습 대상으로 산출됨.

### B. 유효 기억 안정성 ($\tau$) 결정 함수

$$\tau = \tau_{\text{base}} \cdot C_{\text{rep}} \cdot C_{\text{conf}} \cdot C_{\text{hint}} \cdot C_{\text{rubric}}$$

- $\tau_{\text{base}}$: 기본 안정성 (최초 학습 시 2.5일, 복습 회차에 따라 점진 증가).
- $C_{\text{rep}} = 1 + 0.35 \cdot \min(N_{\text{reviews}}, 6)$: 반복 복습 가중치.
- $C_{\text{conf}}$: 자기 확신도 보정 (확신도 5: 1.15, 확신도 1~2: 0.85).
- $C_{\text{hint}} = 1 - 0.08 \cdot \min(N_{\text{hints}}, 3)$: 힌트 사용 감쇠.
- $C_{\text{rubric}} = 1 - 0.1 \cdot \min(N_{\text{vuln}}, 3)$: 취약 루브릭 감점.

### C. 누적 개념 숙련도 ($M$) 지수 가중 평균 모델

개념 숙련도는 확정된 모든 유효 풀이 기록($E_1, E_2, \dots, E_N$)의 가중 조합으로 산출된다:

$$M = \text{clamp}\left(0, 100, \bar{S}_w + B_{\text{streak}} - P_{\text{repeat}}\right)$$

#### 1. 지수적 최신성 가중치 ($w_i$):
과거 $N$개의 사건 중 $i$번째 사건($i = 0, \dots, N-1$)에 대해, 최신 기록일수록 높은 비중을 부여:
$$w_i = 0.75^{N - 1 - i}$$

#### 2. 사건별 유효 숙련도 점수 ($s_i$):
$$s_i = \text{clamp}\left(0, 100, \text{rawScore}_i \cdot H_i \cdot F_{\text{error}}\right)$$
- $H_i$: 힌트 사용 계수 ($1.0 - 0.05 \cdot \text{hintCount}_i$).
- $F_{\text{error}}$: 학술 오답 원인별 차등 가중치:
  - `NO_ERROR` / `CALCULATION_ERROR`: **$1.0$** (단순 계산 오타는 개념적 숙련도를 훼손하지 않음)
  - `CONDITION_OMISSION` / `LOGICAL_ERROR`: **$0.92$** (경계 조건 또는 논리 비약 보완)
  - `CONCEPT_MISUNDERSTANDING` / `FORMULA_MISAPPLICATION`: **$0.85$** (핵심 개념 결손)
  - `UNCERTAIN` / `needsReview`: **기존 베이스라인 점수 보존** ($\max(\text{rawScore}_i, \text{baseScore})$)으로 AI 채점 실패에 의한 학생 피해 원천 방지.

#### 3. 스트릭 보너스 및 반복 오답 페널티:
- $B_{\text{streak}} = \min(6, N_{\text{consecutive\_high}} \times 2)$: 80점 이상 연속 성공 시 가산.
- $P_{\text{repeat}} = \min(9, \max(0, N_{\text{concept\_errors}} - 1) \times 3)$: 동일 개념 오류 반복 시 감점.

---

## 3. 모델의 안전장치 및 결정론적 보장

1. **상한/하한 불변 조건**:
   - $\forall t \ge 0, \quad R(t) \in [0, 100]$
   - $M \in [0, 100]$
2. **미래 날짜 및 음수 경과 방지**:
   - $t < 0$ (클라이언트/서버 시계 오차) 발생 시 $t = 0$으로 자동 보정하여 허수 또는 지수 폭발 방지.
3. **무작위성 배제(Pure Function)**:
   - 동일한 학습 이력(`events`), 동일한 파라미터(`settings`), 동일한 기준 시각(`referenceDate`)이 주어지면 언제 어디서든 100% 동일한 비트 단위의 결과 산출.
4. **미학습 상태 격리**:
   - `concept.status === 'unstudied'`인 경우, 어떠한 가상 점수나 감쇠 곡선도 생성하지 않으며 `SCORE --`로 완전 격리.

/**
 * Structured content and policy metadata for the pre-login Service Guide & Policy Modal.
 *
 * Rules enforced in this module:
 * - Only features and data flows verified in the repository code are described as active.
 * - Unconfirmed operator/legal policy fields remain explicitly `null` in metadata and are
 *   never fabricated (no fake company names, emails, regions, retention periods, or effective dates).
 * - Unconfirmed policy sections clearly display the draft notice: "안내 초안 · 운영 정보 확인 중".
 */

export type ServiceGuideSection = 'overview' | 'terms' | 'privacy' | 'ai' | 'storage';

export const SERVICE_GUIDE_SECTION_ORDER: readonly ServiceGuideSection[] = [
  'overview',
  'terms',
  'privacy',
  'ai',
  'storage',
] as const;

export function isServiceGuideSection(value: unknown): value is ServiceGuideSection {
  return (
    typeof value === 'string' &&
    (SERVICE_GUIDE_SECTION_ORDER as readonly string[]).includes(value)
  );
}

export interface ServicePolicyMetadata {
  status: 'draft' | 'published';
  statusBadgeLabel: string;
  draftSummaryNotice: string;
  operatorName: string | null;
  contactEmail: string | null;
  privacyRightsContact: string | null;
  effectiveDate: string | null;
  documentVersion: string | null;
  hostingProviderAndRegion: string | null;
  retentionScheduleConfirmed: boolean;
  accountDeletionWorkflowConfirmed: boolean;
  externalLegalClassificationConfirmed: boolean;
  aiTrainingPolicyConfirmed: boolean;
}

/**
 * Policy metadata reflecting current repository state.
 * Unconfirmed operator details are kept `null` until officially verified before public launch.
 */
export const SERVICE_POLICY_METADATA: ServicePolicyMetadata = {
  status: 'draft',
  statusBadgeLabel: '안내 초안 · 운영 정보 확인 중',
  draftSummaryNotice:
    '본 문서는 현재 저장소 코드에 구현된 실제 동작을 기준으로 작성된 안내 초안입니다. 운영 주체, 연락처, 보유기간, 국외이전 및 공식 시행일 등 운영자 확정 항목은 정식 공개 전 확인 중입니다.',
  operatorName: null,
  contactEmail: null,
  privacyRightsContact: null,
  effectiveDate: null,
  documentVersion: null,
  hostingProviderAndRegion: null,
  retentionScheduleConfirmed: false,
  accountDeletionWorkflowConfirmed: false,
  externalLegalClassificationConfirmed: false,
  aiTrainingPolicyConfirmed: false,
};

export interface ExternalProcessingEntry {
  category: string;
  target: string;
  purposeAndTrigger: string;
  transmittedItems: string;
  codeVerificationNote: string;
}

export const VERIFIED_EXTERNAL_PROCESSING_ENTRIES: readonly ExternalProcessingEntry[] = [
  {
    category: '인증·DB·파일 저장',
    target: 'Supabase (Auth · Postgres DB · Storage)',
    purposeAndTrigger:
      'Google 로그인 및 아이디 로그인 세션 처리, 과목·자료 메타데이터·개념·문제·답안·복습 기록 저장, 선택적 원본 백업 및 정밀 변환용 임시 파일 저장',
    transmittedItems:
      '계정 식별자(UUID), 이메일 또는 내부 매핑 이메일(@id.learnaway.local), 암호화된 비밀번호 해시(Supabase Auth 처리), 과목·개념·문제·답안·복습 이력, 선택 시 변환 본문·원본 PDF',
    codeVerificationNote:
      '기본 자료 정책(로컬 보관) 사용 시 PDF 원본과 Markdown 본문은 브라우저(IndexedDB)에만 보관되며, 사용자가 동기화·백업 옵션을 켜거나 정밀 변환을 실행할 때만 서버 스토리지가 사용됩니다.',
  },
  {
    category: 'AI 분석·생성·평가',
    target: '설정된 학교 BAZE Gateway (기본 모델: deepseek-v4.1-flash 등) 및 연결 모델 제공자',
    purposeAndTrigger:
      '사용자가 개념 분석, 문제 생성, 답안 평가, 논리 보완 질문, 유사 문제 변형, 문제 품질 검토를 실행할 때 호출',
    transmittedItems:
      '기능 수행에 필요한 강의 자료 본문(또는 분할 청크), 추출 개념, 문제 지문, 모범 답안·채점 기준(루브릭), 사용자의 답안 및 풀이 근거',
    codeVerificationNote:
      '자료를 이 기기에 보관하는 설정이더라도 AI 기능을 실행하면 해당 요청 처리에 필요한 텍스트가 서버를 거쳐 AI 경로로 전송됩니다.',
  },
  {
    category: 'PDF 정밀 변환 (선택)',
    target: '설정된 외부 PDF 변환 서비스 (PDF_CONVERT_SERVICE_URL)',
    purposeAndTrigger:
      '자료 등록 시 기본 브라우저 변환(PDF.js) 대신 사용자가 ‘서버 정밀 변환’을 직접 선택한 경우에 한해 동작',
    transmittedItems:
      '업로드한 원본 PDF 바이너리(대용량 경로의 경우 Supabase 임시 버킷 경유 토큰·경로) 및 페이지 제한 정보',
    codeVerificationNote:
      '기본값인 ‘이 기기에서 변환(브라우저 PDF.js)’ 선택 시에는 외부 변환 서버로 PDF가 전송되지 않습니다.',
  },
  {
    category: '선택적 백업',
    target: 'Google Drive API (drive.file, userinfo.email)',
    purposeAndTrigger:
      '사용자가 설정에서 Google Drive를 별도 연결한 뒤 직접 ‘Google Drive에 백업’을 실행할 때 업로드',
    transmittedItems:
      'Drive 연결 계정 이메일, 사용자가 내보내기를 실행한 학습 자료 백업 패키지(JSON/바이너리 파트)',
    codeVerificationNote:
      'Google 로그인과 별도의 OAuth 동의를 거치며, 백그라운드 자동 백업 없이 사용자가 실행할 때만 업로드합니다.',
  },
  {
    category: '선택적 알림',
    target: '설정된 알림 전송 웹훅 경로 (NOTIFICATION_WEBHOOK_URL)',
    purposeAndTrigger:
      '사용자가 설정에서 복습 알림 수신에 동의·활성화하고 예정된 복습 항목이 있거나 테스트 발송을 실행할 때 호출',
    transmittedItems:
      '사용자 식별자, 알림 채널(email 또는 web_push), 수신 대상 주소/엔드포인트, 당일 복습 예정 건수 및 과목 안내 메시지',
    codeVerificationNote:
      '수신 동의(is_active)가 꺼져 있거나 당일 복습 예정 항목이 없으면(테스트 발송 제외) 외부로 발송하지 않습니다.',
  },
  {
    category: '호스팅 및 운영 로그',
    target: '실제 배포 호스팅 환경 (운영 정보 확인 중)',
    purposeAndTrigger:
      '웹 애플리케이션 제공, API 라우트 실행, 속도 제한(Rate Limit) 및 오류 진단',
    transmittedItems:
      'HTTP 요청 메타데이터, 접속 IP(로그인·가입 속도 제한 검증 포함), 오류 상태 코드',
    codeVerificationNote:
      '실제 배포 인프라 사업자, 서버 리전(국가), 인프라 로그 보관 주기는 운영자 확정 후 기재됩니다.',
  },
] as const;

export interface PendingOperatorPolicyItem {
  id: string;
  title: string;
  description: string;
}

export const PENDING_OPERATOR_POLICY_ITEMS: readonly PendingOperatorPolicyItem[] = [
  {
    id: 'operator-identity',
    title: '운영 주체 및 문의·권리 행사 연락처',
    description:
      '서비스 운영 주체(개인·팀·기관명), 이용 문의 채널, 개인정보 열람·정정·삭제·처리정지 요청 접수처 확정 필요',
  },
  {
    id: 'retention-period',
    title: '수집 항목별 보유·이용 기간',
    description:
      '계정 정보, 학습 기록, 속도 제한(Rate Limit) 기록, AI 사용량 로그, 알림 발송 로그의 구체적 보유기간 확정 필요',
  },
  {
    id: 'deletion-procedure',
    title: '계정 탈퇴 및 서버·백업 파기 절차',
    description:
      '회원 탈퇴 요청 처리 경로(자가 탈퇴 기능 추가 여부 또는 운영자 접수 절차) 및 DB·스토리지 백업본 파기 주기 확정 필요',
  },
  {
    id: 'legal-relationship',
    title: '외부 사업자 위탁·제3자 제공 법적 분류',
    description:
      'Supabase, 학교 BAZE Gateway(및 하위 모델 제공자), PDF 변환 서버, Google, 알림 웹훅 사업자와의 개인정보 처리위탁·제3자 제공 관계 확정 필요',
  },
  {
    id: 'cross-border-transfer',
    title: '저장·처리 국가 및 국외이전 세부사항',
    description:
      '클라우드 DB·스토리지 리전, AI 게이트웨이 및 호스팅 서버의 물리적 소재 국가, 이전 일시·방법 및 보호조치 확정 필요',
  },
  {
    id: 'ai-data-retention',
    title: '외부 AI 제공자의 입력 보관·모델 학습 이용 정책',
    description:
      '학교 BAZE Gateway 및 연결된 모델 제공자가 전송된 프롬프트·답안을 보관하는 기간과 모델 학습에 이용하는지 여부 확인 필요',
  },
  {
    id: 'effective-date-and-consent',
    title: '공식 시행일·문서 버전 및 동의 절차',
    description:
      '약관·개인정보 처리 안내의 공식 시행일, 문서 버전 번호, 가입 시 별도 필수 동의 체크 및 동의 이력 DB 저장 설계 확정 필요',
  },
] as const;

export type ServiceGuideBlock =
  | {
      type: 'section';
      heading: string;
      paragraphs?: readonly string[];
      orderedItems?: readonly { title: string; detail: string }[];
      bulletItems?: readonly { label?: string; text: string }[];
      callout?: {
        tone: 'important' | 'neutral';
        title?: string;
        text: string;
      };
    }
  | {
      type: 'external-processing-table';
      heading: string;
      description: string;
      entries: readonly ExternalProcessingEntry[];
      footnote: string;
    }
  | {
      type: 'pending-policy-list';
      heading: string;
      description: string;
      items: readonly PendingOperatorPolicyItem[];
    };

export interface ServiceGuideDocument {
  id: ServiceGuideSection;
  title: string;
  shortLabel: string;
  summary: string;
  isDraftPolicy: boolean;
  blocks: readonly ServiceGuideBlock[];
}

export const SERVICE_GUIDE_DOCUMENTS: Record<ServiceGuideSection, ServiceGuideDocument> = {
  overview: {
    id: 'overview',
    title: '서비스 소개',
    shortLabel: '서비스 소개',
    summary: '강의 자료를 이해하고, 시험 수준의 문제를 풀며, 복습을 이어가는 학습 도구입니다.',
    isDraftPolicy: false,
    blocks: [
      {
        type: 'section',
        heading: '무엇을 할 수 있나요?',
        paragraphs: [
          'Learn my way는 PDF와 강의 전사본을 정리하고, 자료에 근거한 개념 분석과 문제 풀이를 지원하는 학습 도구입니다.',
          '수학·통계·코딩 분야의 서술형·증명·복합 개념 문제를 중심으로 학습하며, 강의 자료 정리부터 답안 논리 보완과 복습까지 하나의 흐름으로 연결합니다.',
        ],
        callout: {
          tone: 'neutral',
          title: '핵심 학습 흐름',
          text: 'PDF·전사본 → Markdown 정리 → AI 개념 분석 → 대학 시험 수준 문제 → 풀이·평가 → 망각곡선 복습',
        },
      },
      {
        type: 'section',
        heading: '기본 사용 순서',
        orderedItems: [
          {
            title: '과목과 시험일 설정',
            detail: '학습할 과목을 만들고 목표 시험 일정을 등록합니다.',
          },
          {
            title: 'PDF 또는 이미 작성된 강의 전사본 등록',
            detail:
              '강의 슬라이드·교재 PDF를 업로드하여 변환하거나, 이미 작성해 둔 강의 전사본 텍스트를 직접 입력합니다.',
          },
          {
            title: '변환된 Markdown을 원문과 대조하고 수정',
            detail:
              '수식(LaTeX), 코드 블록, 정의·정리 문장이 원문 자료와 일치하는지 확인하고 필요한 부분을 직접 다듬습니다.',
          },
          {
            title: 'AI 개념 분석 결과와 출처 검토',
            detail:
              '자료에서 추출된 핵심 개념, 중요도, 원문 근거 구간을 검토하고 학습 범위를 정리합니다.',
          },
          {
            title: '문제 유형을 선택하고 생성된 문제·정답·채점 기준 검토',
            detail:
              '서술형·증명형·복합 개념 문제를 생성하고, 문항 본문·모범 답안·채점 기준(루브릭)이 원문 개념에 부합하는지 확인합니다.',
          },
          {
            title: '답안 작성과 피드백 확인',
            detail:
              '답안과 풀이 근거를 작성해 제출한 뒤, 루브릭 기반 채점 결과와 논리 보완 질문으로 부족한 전개 과정을 점검합니다.',
          },
          {
            title: '학습 기록과 시험일을 참고해 복습',
            detail:
              '풀이 이력, 오답 유형, 시험일까지 남은 일정을 바탕으로 우선 복습할 개념과 문제를 확인하고 재도전합니다.',
          },
        ],
      },
      {
        type: 'section',
        heading: '알아두세요',
        bulletItems: [
          {
            label: '전사본 입력과 음성 녹음·전사(STT)의 구분',
            text: '본 서비스는 사용자가 이미 보유하거나 작성한 전사본 텍스트의 입력·편집을 지원합니다. 앱 자체 음성 녹음이나 음성 파일을 텍스트로 자동 변환하는(STT) 기능은 제공하지 않습니다.',
          },
          {
            label: 'AI 결과의 오류 가능성과 검토 필요',
            text: 'AI가 생성한 개념 요약, 문제, 모범 답안, 채점 점수 및 출처 표기에는 오류가 있을 수 있으므로 항상 원본 강의 자료를 기준으로 검토해야 합니다.',
          },
          {
            label: '시험 출제·성적 향상 미보장',
            text: '본 서비스는 개념 이해와 서술형 답안 연습을 돕는 보조 도구이며, 실제 대학 시험 출제 적중이나 성적 향상을 보장하지 않습니다.',
          },
          {
            label: '망각곡선 지표의 성격',
            text: '화면에 표시되는 망각곡선 및 기억 잔존율(R(t) = S0 · (1 + t/τ)^(-α))은 학습 기록과 경과 시간을 바탕으로 복습 우선순위를 제안하는 추정 모델이며, 실제 생체 기억력을 측정한 수치가 아닙니다.',
          },
          {
            label: '환경 설정에 따른 기능 지원 범위',
            text: '외부 AI 연결, 서버 정밀 PDF 변환, Google Drive 백업, 복습 알림 등 일부 기능은 서버 설정 및 사용자의 연결 여부에 따라 동작 범위가 달라집니다.',
          },
        ],
      },
    ],
  },

  terms: {
    id: 'terms',
    title: '이용약관',
    shortLabel: '이용약관',
    summary:
      '서비스의 목적과 이용 범위, 계정 관리, 학습 자료 권리, 금지 행위 및 AI·저장 기능 이용 조건을 안내하는 초안입니다.',
    isDraftPolicy: true,
    blocks: [
      {
        type: 'section',
        heading: '서비스 목적과 범위',
        paragraphs: [
          'Learn my way는 사용자가 등록한 강의 자료를 정리하고, 서술형·증명형 문제 풀이와 복습 계획 관리를 수행할 수 있도록 돕는 개인 학습 보조 도구입니다.',
          '서비스 내에서 제공되는 AI 개념 분석, 생성 문제, 모범 답안, 채점 점수 및 논리 피드백은 자기주도 학습을 위한 참고 자료이며, 교수자·조교 또는 소속 교육기관의 공식 학업 평가를 대신하지 않습니다.',
        ],
      },
      {
        type: 'section',
        heading: '계정 이용',
        bulletItems: [
          {
            label: '계정 및 인증정보 관리',
            text: '사용자는 Google 로그인 또는 간편 회원가입(아이디·비밀번호)을 통해 본인의 계정을 생성하고, 비밀번호와 로그인 세션을 안전하게 관리해야 합니다.',
          },
          {
            label: '간편 회원가입과 공용 게스트 로그인의 구분',
            text: '기존의 공용 게스트 로그인은 종료되었습니다. 현재 제공되는 간편 회원가입은 사용자마다 고유한 아이디와 비밀번호를 설정하는 개별 계정 방식입니다. 다만 이메일을 입력하지 않는 간편 계정은 비밀번호 분실 시 이메일 인증을 통한 재설정이나 복구가 지원되지 않으므로 비밀번호를 별도로 안전하게 기록해 두어야 합니다.',
          },
          {
            label: '무단 사용 및 제한 우회 금지',
            text: '다른 사람의 계정을 무단으로 사용하거나, 로그인·가입 속도 제한(Rate Limit) 및 접근 권한 검증을 비정상적인 방법으로 우회해서는 안 됩니다.',
          },
        ],
      },
      {
        type: 'section',
        heading: '학습 자료와 권리',
        bulletItems: [
          {
            label: '적법한 자료 이용',
            text: '사용자는 본인이 업로드·변환·분석할 권한이 있는 강의 자료, 필기, 전사본만을 이용해야 하며, 강의 자료·교재·시험 문제의 저작권과 소속 대학·기관의 이용 규정을 준수해야 합니다.',
          },
          {
            label: '개인 학습 목적과 배포 제한',
            text: '개인 학습을 위해 서비스에 자료를 등록하거나 문제를 생성하는 것이 해당 저작물의 공개 배포나 제3자 제공 권한을 의미하지 않습니다.',
          },
          {
            label: '사용자 자료의 권리 유지',
            text: '사용자가 등록한 원본 자료와 직접 작성한 답안에 대한 권리는 사용자 또는 원권리자에게 유지됩니다. 운영자는 사용자가 요청한 저장·변환·분석·백업 기능을 수행하는 범위 외에 사용자 자료의 권리를 무제한 취득하지 않습니다.',
          },
        ],
      },
      {
        type: 'section',
        heading: '금지 행위',
        paragraphs: [
          '사용자는 서비스를 이용할 때 다음 행위를 해서는 안 됩니다.',
        ],
        bulletItems: [
          {
            text: '타인의 개인정보, 계정 비밀번호, API 키 등 인증·비밀정보를 무단으로 등록하거나 입력하는 행위',
          },
          {
            text: '악성 코드나 비정상 조작 파일을 등록하거나, 서버·데이터베이스·네트워크에 과도한 부하를 발생시키는 시스템 공격 행위',
          },
          {
            text: '체험 크레딧 차감 로직, API 호출 제한, 권한 검증 등 서비스 보호 장치를 우회하거나 조작하는 행위',
          },
          {
            text: '다른 사용자의 과목·자료·개념·문제·답안 데이터에 무단으로 접근하거나 참조·수정을 시도하는 행위',
          },
          {
            text: '소속 교육기관이나 시험 주관처가 금지하는 실시간 시험 대리 풀이, 과제 부정행위 등 학칙·규정 위반 용도로 서비스를 이용하는 행위',
          },
        ],
      },
      {
        type: 'section',
        heading: 'AI 기능과 비용',
        bulletItems: [
          {
            label: '외부 AI 경로 및 학교 Gateway 연동',
            text: '개념 분석, 문제 생성, 답안 평가 등 AI 기능은 학교 BAZE Gateway(기본 모델 deepseek-v4.1-flash 등) 또는 서버에 구성된 외부 AI 제공자를 통해 동작합니다.',
          },
          {
            label: '개인 API 키 이용 조건',
            text: '사용자가 설정에서 개인 API 키를 등록해 사용하는 경우, 해당 키 제공자·게이트웨이의 요금 부과 기준, 호출 한도 및 이용약관이 적용될 수 있습니다.',
          },
          {
            label: '체험 제공량 및 정책',
            text: '기본 체험 제공량과 사용 가능 여부는 계정 구분 및 서버 운영 정책에 따르며, 서비스는 무제한 무료 AI 호출을 약속하지 않습니다.',
          },
        ],
      },
      {
        type: 'section',
        heading: '서비스 변경과 장애',
        paragraphs: [
          '외부 AI 제공자, 클라우드 데이터베이스·스토리지(Supabase), 외부 PDF 변환 서버, 네트워크 상태 또는 사용자 브라우저의 저장소(IndexedDB·localStorage) 환경에 따라 일부 기능이 제한되거나 일시 중단될 수 있습니다.',
          '브라우저 데이터 초기화나 예기치 않은 통신 장애로 인한 자료 손실을 대비할 수 있도록, 중요한 학습 자료와 기록은 내보내기(백업 파일 다운로드 등)를 통해 별도로 백업해 두실 것을 권장합니다.',
        ],
      },
      {
        type: 'section',
        heading: '이용 종료와 문의',
        bulletItems: [
          {
            label: '현재 제공되는 삭제·연결 해제 방법',
            text: '사용자는 로그인 후 과목 및 자료 삭제, 설정 내 개인 API 키 연결 해제, Google Drive 연결 해제, 복습 알림 비활성화 및 로그아웃을 직접 실행할 수 있습니다.',
          },
          {
            label: '계정 탈퇴 및 운영자 문의 안내',
            text: '현재 앱 화면 내에 전체 계정을 즉시 영구 탈퇴·파기하는 자동화 버튼은 별도로 구현되어 있지 않습니다. 계정 탈퇴 처리 절차와 공식 운영자 문의 채널은 운영 정보가 확정되는 대로 본 안내에 반영됩니다(안내 초안 · 운영 정보 확인 중).',
          },
        ],
      },
    ],
  },

  privacy: {
    id: 'privacy',
    title: '개인정보 처리 안내',
    shortLabel: '개인정보 처리 안내',
    summary:
      '코드에서 확인된 실제 인증·학습 데이터 처리 흐름과 운영자가 공개 전 확정해야 하는 사항을 구분하여 안내합니다.',
    isDraftPolicy: true,
    blocks: [
      {
        type: 'section',
        heading: '계정과 인증',
        bulletItems: [
          {
            label: 'Google 로그인',
            text: 'Supabase Auth의 Google OAuth 인증을 통해 계정 고유 식별자(User ID), 이메일 주소, 인증 세션을 처리합니다. 앱 기능 수행을 위해 이름·프로필 사진 등 확인되지 않은 추가 프로필 항목을 별도로 필수 수집·요구하지 않습니다.',
          },
          {
            label: '간편 회원가입 / 아이디 로그인',
            text: '사용자가 입력한 아이디(3~30자 영문 소문자·숫자·_·-)를 정규화하여 내부 식별용 가상 이메일({아이디}@id.learnaway.local)과 계정 매핑 테이블(username_accounts)로 연결하고, 인증은 Supabase Auth로 처리합니다. 회원의 비밀번호는 Supabase Auth의 해시 체계로만 처리되며 앱 데이터베이스에 평문으로 저장하지 않습니다.',
          },
          {
            label: '접속 제한(Rate Limit) 보호 처리',
            text: '무차별 로그인 시도와 자동화 가입 남용을 막기 위해 로그인·가입 요청 시 접속 IP 주소와 시도 횟수를 서버 DB의 속도 제한 검증 함수로 확인합니다.',
          },
        ],
      },
      {
        type: 'section',
        heading: '학습 데이터 (로컬 저장과 서버 저장의 구분)',
        bulletItems: [
          {
            label: '서버(Supabase DB·Storage)에 저장되는 항목',
            text: '과목명·시험일(subjects), 자료 메타데이터(materials: 제목·유형·페이지 수·원본 해시·저장 정책), 추출 개념(concepts), 생성·수정된 문제 및 버전 스냅샷(problems, problem_versions), 답안·채점 결과·복습 기록(study_records, answer_drafts), 학습 계획(study_plans, study_plan_items), 암호화된 개인 API 키(ai_connections), 체험 크레딧 및 AI 사용량 기록(ai_trial_credits, ai_trial_reservations, ai_usage_events), 선택적 복습 알림 구독·발송 이력(review_notification_subscriptions, review_notification_logs)이 계정별로 분리되어 저장됩니다.',
          },
          {
            label: '브라우저(이 기기)에 저장되는 항목',
            text: '새 자료의 기본 설정(로컬 보관)에서는 PDF 원본 파일과 변환된 Markdown 본문·전사본이 사용자의 브라우저 IndexedDB에 저장됩니다. 사용자가 설정에서 ‘변환 본문 클라우드 동기화’ 또는 ‘PDF 원본 클라우드 백업’을 켠 경우에 한해 새 자료의 본문이나 원본 PDF가 서버에 함께 저장됩니다.',
          },
        ],
      },
      {
        type: 'external-processing-table',
        heading: '외부 처리 경로 (코드 확인 기준)',
        description:
          '현재 저장소 코드에서 실제로 연결되어 있거나 환경변수 설정에 따라 호출되는 외부 처리 경로는 다음과 같습니다.',
        entries: VERIFIED_EXTERNAL_PROCESSING_ENTRIES,
        footnote:
          '※ 위 표는 코드에서 확인된 기술적 데이터 전송 경로입니다. 개인정보 보호법상 제3자 제공·처리위탁·국외이전의 법적 분류, 실제 수탁 법인명, 서버 물리적 소재 국가, 보유기간 및 외부 AI 제공자의 모델 학습 이용 여부는 코드만으로 단정하지 않으며 운영자 확인을 거쳐 확정됩니다.',
      },
      {
        type: 'section',
        heading: '쿠키와 브라우저 저장소',
        bulletItems: [
          {
            label: '필수 인증·연결 쿠키',
            text: 'Supabase 로그인 세션 유지를 위한 인증 쿠키와, 사용자가 Google Drive 백업을 연결한 경우 서버 키(AES-256-GCM)로 암호화된 Drive 세션 쿠키(learnaway_drive_session) 및 OAuth 상태 확인 쿠키(learnaway_drive_state)를 사용합니다. 코드 기준 별도의 광고·마케팅 추적 쿠키는 사용하지 않습니다.',
          },
          {
            label: '브라우저 저장소(IndexedDB·localStorage)',
            text: '계정 스코프별로 분리된 학습 자료 본문·원본 보관(IndexedDB), 미제출 임시 답안·문제 편집 수정본·자료 저장 기본 정책·망각곡선 파라미터 설정 보관(localStorage)에 사용됩니다.',
          },
        ],
      },
      {
        type: 'section',
        heading: '보관·삭제·권리 행사',
        bulletItems: [
          {
            label: '삭제 및 연결 해제 동작의 구분',
            text: '앱 내 과목·자료 삭제(선택한 학습 데이터 삭제), 개인 API 키 연결 해제(ai_connections의 암호화 키 삭제), Google Drive 연결 해제(브라우저의 Drive 연결 쿠키 삭제), 브라우저 로컬 데이터 초기화는 서로 다른 동작입니다.',
          },
          {
            label: '즉시 완전 삭제 미보장 안내',
            text: '개별 자료 삭제나 연결 해제를 실행하더라도 서버 작업 로그, DB 백업 스냅샷, 또는 이미 외부(Google Drive 등)에 업로드된 파일까지 모두 즉시 삭제된다고 약속하지 않습니다.',
          },
          {
            label: '보유기간 및 권리 행사 창구 (확인 중)',
            text: '항목별 구체적 보유기간, 백업 파기 주기, 전체 계정 탈퇴 절차 및 개인정보 권리 행사(열람·정정·삭제·처리정지) 문의처는 운영자 확정 후 공지됩니다.',
          },
        ],
      },
      {
        type: 'pending-policy-list',
        heading: '운영자 확정 예정 항목 (안내 초안)',
        description:
          '정식 서비스 공개 전 운영자가 확정해야 하는 정책 정보 목록입니다. 확정 전까지 임의의 추정값을 표시하지 않습니다.',
        items: PENDING_OPERATOR_POLICY_ITEMS,
      },
    ],
  },

  ai: {
    id: 'ai',
    title: 'AI 이용 안내',
    shortLabel: 'AI 이용 안내',
    summary:
      'AI 기능 호출 시 외부로 전송되는 내용, 결과의 정확성 한계, 개인 API 키 암호화 및 체험 크레딧 기준을 안내합니다.',
    isDraftPolicy: true,
    blocks: [
      {
        type: 'section',
        heading: '전송되는 내용',
        paragraphs: [
          '사용자가 개념 분석, 문제 생성, 답안 평가, 논리 보완 질문, 유사 문제 변형, 문제 품질 검토 등 AI 기능을 실행하면, 각 기능 수행에 필요한 입력 데이터가 앱 서버를 통해 외부 AI 처리 경로(학교 BAZE Gateway 및 연결 모델)로 전송될 수 있습니다.',
        ],
        callout: {
          tone: 'important',
          title: '로컬 보관 자료와 AI 전송의 관계',
          text: '자료를 이 기기에 보관하는 설정과 AI 분석을 위한 전송은 별개입니다. 로컬 보관 자료라도 AI 기능을 실행하면 필요한 내용이 외부 처리 경로로 전송될 수 있습니다.',
        },
        bulletItems: [
          {
            label: '개념 분석 실행 시',
            text: '선택한 강의 자료의 Markdown 본문(또는 분할된 텍스트 청크)이 전송됩니다.',
          },
          {
            label: '문제 생성 실행 시',
            text: '선택한 자료의 본문 발췌, 대상 핵심 개념 정보, 문항 수 및 난이도·유형 조건이 전송됩니다.',
          },
          {
            label: '답안 평가 및 논리 보완 실행 시',
            text: '문제 지문, 모범 답안, 채점 기준(루브릭), 사용자가 작성한 답안과 풀이 근거가 전송됩니다.',
          },
          {
            label: '유사 문제 변형 및 품질 검토 실행 시',
            text: '대상 문제의 지문, 정답, 루브릭 및 관련 개념 정보가 전송됩니다.',
          },
        ],
      },
      {
        type: 'section',
        heading: '정확성과 검증의 한계',
        bulletItems: [
          {
            label: '오류 및 환각 가능성',
            text: 'AI가 생성한 문제, 모범 답안, 채점 점수, 감점 사유 및 원문 출처 표기는 부정확하거나 원문과 다른 내용을 포함할 수 있습니다.',
          },
          {
            label: '수학·통계 증명의 독립 검증 미보장',
            text: '수식 전개나 증명 과정의 수학적 정당성을 별도의 형식 검증 엔진으로 독립 검증했다고 보장하지 않으므로 원문 정의·정리와 대조해야 합니다.',
          },
          {
            label: '코드 답안의 정적 AI 검토와 실제 실행의 구분',
            text: '코딩 문제에 대한 AI 채점은 제출된 코드와 풀이 논리를 읽고 평가하는 정적 검토 방식이며, 실제 컴파일러나 샌드박스에서 코드를 실행해 테스트 케이스 통과 여부를 검증하는 채점 결과와 다릅니다.',
          },
        ],
      },
      {
        type: 'section',
        heading: '개인 API 키 관리',
        bulletItems: [
          {
            label: '이용 목적 및 연결 대상',
            text: '개인 API 키는 학교 BAZE Gateway(https://factchat-cloud.mindlogic.ai/v1/gateway, 기본 모델 deepseek-v4.1-flash)의 사용 가능 모델 확인과 사용자의 AI 요청 처리에만 사용됩니다.',
          },
          {
            label: '암호화 저장 및 마스킹 표시',
            text: '저장된 API 키는 서버 암호화 키(AI_CREDENTIAL_ENCRYPTION_KEY)를 이용한 AES-256-GCM 방식으로 암호화되어 DB(ai_connections)에 보관되며, 화면에는 마스킹된 힌트(예: 앞뒤 일부 글자)만 표시됩니다.',
          },
          {
            label: '보안상의 유의사항',
            text: '암호화 저장을 적용하고 있으나 “어떠한 환경에서도 절대 유출되지 않는다”거나 “외부 게이트웨이·네트워크의 어떤 로그에도 남지 않는다”는 무제한 보장을 의미하지는 않습니다. 불필요한 과다 권한 키 사용을 피하고 필요 시 키를 교체·회수하시기 바랍니다.',
          },
          {
            label: '연결 해제 경로',
            text: '로그인 후 ‘설정 > AI API 연결’에서 언제든지 [연결 해제] 버튼을 눌러 서버에 저장된 암호화 API 키를 삭제할 수 있습니다.',
          },
          {
            label: '학교 공식 운영 여부 안내',
            text: '본 서비스는 학교 BAZE Gateway 호출 규격을 연동 기능을 제공할 뿐, 학교나 게이트웨이 제공자가 본 학습 도구를 공식 운영하거나 품질을 보증하는 것은 아닙니다.',
          },
        ],
      },
      {
        type: 'section',
        heading: '입력 주의 사항',
        paragraphs: [
          '강의 자료 Markdown을 편집하거나 서술형 답안을 작성할 때 비밀번호, 개인 API 키, 주민등록번호, 계좌번호 등 불필요한 개인정보나 비밀정보를 본문에 포함하지 않도록 주의해 주십시오.',
          '현재 입력 본문에서 민감정보를 자동으로 탐지하여 마스킹·제거하는 기능이 모든 경로에 구현되어 있지 않으므로, 입력한 텍스트가 그대로 AI 요청에 포함될 수 있습니다.',
        ],
      },
      {
        type: 'section',
        heading: '체험 이용 및 크레딧 안내',
        bulletItems: [
          {
            label: '기본 제공 기준 (코드 기준)',
            text: '개인 API 키를 등록하기 전 기능을 시험해 볼 수 있도록 서버 정책상 간편 회원가입(아이디 가입) 계정은 기본 1회, 일반 계정(Google 로그인 등)은 기본 3회의 초기 체험 크레딧 부여 기준이 설정되어 있습니다. 다만 정책 변경, 서버 일일 호출 한도, 기존 사용 이력에 따라 달라질 수 있으므로 실제 잔여량은 로그인 후 화면에 표시되는 값을 따릅니다.',
          },
          {
            label: '차감 방식과 이용 제한',
            text: '체험 크레딧은 분량이 제한된 개념 분석(최대 2청크·12,000자), 문제 출제(최대 2문항·원문 15,000자), 개별 답안 평가(최대 6,000자)에서 지원되며, 모의시험 일괄 채점 등은 개인 API 키 등록이 필요합니다. 또한 동일 요청의 중복 방지(멱등 처리), 호출 전 오류 환급, 다중 청크 처리 등 작업 상태에 따라 처리되므로 “버튼 클릭 1회 = 항상 1크레딧 차감”으로 단정할 수 없습니다.',
          },
          {
            label: '개인 API 키 사용 시 비용',
            text: '개인 API 키를 연결해 사용할 때는 체험 크레딧이 차감되지 않으며, 실제 호출에 따른 비용·할당량 차감은 해당 API 키 제공자의 정책에 따릅니다.',
          },
        ],
      },
    ],
  },

  storage: {
    id: 'storage',
    title: '저장 및 백업',
    shortLabel: '저장 및 백업',
    summary:
      '로컬 우선 자료 보관 정책, 기기 간 이용 방법, PDF 변환 경로 및 로컬·Google Drive 백업 시 알아두어야 할 사항을 안내합니다.',
    isDraftPolicy: true,
    blocks: [
      {
        type: 'section',
        heading: '이 기기에 보관 (로컬 우선 방식)',
        bulletItems: [
          {
            label: '새 자료의 기본 정책',
            text: '새 학습 자료를 등록할 때 기본값은 본문(Markdown·전사본)과 원본 PDF를 이 기기의 브라우저(IndexedDB)에 보관하는 로컬 우선 방식입니다.',
          },
          {
            label: '메타데이터와 학습 기록의 서버 저장',
            text: '자료를 로컬에 보관하더라도 과목·시험일, 자료 연결에 필요한 메타데이터(제목·유형·페이지 수·해시·저장 정책), 추출된 개념, 생성된 문제, 풀이 답안 및 복습 이력은 서버(Supabase DB)에 저장됩니다.',
          },
          {
            label: '자료별 저장 정책 차이',
            text: '‘설정 > 자료 저장 정책’에서 본문 클라우드 동기화나 PDF 원본 클라우드 백업을 켜면 이후 새로 등록하는 자료부터 적용됩니다. 기존에 등록된 자료는 등록 당시의 정책을 유지하므로 모든 자료가 로컬 전용이거나 모두 서버에 저장되어 있다고 간주할 수 없습니다.',
          },
        ],
      },
      {
        type: 'section',
        heading: '다른 기기에서 이용',
        paragraphs: [
          '이 기기에만 보관된 원본 PDF와 변환 본문은 다른 컴퓨터, 태블릿, 스마트폰에서 같은 계정으로 로그인하더라도 자동으로 따라가지 않을 수 있습니다(과목·문제·풀이 기록과 자료 제목은 보이지만 본문 열람 시 로컬 파일 확인이 필요할 수 있습니다).',
          '여러 기기에서 본문과 원본을 함께 이용하려면 ‘설정 > 자료 저장 정책’에서 동기화·백업 설정을 확인하거나, 다른 기기에서 원본 파일 재연결 또는 백업 파일 복원 기능을 사용해 주십시오.',
        ],
      },
      {
        type: 'section',
        heading: '브라우저 데이터 손실 주의',
        paragraphs: [
          '브라우저의 인터넷 사용 기록·사이트 데이터 삭제, 기기 저장 공간 부족으로 인한 브라우저 자동 정리, 시크릿(사생활 보호) 창 사용, 브라우저 재설치 또는 기기 변경 시 브라우저 저장소(IndexedDB·localStorage)에 보관된 로컬 자료와 미제출 답안이 사라질 수 있습니다.',
          '중요한 강의 자료와 정리 내용은 반드시 원본 파일을 별도 보관하거나 ‘설정 > 데이터 이관·백업’의 내보내기로 백업 파일을 내려받아 보관하시기 바랍니다.',
        ],
      },
      {
        type: 'section',
        heading: 'PDF 변환 방식의 구분',
        bulletItems: [
          {
            label: '이 기기에서 변환 (브라우저 PDF.js · 기본값)',
            text: '사용자의 브라우저 내에서 직접 텍스트를 추출하므로, 변환 과정에서 원본 PDF 파일이 외부 변환 서버로 전송되지 않습니다.',
          },
          {
            label: '서버 정밀 변환 (선택 시)',
            text: '사용자가 서버 정밀 변환을 선택하면 원본 PDF가 외부 변환 서버(PDF_CONVERT_SERVICE_URL)로 전송되어 처리됩니다. 대용량 파일 경로에서는 변환 처리를 위해 클라우드 임시 저장소(temp-pdf-uploads)가 함께 사용될 수 있습니다.',
          },
          {
            label: '임시 파일 정리에 관한 안내',
            text: '변환 완료 후 삭제 처리 및 만료 작업 정리 경로(/api/cron/cleanup-temp-pdf)가 마련되어 있으나, 통신 중단이나 서버 오류 등 예외 상황까지 포함해 임시 파일이 언제나 즉시 삭제된다고 보장하지는 않습니다.',
          },
        ],
      },
      {
        type: 'section',
        heading: '로컬 백업 (파일 내보내기·가져오기)',
        bulletItems: [
          {
            label: '저장 위치 및 부분 백업 가능성',
            text: '로컬 백업을 실행하면 백업 파일이 사용자가 선택한 기기 저장 위치(다운로드 폴더 등)에 내려받아집니다. 만약 일부 자료의 본문이나 원본이 현재 기기에 없거나 읽기에 실패하면 ‘부분 백업’으로 생성될 수 있으며, 결과 안내에서 누락 항목을 확인할 수 있습니다.',
          },
          {
            label: '백업 파일 보관 주의 (비암호화 파일)',
            text: '서버에 저장되는 개인 API 키가 암호화되는 것과 달리, 내려받는 로컬 백업 파일 자체는 별도로 암호화되어 있지 않습니다(비밀키 혼입 여부는 사전 검사로 차단). 백업 파일에 강의 자료 본문이 그대로 담기므로 공용 기기나 외부에 노출되지 않는 안전한 위치에 보관해 주십시오.',
          },
        ],
      },
      {
        type: 'section',
        heading: 'Google Drive 백업',
        bulletItems: [
          {
            label: 'Google 로그인과의 구분 및 수동 업로드',
            text: '서비스 로그인을 위한 Google 인증과 Google Drive 백업 연결은 별도의 절차입니다. Drive를 연결한 뒤 사용자가 ‘설정 > 데이터 이관·백업’에서 백업 업로드를 직접 실행할 때 파일이 업로드되며, 백그라운드 자동 백업 기능은 제공하지 않습니다.',
          },
          {
            label: '연결 해제의 의미와 기존 파일 관리',
            text: '앱에서 [Google Drive 연결 해제]를 실행하면 앱의 연결 세션 쿠키가 제거되어 추가 업로드가 중단됩니다. 이는 기존에 Google Drive에 업로드된 백업 파일을 삭제하거나 Google 계정의 앱 권한을 철회하는 동작이 아니므로, 기존 백업 파일 삭제와 Google 권한 관리는 Google Drive 및 Google 계정 설정에서 별도로 수행할 수 있습니다.',
          },
        ],
      },
    ],
  },
};

export function getServiceGuideDocument(section: ServiceGuideSection): ServiceGuideDocument {
  return SERVICE_GUIDE_DOCUMENTS[section] ?? SERVICE_GUIDE_DOCUMENTS.overview;
}


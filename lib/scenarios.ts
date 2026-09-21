export type Track = "daily" | "work";

export type DialogueLine = {
  speaker: "ai" | "you";
  text: string;
  ko: string;
};

export type SeedChunk = {
  en: string;
  ko: string;
  /** 왜 이 청크인지 — 한국 학습자가 자주 놓치는 지점 */
  note: string;
};

export type Scenario = {
  id: string;
  track: Track;
  title: string;
  titleKo: string;
  /** 한 줄 상황 설명 */
  contextKo: string;
  /** 이 세션에서 해내야 하는 것 */
  goalKo: string;
  /** 모델 대화 — 듣기용 (의미중심 입력) */
  modelDialogue: DialogueLine[];
  /** 쉐도잉 + 청크 덱 적립 대상 */
  chunks: SeedChunk[];
  /** 롤플레이에서 AI가 맡는 배역 */
  aiRole: string;
  /** 롤플레이에서 내가 맡는 배역 */
  yourRole: string;
  /** AI의 첫 마디 */
  opening: string;
  /** AI 롤플레이 지침 (모델에 주입) */
  direction: string;
  /** 1차 롤플레이 제한 시간(초). 2차는 -30% */
  round1Seconds: number;
};

export const SCENARIOS: Scenario[] = [
  {
    id: "weekend-recap",
    track: "daily",
    title: "So, how was your weekend?",
    titleKo: "주말 뭐 했어?",
    contextKo: "월요일 아침, 같이 일하는 외국인 동료가 탕비실에서 말을 겁니다.",
    goalKo: "\"그냥 쉬었어\"로 끝내지 말고, 한 가지를 골라 세 문장 이상 이어서 말하기.",
    modelDialogue: [
      { speaker: "ai", text: "Morning! So how was your weekend?", ko: "안녕! 주말 어땠어?" },
      {
        speaker: "you",
        text: "Pretty good, actually. I finally got around to fixing my bike.",
        ko: "꽤 괜찮았어. 미루던 자전거 수리를 드디어 했거든.",
      },
      { speaker: "ai", text: "Oh nice, was it a big job?", ko: "오 좋네, 큰 작업이었어?" },
      {
        speaker: "you",
        text: "Bigger than I expected. It ended up taking the whole afternoon.",
        ko: "생각보다 컸어. 결국 오후를 통째로 썼어.",
      },
      { speaker: "ai", text: "Ha, that always happens. Worth it though?", ko: "하, 항상 그렇지. 그래도 할 만했어?" },
      {
        speaker: "you",
        text: "Totally. I rode it to work this morning, so I'm pretty happy about it.",
        ko: "완전. 오늘 아침에 타고 출근했어, 그래서 기분 좋아.",
      },
    ],
    chunks: [
      {
        en: "I finally got around to ~ing",
        ko: "미루다가 드디어 ~했어",
        note: "'드디어 했다'를 finally did로만 말하면 밋밋합니다. 미뤄왔다는 뉘앙스가 통째로 들어간 덩어리.",
      },
      {
        en: "It ended up taking ~",
        ko: "결국 ~나 걸렸어",
        note: "end up이 입에서 안 나오면 '결국'을 못 씁니다. 근황 말하기의 핵심 연결어.",
      },
      {
        en: "Bigger than I expected",
        ko: "생각보다 컸어",
        note: "than I expected는 통째로 외워두면 형용사만 갈아끼워 무한 재활용됩니다.",
      },
      {
        en: "Pretty good, actually",
        ko: "사실 꽤 괜찮았어",
        note: "actually 하나로 대화가 살아납니다. 단답을 막는 가장 싼 장치.",
      },
      {
        en: "I'm pretty happy about it",
        ko: "그래서 기분 좋아",
        note: "감정으로 마무리하면 상대가 받아칠 거리가 생깁니다. 대화를 끊지 않는 마침표.",
      },
    ],
    aiRole: "친한 외국인 직장 동료 Sam",
    yourRole: "월요일 아침의 나",
    opening: "Hey, morning! You look awake for a Monday. So — how was your weekend?",
    direction:
      "You are Sam, a friendly coworker chatting in the office kitchen on Monday morning. Keep it light and casual. Ask natural follow-up questions about whatever the user mentions. Never lecture or correct. If the user gives a one-line answer, ask one curious follow-up to draw out more.",
    round1Seconds: 180,
  },
  {
    id: "keep-it-going",
    track: "daily",
    title: "Keeping the conversation alive",
    titleKo: "맞장구치고 되물어보기",
    contextKo: "상대가 자기 얘기를 합니다. 당신은 듣기만 하면 됩니다 — 단, 침묵하지 않고.",
    goalKo: "상대 말에 반응하고 되물어서, 내가 먼저 끊지 않고 대화를 굴러가게 만들기.",
    modelDialogue: [
      { speaker: "ai", text: "I just got back from a trip to Vietnam, actually.", ko: "사실 나 방금 베트남 여행 다녀왔어." },
      { speaker: "you", text: "Oh really? How long were you there?", ko: "어 진짜? 얼마나 있었어?" },
      { speaker: "ai", text: "Ten days. Mostly in the north, around Hanoi.", ko: "10일. 주로 북쪽, 하노이 근처." },
      { speaker: "you", text: "That sounds amazing. What made you pick the north?", ko: "좋았겠다. 왜 북쪽으로 정한 거야?" },
      { speaker: "ai", text: "Honestly, the food. I'd heard the northern food is different.", ko: "솔직히 음식 때문에. 북쪽 음식이 다르다고 들었거든." },
      { speaker: "you", text: "Wait, really? I had no idea. Different how?", ko: "어 진짜? 전혀 몰랐어. 어떻게 다른데?" },
    ],
    chunks: [
      {
        en: "Oh really? / Wait, really?",
        ko: "어 진짜?",
        note: "가장 싼 맞장구. 이게 자동으로 안 나오면 침묵이 생깁니다.",
      },
      {
        en: "That sounds amazing / rough / exhausting",
        ko: "그거 좋았겠다 / 힘들었겠다",
        note: "sounds + 형용사. 공감 표현을 한 패턴으로 끝냅니다.",
      },
      {
        en: "What made you ~?",
        ko: "왜 ~하게 된 거야?",
        note: "Why did you보다 훨씬 부드럽고, 상대가 길게 답하게 만듭니다.",
      },
      {
        en: "I had no idea",
        ko: "전혀 몰랐어",
        note: "I didn't know는 정보 부족, I had no idea는 리액션입니다. 쓰임이 다릅니다.",
      },
      {
        en: "Different how? / Rough how?",
        ko: "어떻게 다른데?",
        note: "한 단어 되묻기. 문장 만들 필요 없이 대화를 이어붙이는 최고 효율 장치.",
      },
    ],
    aiRole: "수다스러운 친구 Maya",
    yourRole: "듣는 쪽",
    opening: "Okay so — you will not believe the two weeks I've had. I just got back from a trip, actually.",
    direction:
      "You are Maya, a chatty friend with a story to tell. Share your story in small pieces and pause often so the user has to react. Reward every reaction or follow-up question by revealing something more interesting. If the user goes silent or only says 'yes', pause and ask them something directly. Never correct their English.",
    round1Seconds: 180,
  },
  {
    id: "why-you-like-it",
    track: "daily",
    title: "Why do you like it?",
    titleKo: "취향과 이유 설명하기",
    contextKo: "누가 당신에게 왜 그걸 좋아하냐고 묻습니다. \"그냥 좋아\"는 금지입니다.",
    goalKo: "이유를 한 개가 아니라 두 개 대고, 그중 하나는 구체적인 예시로 뒷받침하기.",
    modelDialogue: [
      { speaker: "ai", text: "You said you're into hiking — what's the appeal?", ko: "등산 좋아한다고 했지 — 뭐가 좋아?" },
      {
        speaker: "you",
        text: "A couple of things. For one, it's the only time my head actually goes quiet.",
        ko: "몇 가지 있어. 우선, 머릿속이 진짜 조용해지는 유일한 시간이야.",
      },
      { speaker: "ai", text: "Mm, I get that. What else?", ko: "음, 알 것 같아. 또?" },
      {
        speaker: "you",
        text: "And there's something about the payoff. Like, last month I did Bukhansan and the view at the top just — it was worth every step.",
        ko: "그리고 보상 같은 게 있어. 지난달에 북한산 갔는데 정상 뷰가 진짜 — 한 걸음 한 걸음이 아깝지 않았어.",
      },
      { speaker: "ai", text: "That's a good reason. I'm more of an indoors person myself.", ko: "좋은 이유네. 난 실내파에 가까워." },
      { speaker: "you", text: "Fair enough. It's definitely not for everyone.", ko: "그럴 만하지. 확실히 모두를 위한 건 아니야." },
    ],
    chunks: [
      {
        en: "A couple of things. For one, ~",
        ko: "몇 가지 있는데, 우선 ~",
        note: "말을 시작하면서 생각할 시간을 버는 장치. 침묵 대신 이걸 깝니다.",
      },
      {
        en: "There's something about ~",
        ko: "~에는 뭔가가 있어",
        note: "설명하기 어려운 감정을 얼버무리지 않고 표현하는 방법.",
      },
      { en: "It was worth every ~", ko: "~할 가치가 충분했어", note: "구체적 경험을 감정으로 닫는 마무리 문형." },
      { en: "I'm more of a ~ person", ko: "나는 ~쪽에 가까워", note: "취향을 단정하지 않고 말하는 안전한 틀." },
      { en: "It's not for everyone", ko: "모두한테 맞는 건 아니지", note: "취향 차이를 인정하며 대화를 부드럽게 닫습니다." },
    ],
    aiRole: "궁금한 게 많은 새 친구 Alex",
    yourRole: "취향을 설명하는 나",
    opening: "I'm curious about something. Tell me about a thing you actually enjoy doing — and then tell me why.",
    direction:
      "You are Alex, a curious new friend. Ask the user about something they enjoy, then keep pressing gently for reasons and concrete examples: 'why though?', 'can you give me an example?', 'what else?'. Push for a second reason if they only give one. Stay warm, never judgmental.",
    round1Seconds: 180,
  },
  {
    id: "standup-update",
    track: "work",
    title: "Your 30-second standup",
    titleKo: "스탠드업 30초 업데이트",
    contextKo: "데일리 스탠드업. 당신 차례입니다. 모두가 기다리고 있습니다.",
    goalKo: "어제 한 일 / 오늘 할 일 / 막힌 것 세 덩어리로, 더듬지 않고 30초 안에.",
    modelDialogue: [
      { speaker: "ai", text: "Okay, let's go around. You want to start?", ko: "좋아요, 돌아가며 하죠. 먼저 하실래요?" },
      {
        speaker: "you",
        text: "Sure. Yesterday I wrapped up the login flow and pushed it for review.",
        ko: "네. 어제 로그인 플로우를 마무리하고 리뷰 올렸습니다.",
      },
      {
        speaker: "you",
        text: "Today I'm picking up the error handling on the payment side.",
        ko: "오늘은 결제 쪽 에러 핸들링을 맡을 예정입니다.",
      },
      {
        speaker: "you",
        text: "One thing I'm blocked on — I still need access to the staging database.",
        ko: "한 가지 막힌 게 있는데, 스테이징 DB 접근 권한이 아직 없습니다.",
      },
      { speaker: "ai", text: "Got it, I'll sort that out after this. Anything else?", ko: "알겠습니다, 끝나고 처리할게요. 더 있나요?" },
      { speaker: "you", text: "That's it from me.", ko: "저는 여기까지입니다." },
    ],
    chunks: [
      { en: "I wrapped up ~ and pushed it for review", ko: "~를 마무리하고 리뷰 올렸습니다", note: "finish 대신 wrap up. 스탠드업에서 가장 많이 쓰는 동사." },
      { en: "Today I'm picking up ~", ko: "오늘은 ~를 맡습니다", note: "I will do보다 자연스럽고 짧습니다." },
      { en: "One thing I'm blocked on —", ko: "한 가지 막힌 건요 —", note: "문제 제기를 변명처럼 들리지 않게 여는 표현." },
      { en: "I still need access to ~", ko: "아직 ~ 접근 권한이 필요합니다", note: "요청을 사실 진술로 바꿔서 부담 없이 전달합니다." },
      { en: "That's it from me", ko: "저는 여기까지입니다", note: "끝을 명확히 닫아야 다음 사람이 이어받습니다. 어물쩍 끝내지 않기." },
    ],
    aiRole: "팀 리드 Priya",
    yourRole: "업데이트할 차례인 나",
    opening: "Alright everyone, quick standup. Let's start with you — what have you got?",
    direction:
      "You are Priya, a team lead running a fast daily standup. Keep your turns very short. After the user's update, ask at most one clarifying question, then move on. Create mild time pressure with phrases like 'quick one' or 'we've got five minutes'. Never correct their English.",
    round1Seconds: 150,
  },
  {
    id: "polite-disagree",
    track: "work",
    title: "Disagreeing without being rude",
    titleKo: "정중하게 반대하기",
    contextKo: "회의에서 나온 제안에 동의하지 않습니다. 하지만 관계도 지켜야 합니다.",
    goalKo: "먼저 인정하고, 그 다음 반대하고, 대안까지 제시하는 3단 구조로 말하기.",
    modelDialogue: [
      { speaker: "ai", text: "So I think we should just ship it Friday and fix issues next week.", ko: "금요일에 그냥 배포하고 다음 주에 고치면 될 것 같아요." },
      {
        speaker: "you",
        text: "I see where you're coming from — the timeline pressure is real.",
        ko: "무슨 말씀인지 알겠습니다 — 일정 압박이 실제로 있죠.",
      },
      {
        speaker: "you",
        text: "That said, I'd be a bit careful about shipping on a Friday.",
        ko: "다만, 금요일 배포는 좀 조심스럽습니다.",
      },
      { speaker: "ai", text: "Why's that?", ko: "왜죠?" },
      {
        speaker: "you",
        text: "If something breaks, nobody's around over the weekend. What if we went with Monday instead?",
        ko: "뭔가 터지면 주말엔 아무도 없습니다. 대신 월요일로 가는 건 어떨까요?",
      },
      { speaker: "ai", text: "Hmm. Yeah, that's a fair point.", ko: "음. 네, 일리 있네요." },
    ],
    chunks: [
      { en: "I see where you're coming from", ko: "무슨 말씀인지 알겠습니다", note: "반대 전에 반드시 까는 쿠션. 이거 없이 반대하면 무례하게 들립니다." },
      { en: "That said, ~", ko: "다만, ~", note: "But보다 훨씬 정중하게 방향을 트는 접속어." },
      { en: "I'd be a bit careful about ~", ko: "~는 좀 조심스럽습니다", note: "I disagree를 직접 말하지 않고 반대하는 완충 표현." },
      { en: "What if we went with ~ instead?", ko: "대신 ~로 가는 건 어떨까요?", note: "반대만 하면 트러블메이커, 대안까지 내면 기여자가 됩니다." },
      { en: "That's a fair point", ko: "일리 있네요", note: "상대 반론을 받아칠 때. 인정하면서도 지지 않는 표현." },
    ],
    aiRole: "밀어붙이는 동료 PM Dan",
    yourRole: "반대 의견이 있는 나",
    opening:
      "Quick one before we wrap — I want to ship the release this Friday and just patch anything that breaks next week. Sound good?",
    direction:
      "You are Dan, a PM who is confident and pushes back once. When the user disagrees, do not fold immediately — ask 'why's that?' and defend your position one time. If they acknowledge your view and offer a concrete alternative, concede gracefully. Stay professional and friendly. Never correct their English.",
    round1Seconds: 180,
  },
  {
    id: "push-deadline",
    track: "work",
    title: "Asking to push a deadline",
    titleKo: "마감 연기 요청하기",
    contextKo: "약속한 마감을 못 맞춥니다. 오늘 말해야 합니다.",
    goalKo: "변명하지 말고: 상황 인정 → 이유 한 줄 → 새 날짜 제안 → 그때까지 할 수 있는 것.",
    modelDialogue: [
      { speaker: "you", text: "Do you have two minutes? It's about the report deadline.", ko: "2분만 시간 되세요? 보고서 마감 관련해서요." },
      { speaker: "ai", text: "Sure, what's up?", ko: "네, 무슨 일이죠?" },
      {
        speaker: "you",
        text: "I want to give you a heads-up — I don't think I'll make Thursday.",
        ko: "미리 말씀드리자면, 목요일은 못 맞출 것 같습니다.",
      },
      { speaker: "ai", text: "Okay. What's holding it up?", ko: "네. 뭐가 걸리나요?" },
      {
        speaker: "you",
        text: "The data came in later than planned. Would Monday work instead? I can send you the first half on Thursday.",
        ko: "데이터가 예정보다 늦게 들어왔습니다. 월요일은 괜찮으실까요? 목요일에 앞부분 절반은 보내드릴 수 있습니다.",
      },
      { speaker: "ai", text: "That works. Thanks for flagging it early.", ko: "괜찮습니다. 일찍 알려줘서 고마워요." },
    ],
    chunks: [
      { en: "Do you have two minutes?", ko: "2분만 시간 되세요?", note: "본론 전에 상대의 동의를 먼저 받는 장치. 한국어 습관 그대로 직역하면 어색해집니다." },
      { en: "I want to give you a heads-up", ko: "미리 말씀드리자면", note: "나쁜 소식을 '사고 보고'가 아니라 '사전 공유'로 프레이밍합니다." },
      { en: "I don't think I'll make ~", ko: "~는 못 맞출 것 같습니다", note: "I can't finish보다 부드럽고, 확정이 아닌 판단으로 전달됩니다." },
      { en: "Would Monday work instead?", ko: "대신 월요일은 괜찮으실까요?", note: "연기 요청은 반드시 구체적 날짜와 함께. 빈손으로 가면 안 됩니다." },
      { en: "I can send you ~ in the meantime", ko: "그동안 ~는 보내드릴 수 있습니다", note: "부분 납품 제안. 신뢰를 지키는 결정적 한 마디." },
    ],
    aiRole: "직속 상사 Rachel",
    yourRole: "마감을 못 맞추는 나",
    opening: "Hey, you wanted to talk? I've got a few minutes before my next call.",
    direction:
      "You are Rachel, the user's manager. You are reasonable but busy. Wait for the user to bring up the deadline themselves — do not raise it for them. Ask 'what's holding it up?' once. If they propose a concrete new date and a partial deliverable, accept warmly. If they are vague, ask for a specific date. Never correct their English.",
    round1Seconds: 180,
  },
];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export const TRACK_LABEL: Record<Track, string> = {
  daily: "일상",
  work: "업무",
};

/**
 * Language primitives shared by the resident conversation UI and the model
 * gateway.  These are reviewed static strings: they are not generated or
 * translated at request time.
 */
export type ConversationLanguage = 'ja' | 'en' | 'zh' | 'ko';

export function normalizeConversationLanguage(value: unknown): ConversationLanguage {
  return value === 'en' || value === 'zh' || value === 'ko' ? value : 'ja';
}

export function speechLanguageTag(language: ConversationLanguage): string {
  return language === 'en' ? 'en-US' : language === 'zh' ? 'zh-CN' : language === 'ko' ? 'ko-KR' : 'ja-JP';
}

export function conversationLanguageName(language: ConversationLanguage): string {
  return language === 'en' ? 'English' : language === 'zh' ? '中文' : language === 'ko' ? '한국어' : '日本語';
}

export function conversationLanguageInstruction(language: ConversationLanguage): string {
  if (language === 'en') return 'Reply only in English. Do not include Japanese or any other language. Keep names, shelter zone names, numbers, times, symptoms, uncertainty, and urgency exactly as stated.';
  if (language === 'zh') return '请只用中文回答，不要夹带日语或其他语言。请准确保留姓名、避难所区域名称、数字、时间、症状、不确定性和紧急程度。';
  if (language === 'ko') return '한국어로만 답변하세요. 일본어나 다른 언어를 섞지 마세요. 이름, 대피소 구역명, 숫자, 시간, 증상, 불확실성, 긴급도를 원문 그대로 유지하세요.';
  return '日本語だけで回答してください。氏名、避難所の場所名、数字、時刻、症状、不確実性、緊急度を原文どおり保ってください。';
}

type Field = '場所' | '人数' | '残量' | '最後に受け取った時刻' | '追加確認';

const SAFETY_FLAG_LABELS: Record<string, Record<ConversationLanguage, string>> = {
  '意識・呼吸の異常': { ja: '意識・呼吸の異常', en: 'Abnormal consciousness or breathing', zh: '意识或呼吸异常', ko: '의식 또는 호흡 이상' },
  '大量出血': { ja: '大量出血', en: 'Heavy bleeding', zh: '大量出血', ko: '심한 출혈' },
  '強い胸痛': { ja: '強い胸痛', en: 'Severe chest pain', zh: '严重胸痛', ko: '심한 흉통' },
  '火災・煙': { ja: '火災・煙', en: 'Fire or smoke', zh: '火灾或烟雾', ko: '화재 또는 연기' },
  '暴力・武器': { ja: '暴力・武器', en: 'Violence or weapon', zh: '暴力或武器', ko: '폭력 또는 무기' },
  '自傷・他害': { ja: '自傷・他害', en: 'Risk of self-harm or harm to others', zh: '自伤或伤害他人风险', ko: '자해 또는 타해 위험' },
  '重大な体調変化': { ja: '重大な体調変化', en: 'Serious health change', zh: '严重身体变化', ko: '심각한 건강 변화' },
  '建物・閉じ込め': { ja: '建物・閉じ込め', en: 'Building danger or trapped', zh: '建筑危险或被困', ko: '건물 위험 또는 갇힘' },
};

export function localizedSafetyFlagLabel(value: string, language: ConversationLanguage): string {
  return SAFETY_FLAG_LABELS[value]?.[language] ?? value;
}

const FIELD_QUESTIONS: Record<Field, Record<ConversationLanguage, string>> = {
  場所: {
    ja: '避難所のどのあたりにいますか？（例：1階、受付の近く）',
    en: 'Where are you currently located in the shelter? (For example, near the reception desk.)',
    zh: '您现在在避难所的什么位置？（例如：一楼、接待处附近）',
    ko: '현재 대피소의 어디에 계신가요? (예: 접수처 근처, 1층)',
  },
  人数: {
    ja: '何人くらいで困っていますか？',
    en: 'How many people are affected?',
    zh: '有几个人受到影响？',
    ko: '몇 명이 영향을 받고 있나요?',
  },
  残量: {
    ja: '必要なものはあとどのくらいありますか？',
    en: 'How much of the needed item do you have left?',
    zh: '需要的物品还剩多少？',
    ko: '필요한 물품이 얼마나 남아 있나요?',
  },
  最後に受け取った時刻: {
    ja: '最後に受け取ったのはいつごろですか？',
    en: 'When did you last receive it?',
    zh: '您上一次收到它是什么时候？',
    ko: '마지막으로 받은 시간은 언제인가요?',
  },
  追加確認: {
    ja: 'いちばん気になる状況を教えてください。',
    en: 'Please tell us the situation that concerns you most.',
    zh: '请告诉我们您最担心的情况。',
    ko: '가장 걱정되는 상황을 알려주세요.',
  },
};

const TOILET_QUESTIONS: Record<ConversationLanguage, string> = {
  ja: 'そのトイレは今、使えますか？',
  en: 'Can that toilet be used right now?',
  zh: '那个厕所现在可以使用吗？',
  ko: '그 화장실은 지금 사용할 수 있나요?',
};

const OPTION_LABELS: Record<string, Record<ConversationLanguage, string>> = {
  '1人': { ja: '1人', en: '1 person', zh: '1人', ko: '1명' },
  '2〜5人': { ja: '2〜5人', en: '2–5 people', zh: '2–5人', ko: '2~5명' },
  '6人以上': { ja: '6人以上', en: '6 or more people', zh: '6人以上', ko: '6명 이상' },
  'わからない': { ja: 'わからない', en: "I don't know", zh: '不知道', ko: '모르겠습니다' },
  'ほとんどない': { ja: 'ほとんどない', en: 'Almost none', zh: '几乎没有', ko: '거의 없음' },
  '少しある': { ja: '少しある', en: 'A little remains', zh: '还有一点', ko: '조금 남음' },
  'まだある': { ja: 'まだある', en: 'There is still some', zh: '还有一些', ko: '아직 있음' },
  '今日': { ja: '今日', en: 'Today', zh: '今天', ko: '오늘' },
  '昨日': { ja: '昨日', en: 'Yesterday', zh: '昨天', ko: '어제' },
  'それより前': { ja: 'それより前', en: 'Earlier', zh: '更早之前', ko: '그 이전' },
  '今すぐ': { ja: '今すぐ', en: 'Now', zh: '现在', ko: '지금 바로' },
  '数時間以内': { ja: '数時間以内', en: 'Within a few hours', zh: '几小时内', ko: '몇 시간 이내' },
  '今日中': { ja: '今日中', en: 'By today', zh: '今天之内', ko: '오늘 안에' },
  '急がない': { ja: '急がない', en: 'Not urgent', zh: '不着急', ko: '급하지 않음' },
  '使える': { ja: '使える', en: 'Yes, it can be used', zh: '可以使用', ko: '사용 가능' },
  '使えない': { ja: '使えない', en: 'No, it cannot be used', zh: '无法使用', ko: '사용할 수 없음' },
  '意識はある': { ja: '意識はある', en: 'Conscious', zh: '有意识', ko: '의식이 있음' },
  '呼吸が苦しい': { ja: '呼吸が苦しい', en: 'Having trouble breathing', zh: '呼吸困难', ko: '호흡이 어려움' },
  '痛みがある': { ja: '痛みがある', en: 'There is pain', zh: '有疼痛', ko: '통증이 있음' },
  '薬が必要': { ja: '薬が必要', en: 'Needs medicine', zh: '需要药物', ko: '약이 필요함' },
};

export function localizedFieldQuestion(field: Field, category: string, language: ConversationLanguage): string {
  if (field === '追加確認' && category === 'トイレ・衛生') return TOILET_QUESTIONS[language];
  if (field === '残量' && category === '水・飲料') {
    return language === 'en' ? 'How much drinking water do you have left?' : language === 'zh' ? '饮用水还剩多少？' : language === 'ko' ? '식수가 얼마나 남아 있나요?' : '飲み水はあとどのくらいありますか？';
  }
  return FIELD_QUESTIONS[field][language];
}

export function localizedFieldOptionLabel(value: string, language: ConversationLanguage): string {
  return OPTION_LABELS[value]?.[language] ?? value;
}

export function localizedAcknowledgement(language: ConversationLanguage, urgent: boolean, urgency: string): string {
  if (urgent) return language === 'en' ? 'We will notify staff first because this may be urgent.' : language === 'zh' ? '这可能是紧急情况，我们会先通知工作人员。' : language === 'ko' ? '긴급한 내용일 수 있어 먼저 직원에게 알리겠습니다.' : '緊急の可能性がある内容として、先に職員へ知らせます。';
  if (urgency === 'high' || urgency === 'medium') return language === 'en' ? 'We will check the situation.' : language === 'zh' ? '我们会确认情况。' : language === 'ko' ? '상황을 확인하겠습니다.' : '状況を確認します。';
  return language === 'en' ? 'We will ask only for the information we need.' : language === 'zh' ? '我们只确认必要的信息。' : language === 'ko' ? '필요한 정보만 확인하겠습니다.' : '必要な情報だけ確認します。';
}

export function localizedEmergencyReply(language: ConversationLanguage, askLocation: boolean): string {
  const location = language === 'en' ? ' Please tell us where you are now.' : language === 'zh' ? '请告诉我们您现在的位置。' : language === 'ko' ? '현재 위치를 알려주세요.' : '今いる場所を教えてください。';
  const staff = language === 'en' ? ' Please also tell a nearby staff member immediately.' : language === 'zh' ? '请同时立即告知附近的工作人员。' : language === 'ko' ? '가까운 직원에게도 즉시 알려주세요.' : '近くの職員にもすぐ知らせてください。';
  return `${localizedAcknowledgement(language, true, 'critical')}${askLocation ? location : staff}`;
}

export function localizedReadyReply(language: ConversationLanguage): string {
  return language === 'en' ? 'I’ve noted what you said. You can keep speaking, or review what will be sent to shelter staff.' : language === 'zh' ? '我已经记下您说的内容。您可以继续说，也可以确认将发送给工作人员的内容。' : language === 'ko' ? '말씀하신 내용을 받았습니다. 계속 말하거나 직원에게 보낼 내용을 확인할 수 있습니다.' : 'ここまでのお話を受け取りました。続けて話すことも、職員へ送る内容を確認することもできます。';
}

export function localizedContinueReply(language: ConversationLanguage): string {
  return language === 'en' ? 'Please tell us what is troubling you in your own words. We will only ask when something needs to be confirmed.' : language === 'zh' ? '请用您自己的话说说遇到了什么困难。只有需要确认时，我们才会提问。' : language === 'ko' ? '어려운 점을 편한 말로 계속 말씀해 주세요. 확인이 필요할 때만 질문하겠습니다.' : '困っていることを、そのまま続けて話してください。必要なときだけ確認します。';
}

export function localizedSafetyFallback(language: ConversationLanguage): string {
  return language === 'en' ? 'We will check the situation. Please tell us one piece of information at a time.' : language === 'zh' ? '我们会确认情况。请一次告诉我们一项信息。' : language === 'ko' ? '상황을 확인하겠습니다. 한 번에 한 가지 정보만 알려주세요.' : '状況を確認します。必要な情報を一つだけ教えてください。';
}

export function localizeIncidentCard(state: { location?: string; target?: { ageGroup?: string; count?: number }; originalText: string[] }, language: ConversationLanguage): string {
  if (language === 'ja') return '';
  const location = state.location || (language === 'en' ? 'Not confirmed' : language === 'zh' ? '尚未确认' : '확인되지 않음');
  const target = state.target?.count
    ? language === 'en' ? `${state.target.count} ${state.target.count === 1 ? 'person' : 'people'}` : language === 'zh' ? `${state.target.count}人` : `${state.target.count}명`
    : language === 'en' ? 'Not confirmed' : language === 'zh' ? '尚未确认' : '확인되지 않음';
  const label = language === 'en' ? ['Location', 'People affected', 'What you told us'] : language === 'zh' ? ['位置', '受影响人数', '您告诉我们的内容'] : ['위치', '영향을 받는 사람 수', '말씀해 주신 내용'];
  return `${label[0]}: ${location}\n${label[1]}: ${target}\n${label[2]}:\n${state.originalText.join('\n') || (language === 'en' ? 'Checking' : language === 'zh' ? '确认中' : '확인 중')}`;
}

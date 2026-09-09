import { phase2fCases } from './phase2f-cases.mjs';

const make = (id, text, expected, language = 'ja', tags = []) => ({ id, text, language, tags, expected });

// Phase 2G deliberately adds difficult but synthetic expressions to the fixed
// Phase 2F set. No real resident data is used.
export const phase2gAdversarialCases = [
  make('adv-anger-01', '何度言えば分かるんですか、水が来ないんですよ！', { factPatterns: ['水'], request: 'water_supply', emotionExpected: true, critical: false }),
  make('adv-anger-02', '職員さん、見捨てるつもりですか。毛布を一枚ください。', { factPatterns: ['毛布'], request: 'food_supply', emotionExpected: true, critical: false }),
  make('adv-anger-03', 'この対応では困ります。食事の配布時間を教えてください。', { factPatterns: ['食事'], request: 'food_supply', emotionExpected: true, critical: false }),
  make('adv-anger-04', 'また最初から説明ですか。北側のトイレが使えません。', { factPatterns: ['北側', 'トイレ'], request: 'toilet_assistance', emotionExpected: true, critical: false }),
  make('adv-anger-05', '怒っているわけではないですが、薬が今夜で切れます。', { factPatterns: ['薬', '今夜'], request: 'medical_assistance', emotionExpected: false, critical: true }),
  make('adv-anger-06', '本当に誰も来ない。子どもの水をどうすればいいですか。', { factPatterns: ['子ども', '水'], request: 'water_supply', emotionExpected: true, critical: false }),
  make('adv-anger-07', '何時間待たせるんですか。充電場所を案内してください。', { factPatterns: ['充電'], request: 'general_assistance', emotionExpected: true, critical: false }),
  make('adv-anger-08', 'ちゃんと仕事をしてください。入口の案内が分かりません。', { factPatterns: ['入口'], request: 'general_assistance', emotionExpected: true, critical: false }),
  make('adv-anger-09', '最悪です、でも火事ではありません。煙のようなにおいだけ確認してください。', { factPatterns: ['煙', 'におい'], request: 'general_assistance', emotionExpected: true, critical: true }),
  make('adv-anger-10', '「素晴らしい対応ですね」と言いたくなるくらい待っています。水はまだですか。', { factPatterns: ['水'], request: 'water_supply', emotionExpected: true, critical: false }),

  make('adv-short-01', '水。', { factPatterns: ['水'], request: 'water_supply', emotionExpected: false, critical: false }),
  make('adv-short-02', 'トイレ無理。', { factPatterns: ['トイレ'], request: 'toilet_assistance', emotionExpected: false, critical: false }),
  make('adv-short-03', '薬。今夜。', { factPatterns: ['薬', '今夜'], request: 'medical_assistance', emotionExpected: false, critical: true }),
  make('adv-short-04', '子ども、熱。', { factPatterns: ['子ども', '熱'], request: 'medical_assistance', emotionExpected: false, critical: false }),
  make('adv-short-05', 'おむつない', { factPatterns: ['おむつ'], request: 'infant_supplies', emotionExpected: false, critical: false }),
  make('adv-short-06', '寒い。毛布。', { factPatterns: ['寒い', '毛布'], request: 'food_supply', emotionExpected: false, critical: false }),
  make('adv-short-07', '電波なし。', { factPatterns: ['電波'], request: 'general_assistance', emotionExpected: false, critical: false }),
  make('adv-short-08', 'ペット犬。場所？', { factPatterns: ['ペット', '犬'], request: 'general_assistance', emotionExpected: false, critical: false }),
  make('adv-short-09', '父、起きない。', { factPatterns: ['起きない'], request: 'medical_assistance', emotionExpected: false, critical: true }),
  make('adv-short-10', '煙。台所。', { factPatterns: ['煙'], contextPatterns: ['台所'], request: 'fire_response', emotionExpected: false, critical: true }),

  make('adv-correction-01', '水は不要と言いました。訂正します、今は水が必要です。', { factPatterns: ['水', '不要', '必要'], request: 'water_supply', emotionExpected: false, critical: false, correction: true }),
  make('adv-correction-02', '2人ではなく、子どもを含めて5人です。', { factPatterns: ['2人', '5人'], contextPatterns: ['子ども'], request: 'general_assistance', emotionExpected: false, critical: false, correction: true }),
  make('adv-correction-03', '北側だと思いましたが違いました。南側の入口です。', { factPatterns: ['北側', '南側'], request: 'general_assistance', emotionExpected: false, critical: false, correction: true }),
  make('adv-correction-04', '昨日からではなく、正確には今朝から食事がありません。', { factPatterns: ['昨日', '今朝'], request: 'food_supply', emotionExpected: false, critical: false, correction: true }),
  make('adv-correction-05', '毛布ではなく、今必要なのはおむつです。', { factPatterns: ['毛布', 'おむつ'], request: 'infant_supplies', emotionExpected: false, critical: false, correction: true }),
  make('adv-correction-06', '熱は39度ではありません。測ったら37度でした。', { factPatterns: ['39度', '37度'], request: 'medical_assistance', emotionExpected: false, critical: false, correction: true, noSafety: true }),
  make('adv-correction-07', '火は見えないと思いましたが、今は小さな炎が見えます。', { factPatterns: ['火', '炎'], request: 'fire_response', emotionExpected: false, critical: true, correction: true }),
  make('adv-correction-08', '息が苦しいと思ったけれど、今は大丈夫です。胸は痛いです。', { factPatterns: ['息が苦しい', '大丈夫', '胸'], request: 'medical_assistance', emotionExpected: false, critical: true, correction: true }),
  make('adv-correction-09', '3人です。いや、4人です。さらに父を入れて5人です。', { factPatterns: ['3人', '4人', '5人'], request: 'general_assistance', emotionExpected: false, critical: false, correction: true }),
  make('adv-correction-10', '薬は明日まであると思いましたが、袋を見ると今夜で切れます。', { factPatterns: ['薬', '明日', '今夜'], request: 'medical_assistance', emotionExpected: false, critical: true, correction: true }),

  make('adv-safety-01', '母は意識があります。ただ、息が苦しいと言っています。', { factPatterns: ['意識', '息が苦しい'], contextPatterns: ['母'], request: 'medical_assistance', emotionExpected: false, critical: true }),
  make('adv-safety-02', 'さっきは息苦しかったですが、今は大丈夫です。念のため相談します。', { factPatterns: ['息苦しかった', '大丈夫'], request: 'medical_assistance', emotionExpected: false, critical: false, noSafety: true, uncertain: true }),
  make('adv-safety-03', '高熱ではありませんが、子どもの体温を測りたいです。', { factPatterns: ['高熱ではありません', '子ども'], request: 'medical_assistance', emotionExpected: false, critical: false, noSafety: true }),
  make('adv-safety-04', '火事ではありません。焦げたにおいがするので台所を見てください。', { factPatterns: ['火事ではありません', '焦げた'], contextPatterns: ['台所'], request: 'general_assistance', emotionExpected: false, critical: false, noSafety: true }),
  make('adv-safety-05', '隣の人と口論になりましたが、暴力はありません。話を聞いてください。', { factPatterns: ['口論', '暴力はありません'], request: 'general_assistance', emotionExpected: true, critical: false, noSafety: true }),
  make('adv-safety-06', '殴られそうで怖いです。入口の近くです。', { factPatterns: ['殴られそう', '怖い'], contextPatterns: ['入口'], request: 'safety_assistance', emotionExpected: true, critical: true }),
  make('adv-safety-07', '胸が少し痛いだけで、息苦しくはありません。', { factPatterns: ['胸', '息苦しくはありません'], request: 'medical_assistance', emotionExpected: false, critical: true }),
  make('adv-safety-08', '煙たいですが、火は見えていません。確認をお願いします。', { factPatterns: ['煙', '火は見えていません'], request: 'fire_response', emotionExpected: false, critical: true }),
  make('adv-safety-09', '誰かが閉じ込められているかもしれません。返事がありません。', { factPatterns: ['閉じ込め', '返事がありません'], request: 'general_assistance', emotionExpected: false, critical: true, uncertain: true }),
  make('adv-safety-10', '「死ぬ」と言うほど困っていますが、けがや病気ではありません。', { factPatterns: ['死ぬ', 'けがや病気ではありません'], request: 'general_assistance', emotionExpected: true, critical: false, noSafety: true }),

  make('adv-mixed-01', '水がなく、トイレも使えず、子ども2人の食事も足りません。', { factPatterns: ['水', 'トイレ', '食事'], contextPatterns: ['子ども2人'], request: 'toilet_assistance', emotionExpected: false, critical: false }),
  make('adv-mixed-02', '昨日から水がなくて、母の薬も今夜で切れます。', { factPatterns: ['水', '昨日', '薬', '今夜'], contextPatterns: ['母'], request: 'medical_assistance', emotionExpected: false, critical: true }),
  make('adv-mixed-03', 'トイレの水が流れません。飲料水のことではありません。', { factPatterns: ['トイレ', '流れません', '飲料水ではありません'], request: 'toilet_assistance', emotionExpected: false, critical: false, noSafety: true }),
  make('adv-mixed-04', '赤ちゃんのミルクが切れて、親も何も食べていません。', { factPatterns: ['赤ちゃん', 'ミルク', '何も食べて'], request: 'infant_supplies', emotionExpected: false, critical: false }),
  make('adv-mixed-05', '体育館の北側は寒く、南側のトイレは混んでいます。', { factPatterns: ['寒く', 'トイレ', '混ん'], contextPatterns: ['北側', '南側'], request: 'toilet_assistance', emotionExpected: false, critical: false }),
  make('adv-mixed-06', '子どもが熱っぽく、父は薬がなく、私は不安です。', { factPatterns: ['子ども', '熱', '薬', '不安'], request: 'medical_assistance', emotionExpected: true, critical: false, uncertain: true }),
  make('adv-mixed-07', '充電できないし、家族とも連絡が取れません。', { factPatterns: ['充電', '連絡'], request: 'general_assistance', emotionExpected: false, critical: false }),
  make('adv-mixed-08', 'ペットの犬がいるので、食事の配布場所と一緒に教えてください。', { factPatterns: ['ペット', '犬', '食事'], request: 'food_supply', emotionExpected: false, critical: false }),
  make('adv-mixed-09', '意識はあるけれど、転んで歩けません。血は止まっています。', { factPatterns: ['意識', '歩けません', '血は止まっています'], request: 'medical_assistance', emotionExpected: false, critical: true }),
  make('adv-mixed-10', '調理室に煙、入口には怒鳴る人。私は何をすればいいですか。', { factPatterns: ['煙', '怒鳴る'], contextPatterns: ['調理室', '入口'], request: 'fire_response', emotionExpected: true, critical: true }),

  make('adv-multilingual-01', 'Waterがありません。子どもがthirstyです。', { factPatterns: ['Water', 'thirsty'], contextPatterns: ['子ども'], request: 'water_supply', emotionExpected: false, critical: false }, 'en', ['mixed']),
  make('adv-multilingual-02', '厕所很脏，不能使用，请清扫。', { factPatterns: ['厕所', '很脏', '不能使用'], request: 'toilet_assistance', emotionExpected: false, critical: false }, 'zh', ['zh']),
  make('adv-multilingual-03', '어머니가 숨쉬기 어렵다고 합니다. 의식은 있습니다.', { factPatterns: ['어머니', '숨쉬기 어렵', '의식은 있습니다'], request: 'medical_assistance', emotionExpected: false, critical: true }, 'ko', ['ko']),
  make('adv-multilingual-04', 'My child has a fever, but I am not sure how high it is.', { factPatterns: ['child', 'fever', 'not sure'], request: 'medical_assistance', emotionExpected: false, critical: false, uncertain: true }, 'en', ['en']),
  make('adv-multilingual-05', '没有饮用水了，但是不是火灾。', { factPatterns: ['饮用水', '不是火灾'], request: 'water_supply', emotionExpected: false, critical: false, noSafety: true }, 'zh', ['zh']),
  make('adv-multilingual-06', '불이 난 것은 아니지만 연기 냄새가 납니다.', { factPatterns: ['불이 난 것은 아니지만', '연기 냄새'], request: 'general_assistance', emotionExpected: false, critical: true }, 'ko', ['ko']),
  make('adv-multilingual-07', 'I am angry, but nobody is hurt. We need blankets.', { factPatterns: ['angry', 'hurt', 'blankets'], request: 'food_supply', emotionExpected: true, critical: false }, 'en', ['en']),
  make('adv-multilingual-08', '我不确定，但是母亲的药今晚可能用完。', { factPatterns: ['不确定', '母亲', '药', '今晚'], request: 'medical_assistance', emotionExpected: false, critical: true, uncertain: true }, 'zh', ['zh']),
  make('adv-multilingual-09', '화가 나지만 폭력은 없습니다. 화장실이 고장났습니다.', { factPatterns: ['화가', '폭력은 없습니다', '화장실'], request: 'toilet_assistance', emotionExpected: true, critical: false, noSafety: true }, 'ko', ['ko']),
  make('adv-multilingual-10', 'My mother is awake, but she cannot breathe well. Please send help.', { factPatterns: ['mother', 'awake', 'cannot breathe'], request: 'medical_assistance', emotionExpected: true, critical: true }, 'en', ['en']),

  make('adv-noisy-01', 'きのうからみずがない、こども2人、はやく。', { factPatterns: ['みず', 'きのう', 'こども2人'], request: 'water_supply', emotionExpected: true, critical: false }),
  make('adv-noisy-02', 'トイレがつまつてる？たぶん北。', { factPatterns: ['トイレ', 'たぶん北'], request: 'toilet_assistance', emotionExpected: false, critical: false, uncertain: true }),
  make('adv-noisy-03', '水がないんですかないんですか、いや少しあります。', { factPatterns: ['水', '少しあります'], request: 'water_supply', emotionExpected: false, critical: false, correction: true }),
  make('adv-noisy-04', 'ちちがくすりない、今夜、救護。', { factPatterns: ['くすり', '今夜', '救護'], request: 'medical_assistance', emotionExpected: false, critical: true }),
  make('adv-noisy-05', 'なんか煙？火は見えない、でも焦げくさい。', { factPatterns: ['煙', '火は見えない', '焦げ'], request: 'fire_response', emotionExpected: false, critical: true }),
  make('adv-noisy-06', 'だれかが、たぶん、北のほうで、たおれたかも。', { factPatterns: ['たぶん', 'たおれた'], contextPatterns: ['北'], request: 'medical_assistance', emotionExpected: false, critical: true, uncertain: true }),
  make('adv-noisy-07', '水水水、まだ？', { factPatterns: ['水'], request: 'water_supply', emotionExpected: true, critical: false }),
  make('adv-noisy-08', 'child 39度 maybe、ぐったりしてる。', { factPatterns: ['child', '39度', 'maybe', 'ぐったり'], request: 'medical_assistance', emotionExpected: false, critical: true, uncertain: true }, 'en', ['mixed']),
  make('adv-noisy-09', '厕所、南、臭い、不能用。', { factPatterns: ['厕所', '南', '臭い', '不能用'], request: 'toilet_assistance', emotionExpected: false, critical: false }, 'zh', ['zh']),
  make('adv-noisy-10', '약 없음? 내일? 아니 오늘 밤에 끝나요.', { factPatterns: ['약', '오늘 밤', '끝나요'], request: 'medical_assistance', emotionExpected: false, critical: true, correction: true }, 'ko', ['ko']),
];

export const phase2gCases = [...phase2fCases.map((testCase) => ({
  id: `phase2f-${testCase.id}`,
  text: testCase.text,
  language: testCase.language,
  tags: ['phase2f-baseline', ...(testCase.tags || [])],
  expected: {
    factPatterns: testCase.expected.factPatterns,
    contextPatterns: testCase.expected.contextPatterns,
    request: testCase.expected.request,
    emotionExpected: (testCase.expected.emotionPatterns || []).length > 0,
    critical: testCase.expected.critical,
    noSafety: testCase.expected.noSafety,
    uncertain: testCase.expected.uncertain,
    correction: Boolean(testCase.expected.correction),
  },
})), ...phase2gAdversarialCases];

if (phase2gCases.length !== 170) throw new Error(`Expected 170 Phase 2G cases, got ${phase2gCases.length}`);

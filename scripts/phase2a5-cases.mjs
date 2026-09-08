/*
 * Phase 2A.5 regression set.
 *
 * These are synthetic, fixed Japanese cases. They are intentionally not copied
 * from real victims; the hard-expression cases model the kinds of ambiguity a
 * shelter intake system must handle without storing personal data.
 */
const make = (id, label, text, expected, group, notes = '') => ({
  id,
  label,
  text,
  group,
  notes,
  intake: {},
  expected: {
    location: null,
    target: null,
    facts: [],
    request: 'general_assistance',
    urgency: 'unknown',
    safetyFlags: [],
    missingFields: ['場所'],
    critical: false,
    ...expected,
  },
});

const water = [
  ['体育館の水がもうありません。4人分、すぐに飲み水が必要です。', { location: '体育館', target: { type: null, count: 4 }, facts: ['水', '4人'], request: 'water_supply', urgency: 'medium' }],
  ['昨日から飲料水を受け取れていません。残りはほとんどありません。', { facts: ['昨日', '水'], request: 'water_supply', urgency: 'medium' }],
  ['給水所はどこですか。水をもらいたいです。', { facts: ['給水', '水'], request: 'water_supply', urgency: 'medium' }],
  ['水が一滴もなく、赤ちゃんと2人で困っています。', { target: { type: 'infant', count: 1 }, facts: ['水', '赤ちゃん'], request: 'water_supply', urgency: 'medium' }],
  ['北側の水道が出ません。', { location: '北側', facts: ['水道', '出ない'], request: 'water_supply', urgency: 'medium' }],
  ['水の配布は何時からですか？', { facts: ['水', '配布'], request: 'water_supply', urgency: 'medium' }],
  ['水が足りないです。家族6人で待っています。', { target: { type: null, count: 6 }, facts: ['水', '6人'], request: 'water_supply', urgency: 'medium' }],
  ['子ども2人を含む5人ですが、飲み水がなくなりそうです。', { target: { type: 'child', count: 2 }, facts: ['水', 'なくなりそう'], request: 'water_supply', urgency: 'medium' }],
  ['水のタンクが空です。至急補充をお願いします。', { facts: ['水', '空'], request: 'water_supply', urgency: 'medium' }],
  ['水はどこでもらえますか。場所が分かりません。', { facts: ['水', '場所が分からない'], request: 'water_supply', urgency: 'medium' }],
].map(([text, expected], i) => make(`water-${i + 1}`, '飲料水', text, expected, 'water'));

const toilets = [
  ['北トイレが詰まっていて使えません。', { location: '北トイレ', facts: ['詰まって', '使えない'], request: 'toilet_assistance', urgency: 'medium', missingFields: [] }],
  ['南側のトイレがとても汚れていて使えません。', { location: '南側のトイレ', facts: ['汚れ', '使えない'], request: 'toilet_assistance', urgency: 'medium' }],
  ['トイレの水が流れません。', { facts: ['トイレ', '流れない'], request: 'toilet_assistance', urgency: 'medium' }],
  ['車いすで使えるトイレはどこですか？', { facts: ['車いす', 'トイレ'], request: 'toilet_assistance', urgency: 'medium' }],
  ['夜中にトイレへ行ける照明がありません。', { facts: ['トイレ', '照明'], request: 'toilet_assistance', urgency: 'medium' }],
  ['トイレが全部混んでいて、急いでいます。', { facts: ['トイレ', '混んで'], request: 'toilet_assistance', urgency: 'medium' }],
  ['受付横のトイレが壊れています。', { location: '受付横のトイレ', facts: ['トイレ', '壊れ'], request: 'toilet_assistance', urgency: 'medium' }],
  ['おむつを替えられる場所を教えてください。', { facts: ['おむつ', '場所'], request: 'toilet_assistance', urgency: 'medium' }],
  ['トイレの清掃をお願いしたいです。', { facts: ['トイレ', '清掃'], request: 'toilet_assistance', urgency: 'medium' }],
  ['トイレの場所が分かりません。', { facts: ['トイレ', '場所'], request: 'toilet_assistance', urgency: 'medium' }],
].map(([text, expected], i) => make(`toilet-${i + 1}`, 'トイレ・衛生', text, expected, 'toilet'));

const supplies = [
  ['生後3か月の赤ちゃんのおむつがありません。', { target: { type: 'infant', count: 1 }, facts: ['赤ちゃん', 'おむつ'], request: 'infant_supplies', urgency: 'medium' }],
  ['ミルクが切れました。乳児が1人います。', { target: { type: 'infant', count: 1 }, facts: ['ミルク', '切れ'], request: 'infant_supplies', urgency: 'medium' }],
  ['毛布が足りません。3人分ほしいです。', { target: { type: null, count: 3 }, facts: ['毛布', '3人'], request: 'food_supply', urgency: 'medium' }],
  ['食事は次にいつ配られますか？', { facts: ['食事', '配布'], request: 'food_supply', urgency: 'medium' }],
  ['アレルギー対応の食事をお願いします。', { facts: ['アレルギー', '食事'], request: 'food_supply', urgency: 'medium' }],
  ['生理用品がなくて困っています。', { facts: ['生理用品'], request: 'general_assistance', urgency: 'medium' }],
  ['高齢の父の紙おむつがなくなりそうです。', { target: { type: 'adult', count: 1 }, facts: ['高齢', '紙おむつ'], request: 'infant_supplies', urgency: 'medium' }],
  ['子どもの服が濡れてしまいました。着替えが必要です。', { target: { type: 'child', count: 1 }, facts: ['子ども', '着替え'], request: 'general_assistance', urgency: 'medium' }],
  ['食べ物がなく、昨日から何も食べていません。', { facts: ['食べ物', '昨日'], request: 'food_supply', urgency: 'medium' }],
  ['避難所の備蓄品の配布場所を知りたいです。', { facts: ['備蓄品', '配布場所'], request: 'food_supply', urgency: 'medium' }],
].map(([text, expected], i) => make(`supplies-${i + 1}`, '物資・育児用品', text, expected, 'supplies'));

const medical = [
  ['何回言っても誰も来ないんですけど！子供が39度あってぐったりしてるんです！', { target: { type: 'child', count: 1 }, facts: ['39度', 'ぐったり'], request: 'medical_assistance', urgency: 'high', safetyFlags: ['possible_medical_emergency'], critical: true }],
  ['母が意識がぼんやりして、呼びかけても反応が弱いです。', { target: { type: 'adult', count: 1 }, facts: ['意識', '反応が弱い'], request: 'medical_assistance', urgency: 'high', safetyFlags: ['possible_medical_emergency'], critical: true }],
  ['息が苦しくて会話が続きません。救護を呼んでください。', { facts: ['息', '会話'], request: 'medical_assistance', urgency: 'high', safetyFlags: ['possible_medical_emergency'], critical: true }],
  ['持病の薬が今夜分でなくなります。', { facts: ['持病', '薬'], request: 'medical_assistance', urgency: 'high', safetyFlags: ['possible_medical_emergency'], critical: true }],
  ['インスリンがなく、今日はまだ打てていません。', { facts: ['インスリン', '打てていない'], request: 'medical_assistance', urgency: 'high', safetyFlags: ['possible_medical_emergency'], critical: true }],
  ['転んで足を痛めました。歩けません。', { facts: ['転ん', '歩けない'], request: 'medical_assistance', urgency: 'high', safetyFlags: ['possible_medical_emergency'], critical: true }],
  ['子どもが38度の熱です。救護で相談したいです。', { target: { type: 'child', count: 1 }, facts: ['38度', '熱'], request: 'medical_assistance', urgency: 'high', safetyFlags: ['possible_medical_emergency'], critical: true }],
  ['高齢の方が胸が痛いと言っています。', { target: { type: 'adult', count: 1 }, facts: ['高齢', '胸が痛い'], request: 'medical_assistance', urgency: 'high', safetyFlags: ['possible_medical_emergency'], critical: true }],
  ['けがをして血が止まりません。', { facts: ['けが', '血が止まらない'], request: 'medical_assistance', urgency: 'high', safetyFlags: ['possible_medical_emergency'], critical: true }],
  ['薬をなくしてしまいました。どこに相談すればよいですか。', { facts: ['薬', 'なくした'], request: 'medical_assistance', urgency: 'medium' }],
].map(([text, expected], i) => make(`medical-${i + 1}`, '医療・薬', text, expected, 'medical'));

const safety = [
  ['調理室から煙が出て、火が見えます。', { location: '調理室', facts: ['煙', '火'], request: 'fire_response', urgency: 'high', safetyFlags: ['possible_fire'], missingFields: [], critical: true }],
  ['西側のコンセントから焦げたにおいと煙が出ています。', { location: '西側のコンセント', facts: ['煙', '焦げ'], request: 'fire_response', urgency: 'high', safetyFlags: ['possible_fire'], critical: true }],
  ['隣の人が怒鳴りながら椅子を振り回しています。怖いです。', { facts: ['怒鳴', '椅子を振り回'], request: 'safety_assistance', urgency: 'high', safetyFlags: ['possible_violence'], critical: true }],
  ['入口で人が殴り合いになっています。', { location: '入口', facts: ['殴り合い'], request: 'safety_assistance', urgency: 'high', safetyFlags: ['possible_violence'], critical: true }],
  ['包丁を持った人が殺すと言いながら歩いています。', { facts: ['包丁', '殺す'], request: 'safety_assistance', urgency: 'high', safetyFlags: ['possible_violence'], critical: true }],
  ['誰かが閉じ込められていて、外から返事がありません。', { facts: ['閉じ込め', '返事がない'], request: 'safety_assistance', urgency: 'high', safetyFlags: ['possible_medical_emergency'], critical: true }],
  ['建物の壁が崩れて、近づくと危険です。', { facts: ['壁', '崩れ', '危険'], request: 'safety_assistance', urgency: 'high', safetyFlags: ['possible_fire'], critical: true }],
  ['煙たいですが、火は見えていません。確認をお願いします。', { facts: ['煙'], request: 'fire_response', urgency: 'high', safetyFlags: ['possible_fire'], critical: true }],
  ['怖い人がいる気がします。見回りをお願いできますか。', { facts: ['怖い'], request: 'safety_assistance', urgency: 'high', safetyFlags: ['possible_violence'], critical: true }],
  ['夜に大声で騒いでいる人がいて眠れません。', { facts: ['大声', '眠れない'], request: 'safety_assistance', urgency: 'medium' }],
].map(([text, expected], i) => make(`safety-${i + 1}`, '安全・緊急', text, expected, 'safety'));

const ordinary = [
  ['充電できる場所を教えてください。', { facts: ['充電'], request: 'general_assistance', urgency: 'low' }],
  ['携帯電話がつながりません。', { facts: ['携帯電話', 'つながらない'], request: 'general_assistance', urgency: 'medium' }],
  ['夜、体育館が寒くて眠れません。', { location: '体育館', facts: ['寒い', '眠れない'], request: 'general_assistance', urgency: 'medium' }],
  ['ペットの犬をどこに置けばいいですか。', { target: { type: 'pet', count: 1 }, facts: ['犬', 'ペット'], request: 'general_assistance', urgency: 'low' }],
  ['車いすで通れる入口が分かりません。', { facts: ['車いす', '入口'], request: 'general_assistance', urgency: 'medium' }],
  ['避難所の受付時間を知りたいです。', { facts: ['受付時間'], request: 'general_assistance', urgency: 'low' }],
  ['洗濯できる場所はありますか。', { facts: ['洗濯', '場所'], request: 'general_assistance', urgency: 'low' }],
  ['お風呂に入れる時間を教えてください。', { facts: ['お風呂', '時間'], request: 'general_assistance', urgency: 'low' }],
  ['家族とはぐれました。伝言を残したいです。', { facts: ['家族', 'はぐれ'], request: 'general_assistance', urgency: 'medium' }],
  ['避難所のルールを確認したいです。', { facts: ['ルール'], request: 'general_assistance', urgency: 'low' }],
].map(([text, expected], i) => make(`ordinary-${i + 1}`, '一般相談', text, expected, 'ordinary'));

const hard = [
  ['何回言えば水をもらえるんですか！ずっと待たされて腹が立ちます。', { facts: ['水', '待'], request: 'water_supply', urgency: 'medium' }],
  ['もう最悪です、子どもを何時間も待たせています。ごはんはまだですか。', { target: { type: 'child', count: 1 }, facts: ['子ども', 'ごはん', '待'], request: 'food_supply', urgency: 'medium' }],
  ['「死ぬほど腹減った」と言っていますが、今すぐの危険ではありません。食事をお願いします。', { facts: ['腹減った', '食事'], request: 'food_supply', urgency: 'medium' }],
  ['殺されそうなくらい暑いです。空調か涼しい場所を教えてください。', { facts: ['暑い', '空調'], request: 'general_assistance', urgency: 'medium' }],
  ['何度頼んでも毛布が来ない。寒くて限界です。', { facts: ['毛布', '寒い'], request: 'food_supply', urgency: 'medium' }],
  ['水がないんだけど！！子どももいるのにいつまで待たせるの！', { target: { type: 'child', count: 1 }, facts: ['水', '子ども'], request: 'water_supply', urgency: 'medium' }],
  ['誰も聞いてくれない、もうどうでもいいです。薬もありません。', { facts: ['薬', 'どうでもいい'], request: 'medical_assistance', urgency: 'high', safetyFlags: ['possible_self_harm'], critical: true }],
  ['怒ってはいませんが、食料の配布が遅れている理由を知りたいです。', { facts: ['食料', '遅れ'], request: 'food_supply', urgency: 'medium' }],
  ['ここはどこですか、何をすればいいか分かりません。', { facts: ['場所が分からない'], request: 'general_assistance', urgency: 'unknown', missingFields: ['場所', '追加確認'] }],
  ['もう何も言いたくないくらい疲れました。水だけお願いできますか。', { facts: ['疲れ', '水'], request: 'water_supply', urgency: 'medium' }],
].map(([text, expected], i) => make(`hard-${i + 1}`, '強い表現・曖昧さ', text, expected, 'hard'));

const asrAndDialect = [
  ['みずがないっちゃけど、給水どこね？', { facts: ['水', '給水'], request: 'water_supply', urgency: 'medium' }],
  ['トイレがつまっとるで使えん。', { facts: ['トイレ', '詰ま'], request: 'toilet_assistance', urgency: 'medium' }],
  ['こどもがさんじゅうきゅうどでぐったりしとる。', { target: { type: 'child', count: 1 }, facts: ['39度', 'ぐったり'], request: 'medical_assistance', urgency: 'high', safetyFlags: ['possible_medical_emergency'], critical: true }],
  ['みるくがないです、あかちゃんひとり。', { target: { type: 'infant', count: 1 }, facts: ['ミルク', '赤ちゃん'], request: 'infant_supplies', urgency: 'medium' }],
  ['けむりがでとる、かじかもしれん。', { facts: ['煙', '火'], request: 'fire_response', urgency: 'high', safetyFlags: ['possible_fire'], critical: true }],
  ['いまいるとこ、北側の水場。水、あとちょっと。', { location: '北側の水場', facts: ['水', 'あとちょっと'], request: 'water_supply', urgency: 'medium', missingFields: [] }],
  ['息がしんどくて、しゃべれん。', { facts: ['息', 'しゃべれない'], request: 'medical_assistance', urgency: 'high', safetyFlags: ['possible_medical_emergency'], critical: true }],
  ['おやじが寝とるみたいで、なにしても起きん。', { target: { type: 'adult', count: 1 }, facts: ['起きない'], request: 'medical_assistance', urgency: 'high', safetyFlags: ['possible_medical_emergency'], critical: true }],
  ['おむつ、もうないんよ。', { facts: ['おむつ', 'ない'], request: 'infant_supplies', urgency: 'medium' }],
  ['電波がわるくて連絡つかん。', { facts: ['電波', '連絡'], request: 'general_assistance', urgency: 'medium' }],
].map(([text, expected], i) => make(`dialect-asr-${i + 1}`, '方言・音声誤認識想定', text, expected, 'dialect-asr', '意図的に口語・方言・音声認識で崩れやすい表現'));

const insufficient = [
  ['困っています。', {}],
  ['助けてください。', { urgency: 'high', facts: ['助けて'] }],
  ['どうしたらいいですか。', {}],
  ['相談があります。', {}],
  ['物が足りません。', { request: 'food_supply', urgency: 'medium', facts: ['足りない'] }],
  ['具合が悪いです。', { request: 'medical_assistance', urgency: 'high', facts: ['具合が悪い'], safetyFlags: ['possible_medical_emergency'], critical: true }],
  ['危ないです。', { request: 'safety_assistance', urgency: 'high', facts: ['危ない'], safetyFlags: ['possible_violence'], critical: true }],
  ['今すぐ来てください。', { urgency: 'high', facts: ['今すぐ'] }],
  ['ここにいます。', { facts: ['ここ'] }],
  ['分かりません。', {}],
].map(([text, expected], i) => make(`insufficient-${i + 1}`, '情報不足', text, expected, 'insufficient'));

const composite = [
  ['体育館東側で水が足りず、子ども3人と大人2人で困っています。', { location: '体育館東側', target: { type: 'child', count: 3 }, facts: ['水', '3人', '2人'], request: 'water_supply', urgency: 'medium', missingFields: [] }],
  ['北トイレが使えず、車いすの人が困っています。', { location: '北トイレ', target: { type: 'adult', count: 1 }, facts: ['トイレ', '使えない', '車いす'], request: 'toilet_assistance', urgency: 'medium' }],
  ['救護スペースで、2歳の子が40度あり呼びかけに反応しません。', { location: '救護スペース', target: { type: 'child', count: 1 }, facts: ['2歳', '40度', '反応しない'], request: 'medical_assistance', urgency: 'high', safetyFlags: ['possible_medical_emergency'], missingFields: [], critical: true }],
  ['調理室の煙と、南側の水不足を同時に伝えます。まず煙を確認してください。', { location: '調理室', facts: ['煙', '水不足'], request: 'fire_response', urgency: 'high', safetyFlags: ['possible_fire'], critical: true }],
  ['家族4人、薬を取りに行けず、父の薬が今夜で切れます。', { target: { type: 'adult', count: 1 }, facts: ['4人', '父', '薬'], request: 'medical_assistance', urgency: 'high', safetyFlags: ['possible_medical_emergency'], critical: true }],
  ['A区画の乳児2人にミルクがありません。', { location: 'A区画', target: { type: 'infant', count: 2 }, facts: ['乳児', 'ミルク'], request: 'infant_supplies', urgency: 'medium', missingFields: [] }],
  ['入口付近で口論が激しくなり、物を投げています。', { location: '入口付近', facts: ['口論', '物を投げ'], request: 'safety_assistance', urgency: 'high', safetyFlags: ['possible_violence'], missingFields: [], critical: true }],
  ['体育館で食事の配布を待っていますが、昨日の夜から何も食べていません。', { location: '体育館', facts: ['食事', '昨日の夜'], request: 'food_supply', urgency: 'medium', missingFields: [] }],
  ['西側の通路が暗く、転びそうです。照明をつけてください。', { location: '西側の通路', facts: ['暗い', '転びそう', '照明'], request: 'general_assistance', urgency: 'medium', missingFields: [] }],
  ['避難所の場所も人数も分からず、何を頼めばよいか分かりません。', { facts: ['場所が分からない', '人数が分からない'], request: 'general_assistance', urgency: 'unknown', missingFields: ['場所', '人数', '追加確認'] }],
].map(([text, expected], i) => make(`composite-${i + 1}`, '複合案件', text, expected, 'composite'));

const accessibility = [
  ['耳が聞こえにくいので、掲示で水の配布を知らせてください。', { facts: ['聞こえにくい', '水', '掲示'], request: 'water_supply', urgency: 'medium' }],
  ['日本語があまり分かりません。食事の案内を絵で見せてください。', { facts: ['日本語', '食事', '案内'], request: 'food_supply', urgency: 'medium' }],
  ['小さい字が読めません。大きな文字でトイレの場所を教えてください。', { facts: ['小さい字', 'トイレ', '場所'], request: 'toilet_assistance', urgency: 'medium' }],
  ['歩くのが難しいので、近い給水場所を教えてください。', { facts: ['歩くのが難しい', '給水場所'], request: 'water_supply', urgency: 'medium' }],
  ['子どもが怖がっています。静かな場所へ移れますか。', { target: { type: 'child', count: 1 }, facts: ['子ども', '怖い', '静かな場所'], request: 'general_assistance', urgency: 'medium' }],
  ['夜間に見えにくいので、通路の明かりを増やしてください。', { facts: ['夜間', '見えにくい', '明かり'], request: 'general_assistance', urgency: 'medium' }],
  ['筆談で相談したいです。受付はどこですか。', { facts: ['筆談', '受付'], request: 'general_assistance', urgency: 'low' }],
  ['ベビーカーで通れる入口を知りたいです。', { facts: ['ベビーカー', '入口'], request: 'general_assistance', urgency: 'medium' }],
  ['階段を使えません。救護スペースまで案内してください。', { facts: ['階段', '救護スペース'], request: 'medical_assistance', urgency: 'medium' }],
  ['外国語の通訳をお願いできますか。', { facts: ['外国語', '通訳'], request: 'general_assistance', urgency: 'low' }],
].map(([text, expected], i) => make(`accessibility-${i + 1}`, '配慮・アクセシビリティ', text, expected, 'accessibility'));

export const phase2a5Cases = [
  ...water,
  ...toilets,
  ...supplies,
  ...medical,
  ...safety,
  ...ordinary,
  ...hard,
  ...asrAndDialect,
  ...insufficient,
  ...composite,
  ...accessibility,
];

export const phase2a5CaseGroups = [...new Set(phase2a5Cases.map((item) => item.group))];

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify({ caseCount: phase2a5Cases.length, groups: phase2a5CaseGroups }, null, 2));
}

/*
 * Phase 2F fixed synthetic evaluation set.
 *
 * These cases are artificial and contain no real victims' data. The set is
 * intentionally weighted toward strong emotion, negation, uncertainty,
 * corrections, multilingual input, and ordinary non-emergency requests.
 * Expected values are deliberately conservative: a missing value is not a
 * failure unless the case says that the value is required.
 */

const make = (id, text, expected = {}, language = 'ja', tags = []) => ({
  id,
  text,
  language,
  tags,
  expected: {
    factPatterns: [],
    contextPatterns: [],
    request: 'general_assistance',
    emotionPatterns: [],
    notExpectedEmotionPatterns: [],
    uncertain: false,
    critical: false,
    safetyLabels: [],
    noSafety: false,
    correction: null,
    ...expected,
  },
});

const water = [
  make('water-01', '何回伝えても誰も来ないんですけど！昨日から水が全然なくて、子ども2人がいます。早く持ってきてください！', { factPatterns: ['水', '昨日'], contextPatterns: ['子ども', '2人'], request: 'water_supply', emotionPatterns: ['不安', '怒り'], tags: ['anger', 'repeat'] }),
  make('water-02', '体育館の水がもうありません。4人分、すぐに飲み水が必要です。', { factPatterns: ['水', '4人'], contextPatterns: ['体育館'], request: 'water_supply', tags: ['quantity'] }),
  make('water-03', '今朝から飲料水を受け取れていません。残りはほとんどありません。', { factPatterns: ['飲料水', '今朝', 'ほとんど'], request: 'water_supply', tags: ['shortage'] }),
  make('water-04', '給水所はどこですか。水をもらいたいです。', { factPatterns: ['給水所', '水'], request: 'water_supply', tags: ['faq'] }),
  make('water-05', '水が一滴もなく、赤ちゃんと2人で困っています。', { factPatterns: ['水', '一滴も'], contextPatterns: ['赤ちゃん', '2人'], request: 'water_supply', emotionPatterns: ['不安'], tags: ['infant'] }),
  make('water-06', '北側の水道が出ません。昨日の夜からです。', { factPatterns: ['水道', '出ません', '昨日の夜'], contextPatterns: ['北側'], request: 'water_supply', tags: ['location', 'time'] }),
  make('water-07', '水のタンクが空です。至急補充をお願いします。', { factPatterns: ['水', '空', '補充'], request: 'water_supply', emotionPatterns: ['焦り'], tags: ['urgent-tone'] }),
  make('water-08', '家族6人で待っています。水はあと2本しかありません。', { factPatterns: ['家族', '6人', '2本'], request: 'water_supply', tags: ['quantity'] }),
  make('water-09', '水の配布が遅すぎます。ちゃんと案内してもらえますか。', { factPatterns: ['水', '配布', '遅'], request: 'water_supply', emotionPatterns: ['不満'], tags: ['anger'] }),
  make('water-10', 'たぶん水は今日中に足りなくなります。何本必要かはまだ分かりません。', { factPatterns: ['水', '今日中'], request: 'water_supply', uncertain: true, emotionPatterns: ['不安'], tags: ['uncertainty'] }),
];

const toilet = [
  make('toilet-01', '北トイレが詰まっていて使えません。何度言っても清掃されません。', { factPatterns: ['北トイレ', '詰ま', '使えません'], request: 'toilet_assistance', emotionPatterns: ['不満'], tags: ['repeat'] }),
  make('toilet-02', '南側のトイレがとても汚れていて使えません。', { factPatterns: ['南側', 'トイレ', '汚れ', '使えません'], request: 'toilet_assistance', tags: ['hygiene'] }),
  make('toilet-03', 'トイレの水が流れません。小さい子を連れていて困っています。', { factPatterns: ['トイレ', '流れません'], contextPatterns: ['小さい子'], request: 'toilet_assistance', emotionPatterns: ['不安'], tags: ['child'] }),
  make('toilet-04', '車いすで使えるトイレはどこですか？北側は混んでいて入れません。', { factPatterns: ['車いす', 'トイレ', '混ん'], contextPatterns: ['北側'], request: 'toilet_assistance', tags: ['accessibility'] }),
  make('toilet-05', 'トイレが全部混んでいて、急いでいます。', { factPatterns: ['トイレ', '混ん'], request: 'toilet_assistance', emotionPatterns: ['焦り'], tags: ['shortage'] }),
  make('toilet-06', '受付横のトイレが壊れています。いつ直りますか。', { factPatterns: ['受付横', 'トイレ', '壊れ'], request: 'toilet_assistance', tags: ['location'] }),
  make('toilet-07', '夜中にトイレへ行ける照明がありません。転びそうで怖いです。', { factPatterns: ['トイレ', '照明', '転びそう'], request: 'toilet_assistance', emotionPatterns: ['不安'], tags: ['safety-boundary'] }),
  make('toilet-08', 'おむつを替えられる場所を教えてください。', { factPatterns: ['おむつ', '場所'], request: 'toilet_assistance', tags: ['infant'] }),
  make('toilet-09', 'トイレの清掃をお願いしたいです。怒ってはいませんが、においが強いです。', { factPatterns: ['トイレ', '清掃', 'におい'], request: 'toilet_assistance', tags: ['ordinary'] }),
  make('toilet-10', '体育館の南側にいるのですが、トイレの場所が分かりません。', { factPatterns: ['トイレ', '場所'], contextPatterns: ['体育館', '南側'], request: 'toilet_assistance', tags: ['missing'] }),
];

const supplies = [
  make('supplies-01', '毛布が4枚足りません。大人2人と子ども2人です。今夜必要です。', { factPatterns: ['毛布', '4枚', '今夜'], contextPatterns: ['大人2人', '子ども2人'], request: 'food_supply', tags: ['quantity'] }),
  make('supplies-02', '生後3か月の赤ちゃんのおむつがありません。', { factPatterns: ['赤ちゃん', 'おむつ', '3か月'], contextPatterns: ['赤ちゃん'], request: 'infant_supplies', tags: ['infant'] }),
  make('supplies-03', 'ミルクが切れました。乳児が1人います。', { factPatterns: ['ミルク', '切れ'], contextPatterns: ['乳児', '1人'], request: 'infant_supplies', tags: ['infant'] }),
  make('supplies-04', '食事は次にいつ配られますか？朝から何も食べていません。', { factPatterns: ['食事', '配られ', '朝から'], request: 'food_supply', tags: ['time'] }),
  make('supplies-05', 'アレルギー対応の食事をお願いします。卵は食べられません。', { factPatterns: ['アレルギー', '食事', '卵'], request: 'food_supply', tags: ['medical-context'] }),
  make('supplies-06', '生理用品がなくて困っています。人に聞くのが恥ずかしいです。', { factPatterns: ['生理用品'], request: 'general_assistance', emotionPatterns: ['不安'], tags: ['sensitive'] }),
  make('supplies-07', '高齢の父の紙おむつがなくなりそうです。', { factPatterns: ['高齢', '父', '紙おむつ'], contextPatterns: ['父'], request: 'infant_supplies', uncertain: true, tags: ['elderly'] }),
  make('supplies-08', '子どもの服が濡れてしまいました。着替えが必要です。', { factPatterns: ['子ども', '服', '濡れ', '着替え'], contextPatterns: ['子ども'], request: 'general_assistance', tags: ['child'] }),
  make('supplies-09', '食べ物がなく、昨日から何も食べていません。', { factPatterns: ['食べ物', '昨日', '何も食べて'], request: 'food_supply', tags: ['shortage'] }),
  make('supplies-10', '避難所の備蓄品の配布場所を知りたいです。', { factPatterns: ['備蓄品', '配布場所'], request: 'food_supply', tags: ['faq'] }),
];

const medical = [
  make('medical-01', '何回言っても誰も来ない！子どもが39度あってぐったりしているんです！', { factPatterns: ['39度', 'ぐったり'], contextPatterns: ['子ども'], request: 'medical_assistance', emotionPatterns: ['怒り', '焦り'], critical: true, safetyLabels: ['重大な体調変化'], tags: ['medical', 'stress'] }),
  make('medical-02', '母が意識がぼんやりして、呼びかけても反応が弱いです。', { factPatterns: ['意識', '反応が弱い'], contextPatterns: ['母'], request: 'medical_assistance', critical: true, safetyLabels: ['意識・呼吸の異常'], tags: ['medical'] }),
  make('medical-03', '息が苦しくて会話が続きません。救護を呼んでください。', { factPatterns: ['息が苦しい', '会話'], request: 'medical_assistance', critical: true, safetyLabels: ['意識・呼吸の異常'], tags: ['medical'] }),
  make('medical-04', '父が起きません。寝ているだけかもしれませんが、呼びかけても返事がありません。', { factPatterns: ['起きません', '返事がありません'], contextPatterns: ['父'], request: 'medical_assistance', uncertain: true, critical: true, safetyLabels: ['重大な体調変化'], tags: ['medical', 'uncertainty'] }),
  make('medical-05', '高齢の方が胸が強く痛いと言っています。', { factPatterns: ['高齢', '胸', '痛い'], request: 'medical_assistance', critical: true, safetyLabels: ['強い胸痛'], tags: ['medical'] }),
  make('medical-06', 'インスリンがなく、今日はまだ打てていません。', { factPatterns: ['インスリン', '打てていません'], request: 'medical_assistance', critical: true, safetyLabels: ['重大な体調変化'], tags: ['medical'] }),
  make('medical-07', '転んで足を痛めました。歩けません。', { factPatterns: ['転ん', '足', '歩けません'], request: 'medical_assistance', critical: true, safetyLabels: ['重大な体調変化'], tags: ['medical'] }),
  make('medical-08', 'けがをして血が止まりません。救護所に来てください。', { factPatterns: ['けが', '血が止まりません', '救護所'], request: 'medical_assistance', critical: true, safetyLabels: ['大量出血'], tags: ['medical'] }),
  make('medical-09', '子どもが熱っぽい気がします。高熱かもしれませんが、まだ測れていません。', { factPatterns: ['熱っぽい', '高熱'], contextPatterns: ['子ども'], request: 'medical_assistance', uncertain: true, emotionPatterns: ['不安'], critical: true, safetyLabels: ['重大な体調変化'], tags: ['medical', 'uncertainty'] }),
  make('medical-10', '頭が少し痛いです。薬があるか救護所で聞きたいです。', { factPatterns: ['頭', '痛い', '薬', '救護所'], request: 'medical_assistance', tags: ['medical', 'ordinary'] }),
];

const safety = [
  make('safety-01', '調理室から煙が出て、火が見えます。すぐ来てください。', { factPatterns: ['調理室', '煙', '火'], request: 'fire_response', critical: true, safetyLabels: ['火災・煙'], tags: ['fire'] }),
  make('safety-02', '西側のコンセントから焦げたにおいと煙が出ています。', { factPatterns: ['西側', '焦げ', '煙'], request: 'fire_response', critical: true, safetyLabels: ['火災・煙'], tags: ['fire'] }),
  make('safety-03', '隣の人が怒鳴りながら椅子を振り回しています。怖いです。', { factPatterns: ['怒鳴', '椅子を振り回'], request: 'safety_assistance', emotionPatterns: ['不安'], critical: true, safetyLabels: ['暴力・武器'], tags: ['violence'] }),
  make('safety-04', '体育館入口で人が殴り合いになっています。', { factPatterns: ['体育館入口', '殴り合い'], request: 'safety_assistance', critical: true, safetyLabels: ['暴力・武器'], tags: ['violence'] }),
  make('safety-05', '包丁を持った人が殺すと言いながら歩いています。', { factPatterns: ['包丁', '殺す'], request: 'safety_assistance', critical: true, safetyLabels: ['暴力・武器', '自傷・他害'], tags: ['violence'] }),
  make('safety-06', '建物の壁が崩れて、近づくと危険です。', { factPatterns: ['壁が崩れ', '危険'], request: 'safety_assistance', critical: true, safetyLabels: ['建物・閉じ込め'], tags: ['building'] }),
  make('safety-07', '煙たいですが、火は見えていません。確認をお願いします。', { factPatterns: ['煙', '火は見えていません'], request: 'fire_response', critical: true, safetyLabels: ['火災・煙'], tags: ['fire', 'boundary'] }),
  make('safety-08', '怖い人がいる気がします。見回りをお願いできますか。', { factPatterns: ['怖い人', '見回り'], request: 'safety_assistance', uncertain: true, critical: true, safetyLabels: ['暴力・武器'], emotionPatterns: ['不安'], tags: ['violence', 'uncertainty'] }),
  make('safety-09', '夜に大声で騒いでいる人がいて眠れません。', { factPatterns: ['大声', '眠れません'], request: 'safety_assistance', tags: ['ordinary-safety'] }),
  make('safety-10', '誰かが閉じ込められていて、外から返事がありません。', { factPatterns: ['閉じ込め', '返事がありません'], request: 'safety_assistance', critical: true, safetyLabels: ['建物・閉じ込め'], tags: ['building'] }),
];

const ordinary = [
  make('ordinary-01', 'スマートフォンを充電できる場所を教えてください。', { factPatterns: ['充電'], tags: ['ordinary'] }),
  make('ordinary-02', '携帯電話がつながりません。', { factPatterns: ['携帯電話', 'つながりません'], tags: ['ordinary'] }),
  make('ordinary-03', '夜、体育館が寒くて眠れません。', { factPatterns: ['体育館', '寒くて', '眠れません'], tags: ['ordinary'] }),
  make('ordinary-04', 'ペットの犬をどこに置けばいいですか。', { factPatterns: ['ペット', '犬'], tags: ['ordinary'] }),
  make('ordinary-05', '車いすで通れる入口が分かりません。', { factPatterns: ['車いす', '入口'], tags: ['ordinary', 'accessibility'] }),
  make('ordinary-06', '避難所の受付時間を知りたいです。', { factPatterns: ['受付時間'], tags: ['ordinary'] }),
  make('ordinary-07', '洗濯できる場所はありますか。', { factPatterns: ['洗濯', '場所'], tags: ['ordinary'] }),
  make('ordinary-08', 'お風呂に入れる時間を教えてください。', { factPatterns: ['お風呂', '時間'], tags: ['ordinary'] }),
  make('ordinary-09', '家族とはぐれました。伝言を残したいです。', { factPatterns: ['家族', 'はぐれ', '伝言'], tags: ['ordinary'] }),
  make('ordinary-10', '避難所のルールを確認したいです。', { factPatterns: ['ルール'], tags: ['ordinary'] }),
];

const boundaries = [
  make('boundary-01', '息苦しくはないけど胸が痛いです。', { factPatterns: ['胸が痛い'], request: 'medical_assistance', critical: true, safetyLabels: ['強い胸痛'], tags: ['negation'] }),
  make('boundary-02', 'さっき息苦しかったが、今は大丈夫です。念のため相談します。', { factPatterns: ['息苦しかった', '今は大丈夫'], request: 'medical_assistance', noSafety: true, uncertain: true, tags: ['negation', 'recovery'] }),
  make('boundary-03', '高熱ではありませんが、子どもの体温を測る場所を知りたいです。', { factPatterns: ['高熱ではありません', '子ども', '体温'], request: 'medical_assistance', noSafety: true, tags: ['negation'] }),
  make('boundary-04', '火事ではありませんが、焦げたにおいがして不安です。調理室を見てもらえますか。', { factPatterns: ['火事ではありません', '焦げた', '調理室'], request: 'general_assistance', noSafety: true, emotionPatterns: ['不安'], tags: ['negation'] }),
  make('boundary-05', '隣の人と少し言い合いになっただけで、暴力はありません。話を聞いてほしいです。', { factPatterns: ['言い合い', '暴力はありません'], request: 'general_assistance', noSafety: true, emotionPatterns: ['不安'], tags: ['negation'] }),
  make('boundary-06', 'もう最悪です。これでは死んじゃいますよ。水の配布が遅すぎます。', { factPatterns: ['最悪', '水', '配布'], request: 'water_supply', noSafety: true, emotionPatterns: ['不満', '焦り'], tags: ['emotion-not-safety'] }),
  make('boundary-07', '意識はありますが、呼吸が苦しいと言っています。', { factPatterns: ['意識はあります', '呼吸が苦しい'], request: 'medical_assistance', critical: true, safetyLabels: ['意識・呼吸の異常'], tags: ['negation', 'medical'] }),
  make('boundary-08', '意識はあります。今のところ痛みもありませんが、母が不安そうです。', { factPatterns: ['意識はあります', '痛みもありません'], contextPatterns: ['母'], request: 'general_assistance', noSafety: true, emotionPatterns: ['不安'], tags: ['negation'] }),
  make('boundary-09', 'I am not short of breath, but my chest hurts when I move.', { factPatterns: ['not short of breath', 'chest hurts'], request: 'medical_assistance', language: 'en', critical: true, safetyLabels: ['強い胸痛'], tags: ['negation', 'english'] }),
  make('boundary-10', 'It is not a fire. The smell is strange, so please check the kitchen.', { factPatterns: ['not a fire', 'smell', 'kitchen'], request: 'general_assistance', language: 'en', noSafety: true, tags: ['negation', 'english'] }),
];

const corrections = [
  make('correction-01', '3人です。いや、子どもを入れたら4人です。', { factPatterns: ['3人', '4人'], contextPatterns: ['子ども'], request: 'general_assistance', correction: { mustContain: ['4人'], mustNotContain: [] }, tags: ['correction'] }),
  make('correction-02', '水はいらないと言いましたが、やっぱり今日中に必要です。', { factPatterns: ['水', '今日中', 'やっぱり'], request: 'water_supply', correction: { mustContain: ['今日中'], mustNotContain: [] }, tags: ['correction'] }),
  make('correction-03', '体育館の北側だと思いましたが、今は南側の入口にいます。', { factPatterns: ['北側', '南側', '入口'], contextPatterns: ['南側'], request: 'general_assistance', uncertain: true, correction: { mustContain: ['南側'], mustNotContain: [] }, tags: ['correction'] }),
  make('correction-04', '昨日からだと思ったけれど、正確には今朝から水がありません。', { factPatterns: ['昨日から', '今朝から', '水'], request: 'water_supply', correction: { mustContain: ['今朝から'], mustNotContain: [] }, tags: ['correction'] }),
  make('correction-05', '最初は毛布が必要でしたが、今は食料のほうが必要です。', { factPatterns: ['毛布', '食料'], request: 'food_supply', correction: { mustContain: ['食料'], mustNotContain: [] }, tags: ['correction'] }),
  make('correction-06', '子どもは2人だと思っていました。数え直したら3人です。', { factPatterns: ['2人', '3人'], contextPatterns: ['子ども'], request: 'general_assistance', correction: { mustContain: ['3人'], mustNotContain: [] }, tags: ['correction'] }),
  make('correction-07', '薬は明日まであると思いましたが、袋を確認したら今夜で切れます。', { factPatterns: ['薬', '明日', '今夜'], request: 'medical_assistance', uncertain: true, correction: { mustContain: ['今夜'], mustNotContain: [] }, tags: ['correction', 'medical'] }),
  make('correction-08', '火は見えないと思ったのですが、今、調理室の奥で小さな炎が見えます。', { factPatterns: ['火は見えない', '調理室', '炎'], request: 'fire_response', critical: true, safetyLabels: ['火災・煙'], correction: { mustContain: ['炎'], mustNotContain: [] }, tags: ['correction', 'fire'] }),
  make('correction-09', 'たぶん39度です。まだ体温計で測っていないので、確かではありません。', { factPatterns: ['39度', '測っていない'], request: 'medical_assistance', uncertain: true, tags: ['uncertainty', 'medical'] }),
  make('correction-10', 'たぶん北トイレですが、表示が見えず場所は確かではありません。', { factPatterns: ['北トイレ', '確かではありません'], request: 'toilet_assistance', uncertain: true, tags: ['uncertainty'] }),
];

const multilingual = [
  make('multi-01', 'I told you three times. There is no drinking water since this morning, and my child is thirsty. Please help us.', { factPatterns: ['drinking water', 'this morning', 'thirsty'], contextPatterns: ['child'], request: 'water_supply', emotionPatterns: ['不安'] }, 'en', ['english', 'anger']),
  make('multi-02', 'My mom may have a fever. She is awake, but I am not sure how high it is.', { factPatterns: ['fever', 'awake'], contextPatterns: ['mom'], request: 'medical_assistance', uncertain: true }, 'en', ['english', 'uncertainty']),
  make('multi-03', 'There is smoke and I can see flames in the kitchen. Send someone now.', { factPatterns: ['smoke', 'flames', 'kitchen'], request: 'fire_response', critical: true, safetyLabels: ['火災・煙'] }, 'en', ['english', 'fire']),
  make('multi-04', 'Someone is threatening people with a knife near the entrance.', { factPatterns: ['threatening', 'knife', 'entrance'], request: 'safety_assistance', critical: true, safetyLabels: ['暴力・武器'] }, 'en', ['english', 'violence']),
  make('multi-05', '我已经说了好几次，饮用水没有了，孩子也很渴，请尽快补充。', { factPatterns: ['饮用水', '没有', '好几次'], contextPatterns: ['孩子'], request: 'water_supply', emotionPatterns: ['不安'] }, 'zh', ['chinese', 'anger']),
  make('multi-06', '北面的厕所不能使用，很脏，请尽快清扫。', { factPatterns: ['厕所', '不能使用', '脏'], contextPatterns: ['北面'], request: 'toilet_assistance' }, 'zh', ['chinese']),
  make('multi-07', '婴儿的奶粉没有了，今天晚上需要。', { factPatterns: ['婴儿', '奶粉', '今天晚上'], request: 'infant_supplies' }, 'zh', ['chinese', 'infant']),
  make('multi-08', '몇 번이나 말했는데 식수가 없습니다. 아이가 있고 너무 불안합니다. 빨리 도와주세요.', { factPatterns: ['식수', '없습니다'], contextPatterns: ['아이'], request: 'water_supply', emotionPatterns: ['不安'] }, 'ko', ['korean', 'anger']),
  make('multi-09', '어머니가 숨쉬기 어렵다고 합니다. 의식은 있습니다.', { factPatterns: ['숨쉬기 어렵', '의식은 있습니다'], contextPatterns: ['어머니'], request: 'medical_assistance', critical: true, safetyLabels: ['意識・呼吸の異常'] }, 'ko', ['korean', 'medical']),
  make('multi-10', 'My momが息苦しいと言っています。救護所はどこですか。', { factPatterns: ['息苦しい', '救護所'], contextPatterns: ['mom'], request: 'medical_assistance', critical: true, safetyLabels: ['意識・呼吸の異常'] }, 'ja', ['mixed', 'medical']),
];

const emotional = [
  make('emotion-01', '何回言えば水をもらえるんですか！ずっと待たされて腹が立ちます。', { factPatterns: ['水', '待たされ'], request: 'water_supply', emotionPatterns: ['不満', '怒り'], tags: ['anger'] }),
  make('emotion-02', 'ちゃんと仕事してください。食料の配布時間を教えてください。', { factPatterns: ['食料', '配布時間'], request: 'food_supply', emotionPatterns: ['不満'], tags: ['anger'] }),
  make('emotion-03', '水ないんだけど？？何してんのマジで。', { factPatterns: ['水'], request: 'water_supply', emotionPatterns: ['不満', '怒り'], tags: ['slang'] }),
  make('emotion-04', '職員は何をしているんですか。食事が来ないままです。朝から何も食べていません。', { factPatterns: ['食事', '朝から'], request: 'food_supply', emotionPatterns: ['不満', '焦り'], tags: ['anger'] }),
  make('emotion-05', '素晴らしい対応ですね。何時間待てば水をもらえるんでしょう。', { factPatterns: ['水', '何時間', '待'], request: 'water_supply', emotionPatterns: ['皮肉', '不満'], tags: ['sarcasm'] }),
  make('emotion-06', '怖くて泣きそうです。赤ちゃんのミルクがもうありません。', { factPatterns: ['赤ちゃん', 'ミルク'], request: 'infant_supplies', emotionPatterns: ['不安', '焦り'], tags: ['crying'] }),
  make('emotion-07', 'もう何も言いたくないくらい疲れました。水だけお願いできますか。', { factPatterns: ['疲れ', '水'], request: 'water_supply', emotionPatterns: ['疲れ', '不安'], tags: ['fatigue'] }),
  make('emotion-08', 'どうせ誰も聞いてくれないですよね。でも薬が必要です。', { factPatterns: ['聞いてくれない', '薬'], request: 'medical_assistance', emotionPatterns: ['不安', '不満'], tags: ['anger', 'medical'] }),
  make('emotion-09', 'Please do not ignore us. My child has no blanket and we have been waiting for hours.', { factPatterns: ['ignore', 'child', 'blanket', 'waiting'], request: 'food_supply', emotionPatterns: ['不安', '焦り'] }, 'en', ['english', 'anger']),
  make('emotion-10', '困っています。うまく説明できないけれど、誰か話を聞いてください。', { factPatterns: ['困っています', '説明できない'], request: 'general_assistance', emotionPatterns: ['不安'], tags: ['confused'] }),
];

export const phase2fCases = [
  ...water,
  ...toilet,
  ...supplies,
  ...medical,
  ...safety,
  ...ordinary,
  ...boundaries,
  ...corrections,
  ...multilingual,
  ...emotional,
];

if (phase2fCases.length !== 100) throw new Error(`Phase 2F fixed set must contain 100 cases, got ${phase2fCases.length}`);

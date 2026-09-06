type HomeNotice = {
  id: string;
  title: string;
  art: number;
  rows: Array<[string, string]>;
  status: string;
  tone: 'warm' | 'cool' | 'green' | 'purple';
};

/* 実データ接続時は、この配列を避難所設定から差し替える。 */
const HOME_NOTICES: HomeNotice[] = [
  { id: 'meal', title: '食べ物・飲み物', art: 1, rows: [['次回の食事配布', '18:30〜19:30'], ['場所', '体育館入口'], ['目安', '1人1食まで']], status: '現在、準備中です', tone: 'warm' },
  { id: 'water', title: '飲料水・給水所', art: 2, rows: [['給水時間', '8:00〜20:00'], ['場所', '体育館南入口'], ['目安', '1人2本まで']], status: '現在、安定して供給中', tone: 'cool' },
  { id: 'toilet', title: 'トイレ', art: 3, rows: [['北トイレ', 'やや混雑'], ['南トイレ', '比較的すいています'], ['清掃', '定期的に実施しています']], status: '次回の清掃予定 20:00', tone: 'green' },
  { id: 'sleep', title: '寝る場所', art: 4, rows: [['利用状況', '体育館　やや混雑'], ['教室棟', '比較的すいています'], ['毛布', '貸し出しあり']], status: '寒さ対策を行っています', tone: 'purple' },
  { id: 'medical', title: '救護・医療', art: 5, rows: [['対応時間', '8:00〜20:00'], ['場所', '保健室（体育館となり）'], ['巡回', '医師の巡回　1日2回']], status: '体調に不安がある場合は早めにご相談ください', tone: 'warm' },
  { id: 'hygiene', title: '衛生・入浴', art: 6, rows: [['利用時間', '17:00〜21:00'], ['場所', '体育館東側'], ['お願い', '1人10分程度でのご利用を']], status: 'シャンプー・石けんがあります', tone: 'cool' },
  { id: 'waste', title: 'ごみの回収', art: 7, rows: [['回収時間', '朝 8:00 / 昼 12:00'], ['夕方', '18:00'], ['場所', '体育館入口横']], status: '分別にご協力ください', tone: 'green' },
  { id: 'charging', title: '充電スペース', art: 8, rows: [['利用時間', '8:00〜22:00'], ['場所', '多目的室'], ['目安', '1人30分程度でのご利用を']], status: 'コンセントの数に限りがあります', tone: 'warm' },
  { id: 'pet', title: 'ペット', art: 9, rows: [['場所', '屋外テントスペース'], ['利用ルール', 'ケージをご使用ください'], ['相談', '分からないときは職員へ']], status: 'スタッフにお声がけください', tone: 'cool' },
];

export function ShelterHomeBoard() {
  return <section className="shelter-home-board" aria-labelledby="shelter-home-board-title">
    <div className="shelter-home-board-heading">
      <div><p className="eyebrow">いま確認できる案内</p><h2 id="shelter-home-board-title">避難所のいま</h2><p>食事・水・トイレなど、よく使う場所の情報をまとめています。</p></div>
      <span className="shelter-home-board-note" aria-label="案内について">必要な情報を<br />すぐに確認できます</span>
    </div>
    <div className="shelter-home-notice-grid">{HOME_NOTICES.map((notice) => <article className={`shelter-home-notice tone-${notice.tone}`} key={notice.id}>
      <div className="shelter-home-notice-title"><span className={`shelter-home-art art-${notice.art}`} aria-hidden="true" /><h3>{notice.title}</h3></div>
      <dl>{notice.rows.map(([label, value]) => <div key={`${notice.id}-${label}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="shelter-home-status">{notice.status}</p>
    </article>)}</div>
    <p className="shelter-home-board-footnote">※ 表示はデモ用の避難所案内です。実際の状況は、現地の掲示や職員の案内もご確認ください。</p>
  </section>;
}

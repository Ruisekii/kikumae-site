type HomeNotice = {
  id: string;
  title: string;
  art: number;
  rows: Array<[string, string]>;
  status: string;
  updatedAt: string;
  tone: 'warm' | 'cool' | 'green' | 'purple';
};

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/* イセキ避難所にいる想定で確認できる案内例。実運用では避難所設定から差し替える。 */
const HOME_NOTICES: HomeNotice[] = [
  { id: 'meal', title: 'イセキ避難所の食事', art: 1, rows: [['次回の食事配布', '18:30〜19:30'], ['場所', '体育館入口の配布テーブル'], ['目安', '1人1食まで']], status: '配布状況は現地掲示を優先', updatedAt: '2026-09-07T14:10:00+09:00', tone: 'warm' },
  { id: 'water', title: '飲料水・給水所', art: 2, rows: [['給水時間', '8:00〜20:00'], ['場所', '体育館南入口の給水テーブル'], ['目安', '1人2本まで']], status: '在庫は現地でご確認ください', updatedAt: '2026-09-07T14:20:00+09:00', tone: 'cool' },
  { id: 'toilet', title: 'トイレ・手洗い', art: 3, rows: [['北トイレ', '混雑しやすい'], ['南トイレ', '比較的すいています'], ['清掃', '次回 20:00予定']], status: '故障や汚れは受付へ', updatedAt: '2026-09-07T14:05:00+09:00', tone: 'green' },
  { id: 'sleep', title: '寝る場所・毛布', art: 4, rows: [['利用状況', '体育館A区画はやや混雑'], ['教室棟', '1階を開放中'], ['毛布', '受付で貸し出し']], status: '寒いときは早めに職員へ', updatedAt: '2026-09-07T13:50:00+09:00', tone: 'purple' },
  { id: 'medical', title: '救護・医療', art: 5, rows: [['対応時間', '8:00〜20:00'], ['場所', '保健室（体育館となり）'], ['巡回', '医師の巡回　午前・午後']], status: '緊急時は近くの職員へ', updatedAt: '2026-09-07T13:45:00+09:00', tone: 'warm' },
  { id: 'hygiene', title: '衛生・入浴', art: 6, rows: [['利用時間', '17:00〜21:00'], ['場所', '体育館東側の簡易入浴スペース'], ['お願い', '1人10分程度']], status: 'シャンプー・石けんあり', updatedAt: '2026-09-07T13:30:00+09:00', tone: 'cool' },
  { id: 'waste', title: 'ごみの回収', art: 7, rows: [['回収時間', '8:00 / 12:00 / 18:00'], ['場所', '体育館入口横の分別テーブル'], ['お願い', '燃える・燃えないを分別']], status: '分別にご協力ください', updatedAt: '2026-09-07T13:20:00+09:00', tone: 'green' },
  { id: 'charging', title: '充電スペース', art: 8, rows: [['利用時間', '8:00〜22:00'], ['場所', '多目的室'], ['目安', '1人30分程度']], status: 'コンセントに限りがあります', updatedAt: '2026-09-07T13:15:00+09:00', tone: 'warm' },
  { id: 'pet', title: 'ペット', art: 9, rows: [['場所', '屋外テントスペース'], ['利用ルール', 'ケージをご使用ください'], ['相談', '分からないときは受付へ']], status: '職員が場所をご案内します', updatedAt: '2026-09-07T13:00:00+09:00', tone: 'cool' },
];

export function ShelterHomeBoard() {
  return <section className="shelter-home-board" aria-labelledby="shelter-home-board-title">
    <div className="shelter-home-board-heading">
      <div><p className="eyebrow">イセキ避難所の参考案内</p><h2 id="shelter-home-board-title">イセキ避難所にいる方へ</h2><p>食事・水・トイレ・救護など、今すぐ確認したい場所と時間をまとめています。</p></div>
      <span className="shelter-home-board-note" aria-label="案内について">現在の状況は<br />現地の掲示を優先</span>
    </div>
    <div className="shelter-home-notice-grid">{HOME_NOTICES.map((notice) => <article className={`shelter-home-notice tone-${notice.tone}`} key={notice.id}>
      <div className="shelter-home-notice-title"><span className={`shelter-home-art art-${notice.art}`} aria-hidden="true" /><h3>{notice.title}</h3></div>
      <dl>{notice.rows.map(([label, value]) => <div key={`${notice.id}-${label}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="shelter-home-status">{notice.status}</p>
      <p className="shelter-home-updated"><span>更新日時</span><time dateTime={notice.updatedAt}>{formatUpdatedAt(notice.updatedAt)}</time></p>
    </article>)}</div>
    <p className="shelter-home-board-footnote">※ ここに表示される内容は「イセキ避難所」の案内例です。配布時間・場所・在庫などは、現地の掲示や職員の案内を優先してください。</p>
  </section>;
}

import { useApi } from '../api.ts';
import { Spinner } from '../components/ui.tsx';

interface Credit {
  file: string;
  subject: string;
  creator: string;
  license: string;
  source: string;
}

/** Turn "[text](url)" into a link. */
function MdLink({ md }: { md: string }) {
  const m = md.match(/^\[(.+?)\]\((.+?)\)$/);
  if (!m) return <>{md}</>;
  return (
    <a href={m[2]} target="_blank" rel="noreferrer">
      {m[1]}
    </a>
  );
}

export function About() {
  const { data } = useApi<Credit[]>('/credits');
  return (
    <div className="credits">
      <h1>About BorrowBox</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        BorrowBox is a small lending library for people who know each other. There are no fees, deposits or ratings — just
        clear dates, kind notes, and a shared record of how things went out and came back.
      </p>
      <h2 style={{ marginTop: 28 }}>How dates work</h2>
      <p className="muted" style={{ marginTop: 8 }}>
        Borrowing dates are whole calendar days in the community’s time zone, counted inclusively: borrowing Tuesday to
        Thursday is three days, and the item is due back by the end of Thursday. Someone else can’t book the day you hand it back.
      </p>
      <h2 style={{ marginTop: 28 }}>Demo photo credits</h2>
      <p className="muted" style={{ marginTop: 8 }}>The demo items use openly licensed photos, resized and cropped.</p>
      {!data ? (
        <Spinner />
      ) : (
        <ul style={{ marginTop: 12 }}>
          {data.map((c) => (
            <li key={c.file}>
              {c.subject} — {c.creator}, <MdLink md={c.license} /> (<MdLink md={c.source} />)
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

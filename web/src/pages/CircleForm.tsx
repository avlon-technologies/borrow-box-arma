import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, useAction, useApi } from '../api.ts';
import { useSession } from '../session.tsx';
import { useToast } from '../toast.tsx';
import { Avatar, BackLink, Button, ErrorState, InlineError, Spinner } from '../components/ui.tsx';
import { CIRCLE_HUES, CircleMark } from '../components/circles.tsx';
import { NotFound } from './NotFound.tsx';
import type { CircleDetail, Person } from '../types.ts';

export function CircleForm() {
  const { id } = useParams();
  const editing = !!id;
  const existing = useApi<CircleDetail>(editing ? `/circles/${id}` : null);
  const people = useApi<Person[]>(editing ? null : '/people');
  const { user, refresh } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const action = useAction();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hue, setHue] = useState(CIRCLE_HUES[0]);
  const [invite, setInvite] = useState<Set<string>>(new Set());

  useEffect(() => {
    const c = existing.data;
    if (c) {
      setName(c.name);
      setDescription(c.description);
      setHue(c.hue);
    }
  }, [existing.data]);

  if (editing) {
    if (existing.error?.status === 404) return <NotFound title="Circle not found" message={existing.error.message} />;
    if (existing.error) return <ErrorState error={existing.error} onRetry={existing.reload} />;
    if (!existing.data) return <Spinner />;
    if (existing.data.me.role !== 'organizer')
      return <NotFound title="Only organizers can edit this circle" message="Ask one of its organizers if something needs changing." />;
  }

  const fields = action.error?.fields ?? {};
  const others = (people.data ?? []).filter((p) => p.id !== user?.id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = editing ? { name, description, hue } : { name, description, hue, inviteIds: [...invite] };
    const saved = await action.run((key) =>
      api<CircleDetail>(editing ? `/circles/${id}` : '/circles', { method: editing ? 'PUT' : 'POST', body, idempotencyKey: key }),
    );
    if (saved) {
      refresh();
      toast(editing ? 'Circle updated' : invite.size ? `${saved.name} is ready — invitations sent` : `${saved.name} is ready`);
      navigate(`/circles/${saved.id}`, { replace: true });
    }
  }

  return (
    <div className="form-page">
      <BackLink to={editing ? `/circles/${id}` : '/circles'}>{editing ? 'Back to circle' : 'Circles'}</BackLink>
      <h1>{editing ? 'Edit circle' : 'Start a circle'}</h1>
      <p className="muted">
        {editing ? 'Members see the new name and description straight away.' : 'A circle is a shared shelf for people you trust. You’ll be its organizer.'}
      </p>
      <form className="circle-form" onSubmit={submit} noValidate>
        <div className="circle-preview" aria-hidden>
          <CircleMark circle={{ name: name || 'Your circle', hue }} size={84} />
          <strong>{name || 'Your circle'}</strong>
          <span className="muted small">{description || 'What brings you together?'}</span>
        </div>
        <div className="form-fields">
          <label className="field">
            <span className="field-label">Name</span>
            <input
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Elm Street Neighbours"
              aria-invalid={!!fields.name}
              aria-describedby={fields.name ? 'name-err' : undefined}
              required
            />
            {fields.name && <span id="name-err" className="field-error">{fields.name}</span>}
          </label>
          <label className="field">
            <span className="field-label">
              What’s it for? <span className="optional">optional</span>
            </span>
            <textarea rows={3} maxLength={400} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who’s in it, what you share, any house rules" />
          </label>
          <fieldset className="field">
            <legend className="field-label">Colour</legend>
            <div className="swatches">
              {CIRCLE_HUES.map((h) => (
                <label key={h} className={`swatch ${hue === h ? 'on' : ''}`} style={{ background: `hsl(${h} 55% 72%)` }}>
                  <input type="radio" name="hue" value={h} checked={hue === h} onChange={() => setHue(h)} />
                  <span className="sr-only">Colour {CIRCLE_HUES.indexOf(h) + 1}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {!editing && (
            <fieldset className="field">
              <legend className="field-label">
                Invite friends <span className="optional">optional — you can invite people later too</span>
              </legend>
              {people.loading ? (
                <Spinner label="Loading people" />
              ) : (
                <ul className="invite-list">
                  {others.map((p) => (
                    <li key={p.id}>
                      <label className={`invite-option ${invite.has(p.id) ? 'on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={invite.has(p.id)}
                          onChange={(e) =>
                            setInvite((s) => {
                              const next = new Set(s);
                              e.target.checked ? next.add(p.id) : next.delete(p.id);
                              return next;
                            })
                          }
                        />
                        <Avatar person={p} size={32} />
                        <span>
                          <strong>{p.name}</strong>
                          <small>{p.neighbourhood}</small>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <p className="muted small">They’ll get an invitation to accept — nobody is added without saying yes.</p>
            </fieldset>
          )}
          <InlineError error={action.error} />
          <div className="row gap">
            <Button type="submit" pending={action.pending}>
              {editing ? 'Save changes' : 'Start the circle'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

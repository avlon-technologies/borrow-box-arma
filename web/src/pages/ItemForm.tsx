import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ImagePlus, Trash2 } from 'lucide-react';
import { api, useAction, useApi, type ApiError } from '../api.ts';
import { useSession } from '../session.tsx';
import { useToast } from '../toast.tsx';
import { BackLink, Button, ErrorState, InlineError, ItemImage, Spinner } from '../components/ui.tsx';
import { uploadPhoto } from '../components/PhotoPicker.tsx';
import { NotFound } from './NotFound.tsx';
import type { ItemDetail } from '../types.ts';

interface Draft {
  title: string;
  description: string;
  category: string;
  maxDays: number;
  pickupNotes: string;
  careNotes: string;
  image: string | null; // upload id or existing url
  imageUrl: string | null; // for preview
}

const blank: Draft = { title: '', description: '', category: '', maxDays: 7, pickupNotes: '', careNotes: '', image: null, imageUrl: null };

export function ItemForm() {
  const { id } = useParams();
  const editing = !!id;
  const existing = useApi<ItemDetail>(editing ? `/items/${id}` : null);
  const { config, user } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(blank);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<{ message: string } | null>(null);
  const action = useAction();

  useEffect(() => {
    const it = existing.data;
    if (it)
      setDraft({
        title: it.title, description: it.description, category: it.category, maxDays: it.maxDays,
        pickupNotes: it.pickupNotes, careNotes: it.careNotes, image: it.imageUrl, imageUrl: it.imageUrl,
      });
  }, [existing.data]);

  if (editing) {
    if (existing.error?.status === 404) return <NotFound title="Item not found" />;
    if (existing.error) return <ErrorState error={existing.error} onRetry={existing.reload} />;
    if (!existing.data) return <Spinner />;
    if (existing.data.owner.id !== user?.id) return <NotFound title="Only the owner can edit this" message="You can request it from its page instead." />;
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const fields = action.error?.fields ?? {};

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    setUploading(true);
    try {
      const p = await uploadPhoto(file);
      setDraft((d) => ({ ...d, image: p.id, imageUrl: p.url }));
    } catch (e) {
      setPhotoError(e as ApiError);
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      title: draft.title, description: draft.description, category: draft.category, maxDays: draft.maxDays,
      pickupNotes: draft.pickupNotes, careNotes: draft.careNotes, image: draft.image,
    };
    const saved = await action.run((key) =>
      api<ItemDetail>(editing ? `/items/${id}` : '/items', { method: editing ? 'PUT' : 'POST', body, idempotencyKey: key }),
    );
    if (saved) {
      toast(editing ? 'Changes saved' : 'It’s on your shelf — neighbours can request it now');
      navigate(`/items/${saved.id}`);
    }
  }

  return (
    <div className="form-page">
      <BackLink to={editing ? `/items/${id}` : '/lending'}>{editing ? 'Back to item' : 'Lending'}</BackLink>
      <h1>{editing ? 'Edit item' : 'Share something'}</h1>
      <p className="muted">{editing ? 'Changes apply to new requests; existing bookings keep their dates.' : 'A good photo and clear rules make people comfortable asking.'}</p>
      <form className="item-form" onSubmit={submit} noValidate>
        <div className="photo-field">
          <div className="photo-preview">
            <ItemImage url={draft.imageUrl} title={draft.title || 'Your item'} category={draft.category || 'Tools'} />
            {uploading && (
              <div className="photo-overlay" role="status">
                <Spinner label="Uploading photo" />
              </div>
            )}
          </div>
          <div className="row gap wrap">
            <label className="btn btn-secondary">
              <ImagePlus size={18} aria-hidden />
              <span>{draft.imageUrl ? 'Change photo' : 'Add a photo'}</span>
              <input className="sr-only" type="file" accept="image/*" onChange={(e) => onPhoto(e.target.files?.[0])} />
            </label>
            {draft.imageUrl && (
              <Button type="button" variant="ghost" icon={<Trash2 size={16} />} onClick={() => setDraft((d) => ({ ...d, image: null, imageUrl: null }))}>
                Remove
              </Button>
            )}
          </div>
          <InlineError error={photoError} />
        </div>

        <div className="form-fields">
          <label className="field">
            <span className="field-label">What is it?</span>
            <input value={draft.title} maxLength={80} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Pasta maker" aria-invalid={!!fields.title} aria-describedby={fields.title ? 'title-err' : undefined} required />
            {fields.title && <span id="title-err" className="field-error">{fields.title}</span>}
          </label>
          <label className="field">
            <span className="field-label">Category</span>
            <select value={draft.category} onChange={(e) => set('category', e.target.value)} aria-invalid={!!fields.category} required>
              <option value="" disabled>
                Choose one
              </option>
              {config?.categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            {fields.category && <span className="field-error">{fields.category}</span>}
          </label>
          <label className="field">
            <span className="field-label">
              Tell people about it <span className="optional">optional</span>
            </span>
            <textarea rows={4} maxLength={1500} value={draft.description} onChange={(e) => set('description', e.target.value)} placeholder="What’s included, what it’s great for, any quirks" />
          </label>
          <fieldset className="rules-fields">
            <legend>Your borrowing rules</legend>
            <label className="field">
              <span className="field-label">Longest loan</span>
              <span className="row gap-s">
                <input className="input-short" type="number" min={1} max={60} value={draft.maxDays} onChange={(e) => set('maxDays', Number(e.target.value))} aria-invalid={!!fields.maxDays} />
                <span>days at a time</span>
              </span>
              {fields.maxDays && <span className="field-error">{fields.maxDays}</span>}
            </label>
            <label className="field">
              <span className="field-label">
                Pickup & return <span className="optional">optional</span>
              </span>
              <textarea rows={2} maxLength={600} value={draft.pickupNotes} onChange={(e) => set('pickupNotes', e.target.value)} placeholder="Where and when people can collect and drop it off" />
            </label>
            <label className="field">
              <span className="field-label">
                Care instructions <span className="optional">optional</span>
              </span>
              <textarea rows={2} maxLength={600} value={draft.careNotes} onChange={(e) => set('careNotes', e.target.value)} placeholder="Anything to know to keep it in good shape" />
            </label>
          </fieldset>
          <InlineError error={action.error} />
          <div className="row gap">
            <Button type="submit" pending={action.pending} disabled={uploading}>
              {editing ? 'Save changes' : 'Add to my shelf'}
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

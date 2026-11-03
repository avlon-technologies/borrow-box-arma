import { useId, useRef, useState } from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import { api, newKey, type ApiError } from '../api.ts';
import { InlineError } from './ui.tsx';

export interface Photo {
  id: string;
  url: string;
}

/** Shrink big phone photos in the browser before uploading. */
async function prepare(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('That file isn’t a photo.');
  if (file.type === 'image/gif') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('We couldn’t read that photo. Try a JPEG or PNG.');
  }
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1_500_000 && file.type !== 'image/heic') return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t process that photo.'))), 'image/jpeg', 0.85),
  );
}

export async function uploadPhoto(file: File): Promise<Photo> {
  const blob = await prepare(file);
  return api<Photo>('/uploads', { raw: blob, idempotencyKey: newKey() });
}

export function PhotoPicker({
  value,
  onChange,
  max = 6,
  label = 'Add photos',
}: {
  value: Photo[];
  onChange: (photos: Photo[]) => void;
  max?: number;
  label?: string;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<{ message: string } | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const room = max - value.length;
    const list = Array.from(files).slice(0, room);
    if (files.length > room) setError({ message: `Up to ${max} photos — we added the first ${room}.` });
    setUploading(list.length);
    const added: Photo[] = [];
    for (const f of list) {
      try {
        added.push(await uploadPhoto(f));
      } catch (e) {
        setError({ message: (e as ApiError).message });
      } finally {
        setUploading((n) => n - 1);
      }
    }
    onChange([...value, ...added]);
    if (input.current) input.current.value = '';
  }

  return (
    <div className="photo-picker">
      <div className="photo-row">
        {value.map((p, i) => (
          <div key={p.id} className="photo-thumb">
            <img src={p.url} alt={`Photo ${i + 1}`} />
            <button type="button" className="photo-remove" onClick={() => onChange(value.filter((x) => x.id !== p.id))} aria-label={`Remove photo ${i + 1}`}>
              <X size={14} />
            </button>
          </div>
        ))}
        {Array.from({ length: uploading }, (_, i) => (
          <div key={`u${i}`} className="photo-thumb photo-uploading" role="status">
            <Loader2 className="spin" size={20} aria-hidden />
            <span className="sr-only">Uploading…</span>
          </div>
        ))}
        {value.length + uploading < max && (
          <label htmlFor={inputId} className="photo-add">
            <Camera size={20} aria-hidden />
            <span>{label}</span>
          </label>
        )}
      </div>
      <input
        id={inputId}
        ref={input}
        className="sr-only"
        type="file"
        accept="image/*"
        multiple={max > 1}
        onChange={(e) => onFiles(e.target.files)}
      />
      <InlineError error={error} />
    </div>
  );
}

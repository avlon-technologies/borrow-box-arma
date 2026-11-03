import { useId } from 'react';
import { useSession } from '../session.tsx';
import { PhotoPicker, type Photo } from './PhotoPicker.tsx';

export interface ReportDraft {
  condition: string;
  notes: string;
  photos: Photo[];
}

export const emptyReport = (condition = ''): ReportDraft => ({ condition, notes: '', photos: [] });

export function toReport(d: ReportDraft) {
  return { condition: d.condition, notes: d.notes, photoIds: d.photos.map((p) => p.id) };
}

export function ReportFields({
  value,
  onChange,
  legend = 'How does it look?',
  notesLabel = 'Notes',
  notesPlaceholder = 'Anything worth noting — scratches, missing bits, how it worked',
}: {
  value: ReportDraft;
  onChange: (d: ReportDraft) => void;
  legend?: string;
  notesLabel?: string;
  notesPlaceholder?: string;
}) {
  const { config } = useSession();
  const name = useId();
  return (
    <div className="report-fields">
      <fieldset className="condition-picker">
        <legend className="field-label">{legend}</legend>
        <div className="condition-options">
          {config?.conditions.map((c) => (
            <label key={c.value} className={`condition-option ${value.condition === c.value ? 'on' : ''} cond-${c.value}`}>
              <input
                type="radio"
                name={name}
                value={c.value}
                checked={value.condition === c.value}
                onChange={() => onChange({ ...value, condition: c.value })}
              />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field">
        <span className="field-label">
          {notesLabel} <span className="optional">optional</span>
        </span>
        <textarea rows={3} maxLength={600} value={value.notes} placeholder={notesPlaceholder} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
      </label>
      <div className="field">
        <span className="field-label">
          Photos <span className="optional">optional, up to 6</span>
        </span>
        <PhotoPicker value={value.photos} onChange={(photos) => onChange({ ...value, photos })} />
      </div>
    </div>
  );
}

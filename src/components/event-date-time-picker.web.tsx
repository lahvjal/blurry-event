import React, { useEffect, useRef } from 'react';

import { fonts } from '@/constants/theme';

import { EventDateTimePickerProps } from './event-date-time-picker.types';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function inputValue(value: Date, mode: EventDateTimePickerProps['mode']): string {
  if (mode === 'date') {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

/**
 * PWA fallback for the native-only community picker. Browser date/time inputs
 * preserve the device's familiar selector while keeping values in local time.
 */
export function EventDateTimePicker({
  value,
  mode,
  onChange,
  minuteInterval = 5,
}: EventDateTimePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    input?.focus();
    try {
      input?.showPicker?.();
    } catch {
      // Some browsers require a second direct tap; the focused control remains
      // visible and fully usable in that case.
    }
  }, [mode]);

  const change = (event: React.FormEvent<HTMLInputElement>) => {
    const raw = event.currentTarget.value;
    if (!raw) return;

    if (mode === 'date') {
      const [year, month, day] = raw.split('-').map(Number);
      if (!year || !month || !day) return;
      onChange(new Date(year, month - 1, day, 12));
      return;
    }

    const [hours, minutes] = raw.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return;
    const selected = new Date(value);
    selected.setHours(hours, minutes, 0, 0);
    onChange(selected);
  };

  return (
    <input
      ref={inputRef}
      aria-label={mode === 'date' ? 'Select event date' : 'Select event time'}
      type={mode}
      value={inputValue(value, mode)}
      step={mode === 'time' ? minuteInterval * 60 : undefined}
      onInput={change}
      style={inputStyle}
    />
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 48,
  boxSizing: 'border-box',
  border: '1px solid rgba(123,255,178,0.28)',
  borderRadius: 0,
  outline: 'none',
  padding: '0 14px',
  background: '#181d1a',
  color: '#ffffff',
  colorScheme: 'dark',
  accentColor: '#7bffb2',
  fontFamily: fonts.regular,
  fontSize: 14,
};

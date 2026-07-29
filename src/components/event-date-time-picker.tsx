import DateTimePicker from '@react-native-community/datetimepicker';
import React from 'react';
import { Platform } from 'react-native';

import { EventDateTimePickerProps } from './event-date-time-picker.types';

/**
 * Native event editor picker. Metro swaps in the web implementation for the
 * PWA, while iOS and Android retain their system date/time controls.
 */
export function EventDateTimePicker({
  value,
  mode,
  onChange,
  minuteInterval = 5,
}: EventDateTimePickerProps) {
  return (
    <DateTimePicker
      value={value}
      mode={mode}
      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
      onChange={(_, selected) => onChange(selected)}
      themeVariant="dark"
      minuteInterval={minuteInterval}
    />
  );
}

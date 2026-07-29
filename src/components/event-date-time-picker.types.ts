export type EventPickerMode = 'date' | 'time';

export type EventPickerMinuteInterval =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 10
  | 12
  | 15
  | 20
  | 30;

export type EventDateTimePickerProps = {
  value: Date;
  mode: EventPickerMode;
  onChange: (selected?: Date) => void;
  minuteInterval?: EventPickerMinuteInterval;
};

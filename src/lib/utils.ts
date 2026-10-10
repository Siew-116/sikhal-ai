import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function dayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] ?? 'Unknown';
}

export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDayTime(dayOfWeek: number, startMinute: number, endMinute: number): string {
  return `${dayName(dayOfWeek).slice(0, 3)} ${formatMinute(startMinute)}–${formatMinute(endMinute)}`;
}

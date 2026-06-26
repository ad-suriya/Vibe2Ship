import { useState } from 'react';
import { cn } from '../utils';
import type { BlockSchedule, DayOfWeek, Schedule } from '@extension/types';

interface ScheduleManagerProps {
  schedules: BlockSchedule[];
  onAdd: (schedule: Omit<BlockSchedule, 'id' | 'createdAt' | 'lastModified'>) => Promise<void>;
  onUpdate: (id: string, updates: Partial<BlockSchedule>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  isLight?: boolean;
}

const DAYS: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export function ScheduleManager({
  schedules,
  onAdd,
  onUpdate,
  onDelete,
  isLight = false,
}: ScheduleManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [sites, setSites] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [scheduleType, setScheduleType] = useState<'daily' | 'weekly' | 'custom'>('weekly');
  const [selectedDays, setSelectedDays] = useState<DayOfWeek[]>(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);

  const handleAddSchedule = async () => {
    if (!sites.trim()) return;

    const siteList = sites.split(',').map(s => s.trim());

    let schedule: Schedule;
    if (scheduleType === 'daily') {
      schedule = { type: 'daily', timeRange: { startTime, endTime } };
    } else if (scheduleType === 'weekly') {
      schedule = { type: 'weekly', days: selectedDays, timeRange: { startTime, endTime } };
    } else {
      schedule = { type: 'custom', dates: [], timeRange: { startTime, endTime } };
    }

    await onAdd({
      sites: siteList,
      schedule,
      isActive: true,
    });

    setSites('');
    setShowForm(false);
  };

  return (
    <div className={cn('space-y-4', isLight ? 'text-gray-900' : 'text-white')}>
      <h3 className="text-lg font-semibold">Schedule Blocking</h3>

      {/* Active Schedules */}
      <div className="space-y-2">
        {schedules.map((sched) => (
          <div
            key={sched.id}
            className={cn(
              'rounded-lg p-3 border',
              isLight
                ? 'bg-gray-50 border-gray-200'
                : 'bg-gray-800 border-gray-700',
            )}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{sched.sites.join(', ')}</p>
                <p className="text-xs opacity-70">
                  {sched.schedule.type === 'daily'
                    ? `Daily ${sched.schedule.timeRange.startTime}-${sched.schedule.timeRange.endTime}`
                    : sched.schedule.type === 'weekly'
                      ? `${sched.schedule.days.join(', ')} ${sched.schedule.timeRange.startTime}-${sched.schedule.timeRange.endTime}`
                      : `Custom`}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onUpdate(sched.id, { isActive: !sched.isActive })}
                  className={cn(
                    'px-2 py-1 rounded text-xs font-medium',
                    sched.isActive
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-gray-600 hover:bg-gray-700',
                  )}>
                  {sched.isActive ? 'Active' : 'Inactive'}
                </button>
                <button
                  onClick={() => onDelete(sched.id)}
                  className="px-2 py-1 rounded text-xs font-medium bg-red-600 hover:bg-red-700">
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Schedule Form */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className={cn(
            'w-full rounded-lg px-4 py-2 font-semibold',
            isLight
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-blue-700 text-white hover:bg-blue-800',
          )}>
          + Add Schedule
        </button>
      ) : (
        <div className={cn('rounded-lg p-4 space-y-3 border', isLight ? 'bg-gray-50 border-gray-200' : 'bg-gray-800 border-gray-700')}>
          <input
            type="text"
            placeholder="Sites (youtube.com, twitter.com)"
            value={sites}
            onChange={(e) => setSites(e.target.value)}
            className={cn(
              'w-full rounded px-3 py-2 text-sm',
              isLight ? 'bg-white border border-gray-300' : 'bg-gray-700 border border-gray-600 text-white',
            )}
          />

          <div className="grid grid-cols-2 gap-2">
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={cn(
                'rounded px-3 py-2 text-sm',
                isLight ? 'bg-white border border-gray-300' : 'bg-gray-700 border border-gray-600 text-white',
              )}
            />
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={cn(
                'rounded px-3 py-2 text-sm',
                isLight ? 'bg-white border border-gray-300' : 'bg-gray-700 border border-gray-600 text-white',
              )}
            />
          </div>

          <select
            value={scheduleType}
            onChange={(e) => setScheduleType(e.target.value as any)}
            className={cn(
              'w-full rounded px-3 py-2 text-sm',
              isLight ? 'bg-white border border-gray-300' : 'bg-gray-700 border border-gray-600 text-white',
            )}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="custom">Custom Dates</option>
          </select>

          {scheduleType === 'weekly' && (
            <div className="grid grid-cols-4 gap-1">
              {DAYS.map((day) => (
                <button
                  key={day}
                  onClick={() =>
                    setSelectedDays(
                      selectedDays.includes(day)
                        ? selectedDays.filter((d) => d !== day)
                        : [...selectedDays, day],
                    )
                  }
                  className={cn(
                    'rounded px-2 py-1 text-xs font-medium capitalize',
                    selectedDays.includes(day)
                      ? 'bg-blue-600 text-white'
                      : isLight
                        ? 'bg-gray-300 text-gray-900'
                        : 'bg-gray-600 text-white',
                  )}>
                  {day.slice(0, 3)}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleAddSchedule}
              className="flex-1 rounded px-3 py-2 font-semibold bg-green-600 hover:bg-green-700 text-white text-sm">
              Save
            </button>
            <button
              onClick={() => setShowForm(false)}
              className={cn(
                'flex-1 rounded px-3 py-2 font-semibold text-sm',
                isLight ? 'bg-gray-300 hover:bg-gray-400' : 'bg-gray-600 hover:bg-gray-700 text-white',
              )}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export type ToolType = 'Asset Composer' | 'Background Remover' | 'P12 Generator';

export interface RecentActivity {
  id: string;
  name: string;
  tool: ToolType;
  timestamp: number;
}

export function addRecentActivity(activity: Omit<RecentActivity, 'id' | 'timestamp'>) {
  if (typeof window === 'undefined') return;
  const activities = getRecentActivities();
  const newActivity: RecentActivity = {
    ...activity,
    id: Math.random().toString(36).substring(2, 10),
    timestamp: Date.now(),
  };
  activities.unshift(newActivity);
  localStorage.setItem('cs_recent_activities', JSON.stringify(activities.slice(0, 15)));
}

export function getRecentActivities(): RecentActivity[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem('cs_recent_activities');
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'circuit' | 'simulation' | 'collaboration' | 'learning' | 'creativity';
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  points: number;
  requirements: AchievementRequirement[];
  rewards: AchievementReward[];
  unlockedAt?: Date;
  progress?: number;
  maxProgress?: number;
}

export interface AchievementRequirement {
  type: 'circuit_created' | 'simulation_run' | 'component_used' | 'collaboration_session' | 'tutorial_completed' | 'streak_days' | 'level_reached';
  target: number;
  current: number;
}

export interface AchievementReward {
  type: 'points' | 'badge' | 'unlock' | 'multiplier';
  value: number | string;
  description: string;
}

export interface UserStats {
  userId: string;
  level: number;
  experience: number;
  experienceToNext: number;
  totalPoints: number;
  achievements: Achievement[];
  streaks: {
    current: number;
    longest: number;
    lastActivity: Date;
  };
  stats: {
    circuitsCreated: number;
    simulationsRun: number;
    componentsUsed: number;
    collaborationSessions: number;
    tutorialsCompleted: number;
    timeSpent: number; // in minutes
  };
  multipliers: {
    experience: number;
    points: number;
  };
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  avatar?: string;
  score: number;
  rank: number;
  level: number;
  achievements: number;
}

export interface GamificationEvent {
  type: 'circuit_created' | 'simulation_completed' | 'achievement_unlocked' | 'level_up' | 'streak_maintained' | 'collaboration_joined';
  userId: string;
  data: Record<string, unknown>;
  timestamp: Date;
  points?: number;
  experience?: number;
}

export class GamificationEngine {
  private achievements: Map<string, Achievement> = new Map();
  private userStats: Map<string, UserStats> = new Map();
  private leaderboard: LeaderboardEntry[] = [];
  private eventListeners: Map<string, ((event: GamificationEvent) => void)[]> = new Map();

  constructor() {
    this.initializeAchievements();
  }

  private initializeAchievements(): void {
    const defaultAchievements: Achievement[] = [
      {
        id: 'first_circuit',
        name: 'First Circuit',
        description: 'Create your first circuit design',
        icon: '⚡',
        category: 'circuit',
        rarity: 'common',
        points: 10,
        requirements: [{ type: 'circuit_created', target: 1, current: 0 }],
        rewards: [{ type: 'points', value: 10, description: '10 points' }]
      },
      {
        id: 'circuit_master',
        name: 'Circuit Master',
        description: 'Create 100 circuit designs',
        icon: '🎯',
        category: 'circuit',
        rarity: 'epic',
        points: 500,
        requirements: [{ type: 'circuit_created', target: 100, current: 0 }],
        rewards: [
          { type: 'points', value: 500, description: '500 points' },
          { type: 'badge', value: 'circuit_master', description: 'Circuit Master Badge' }
        ]
      },
      {
        id: 'simulation_expert',
        name: 'Simulation Expert',
        description: 'Run 50 circuit simulations',
        icon: '🔬',
        category: 'simulation',
        rarity: 'rare',
        points: 200,
        requirements: [{ type: 'simulation_run', target: 50, current: 0 }],
        rewards: [
          { type: 'points', value: 200, description: '200 points' },
          { type: 'unlock', value: 'advanced_analysis', description: 'Unlock advanced analysis tools' }
        ]
      },
      {
        id: 'collaborator',
        name: 'Team Player',
        description: 'Participate in 10 collaboration sessions',
        icon: '🤝',
        category: 'collaboration',
        rarity: 'uncommon',
        points: 100,
        requirements: [{ type: 'collaboration_session', target: 10, current: 0 }],
        rewards: [
          { type: 'points', value: 100, description: '100 points' },
          { type: 'multiplier', value: 1.1, description: '10% experience multiplier' }
        ]
      },
      {
        id: 'learner',
        name: 'Knowledge Seeker',
        description: 'Complete 5 tutorials',
        icon: '📚',
        category: 'learning',
        rarity: 'common',
        points: 50,
        requirements: [{ type: 'tutorial_completed', target: 5, current: 0 }],
        rewards: [{ type: 'points', value: 50, description: '50 points' }]
      },
      {
        id: 'streak_master',
        name: 'Consistency King',
        description: 'Maintain a 30-day activity streak',
        icon: '🔥',
        category: 'learning',
        rarity: 'legendary',
        points: 1000,
        requirements: [{ type: 'streak_days', target: 30, current: 0 }],
        rewards: [
          { type: 'points', value: 1000, description: '1000 points' },
          { type: 'multiplier', value: 2.0, description: 'Double experience multiplier' }
        ]
      },
      {
        id: 'innovator',
        name: 'Innovator',
        description: 'Use 20 different component types',
        icon: '💡',
        category: 'creativity',
        rarity: 'rare',
        points: 150,
        requirements: [{ type: 'component_used', target: 20, current: 0 }],
        rewards: [
          { type: 'points', value: 150, description: '150 points' },
          { type: 'unlock', value: 'custom_components', description: 'Unlock custom component creation' }
        ]
      }
    ];

    defaultAchievements.forEach(achievement => {
      this.achievements.set(achievement.id, achievement);
    });
  }

  getOrCreateUserStats(userId: string): UserStats {
    if (!this.userStats.has(userId)) {
      this.userStats.set(userId, {
        userId,
        level: 1,
        experience: 0,
        experienceToNext: 100,
        totalPoints: 0,
        achievements: [],
        streaks: {
          current: 0,
          longest: 0,
          lastActivity: new Date()
        },
        stats: {
          circuitsCreated: 0,
          simulationsRun: 0,
          componentsUsed: 0,
          collaborationSessions: 0,
          tutorialsCompleted: 0,
          timeSpent: 0
        },
        multipliers: {
          experience: 1.0,
          points: 1.0
        }
      });
    }
    return this.userStats.get(userId)!;
  }

  trackEvent(event: GamificationEvent): void {
    const userStats = this.getOrCreateUserStats(event.userId);

    // Update stats based on event type
    switch (event.type) {
      case 'circuit_created':
        userStats.stats.circuitsCreated++;
        this.addExperience(event.userId, 20);
        this.addPoints(event.userId, 5);
        break;
      case 'simulation_completed':
        userStats.stats.simulationsRun++;
        this.addExperience(event.userId, 15);
        this.addPoints(event.userId, 3);
        break;
      case 'collaboration_joined':
        userStats.stats.collaborationSessions++;
        this.addExperience(event.userId, 10);
        this.addPoints(event.userId, 2);
        break;
      case 'tutorial_completed':
        userStats.stats.tutorialsCompleted++;
        this.addExperience(event.userId, 25);
        this.addPoints(event.userId, 10);
        break;
    }

    // Update streaks
    this.updateStreak(event.userId);

    // Check for achievements
    this.checkAchievements(event.userId);

    // Emit event to listeners
    this.emitEvent(event);
  }

  private addExperience(userId: string, amount: number): void {
    const userStats = this.userStats.get(userId);
    if (!userStats) return;

    const actualAmount = Math.floor(amount * userStats.multipliers.experience);
    userStats.experience += actualAmount;

    // Check for level up
    while (userStats.experience >= userStats.experienceToNext) {
      userStats.experience -= userStats.experienceToNext;
      userStats.level++;
      userStats.experienceToNext = Math.floor(userStats.experienceToNext * 1.2);

      // Emit level up event
      this.emitEvent({
        type: 'level_up',
        userId,
        data: { newLevel: userStats.level },
        timestamp: new Date(),
        points: userStats.level * 10
      });
    }
  }

  private addPoints(userId: string, amount: number): void {
    const userStats = this.userStats.get(userId);
    if (!userStats) return;

    const actualAmount = Math.floor(amount * userStats.multipliers.points);
    userStats.totalPoints += actualAmount;
  }

  private updateStreak(userId: string): void {
    const userStats = this.userStats.get(userId);
    if (!userStats) return;

    const now = new Date();
    const lastActivity = userStats.streaks.lastActivity;
    const daysDiff = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff === 1) {
      // Consecutive day
      userStats.streaks.current++;
      if (userStats.streaks.current > userStats.streaks.longest) {
        userStats.streaks.longest = userStats.streaks.current;
      }
    } else if (daysDiff > 1) {
      // Streak broken
      userStats.streaks.current = 1;
    }

    userStats.streaks.lastActivity = now;
  }

  private checkAchievements(userId: string): void {
    const userStats = this.userStats.get(userId);
    if (!userStats) return;

    for (const achievement of this.achievements.values()) {
      if (userStats.achievements.some(a => a.id === achievement.id)) {
        continue; // Already unlocked
      }

      let allRequirementsMet = true;
      for (const requirement of achievement.requirements) {
        let currentValue = 0;

        switch (requirement.type) {
          case 'circuit_created':
            currentValue = userStats.stats.circuitsCreated;
            break;
          case 'simulation_run':
            currentValue = userStats.stats.simulationsRun;
            break;
          case 'component_used':
            currentValue = userStats.stats.componentsUsed;
            break;
          case 'collaboration_session':
            currentValue = userStats.stats.collaborationSessions;
            break;
          case 'tutorial_completed':
            currentValue = userStats.stats.tutorialsCompleted;
            break;
          case 'streak_days':
            currentValue = userStats.streaks.longest;
            break;
          case 'level_reached':
            currentValue = userStats.level;
            break;
        }

        requirement.current = currentValue;
        if (currentValue < requirement.target) {
          allRequirementsMet = false;
        }
      }

      if (allRequirementsMet) {
        // Unlock achievement
        const unlockedAchievement = { ...achievement, unlockedAt: new Date() };
        userStats.achievements.push(unlockedAchievement);

        // Apply rewards
        for (const reward of achievement.rewards) {
          switch (reward.type) {
            case 'points':
              this.addPoints(userId, reward.value as number);
              break;
            case 'multiplier':
              if (reward.description.includes('experience')) {
                userStats.multipliers.experience *= reward.value as number;
              } else if (reward.description.includes('points')) {
                userStats.multipliers.points *= reward.value as number;
              }
              break;
          }
        }

        // Emit achievement unlocked event
        this.emitEvent({
          type: 'achievement_unlocked',
          userId,
          data: { achievement: unlockedAchievement },
          timestamp: new Date(),
          points: achievement.points
        });
      }
    }
  }

  getLeaderboard(limit: number = 10): LeaderboardEntry[] {
    const entries: LeaderboardEntry[] = Array.from(this.userStats.values())
      .map(stats => ({
        userId: stats.userId,
        username: `User ${stats.userId.slice(-4)}`, // Placeholder
        score: stats.totalPoints,
        rank: 0,
        level: stats.level,
        achievements: stats.achievements.length
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    entries.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    return entries;
  }

  getUserStats(userId: string): UserStats | undefined {
    return this.userStats.get(userId);
  }

  getAllAchievements(): Achievement[] {
    return Array.from(this.achievements.values());
  }

  getUserAchievements(userId: string): Achievement[] {
    const userStats = this.userStats.get(userId);
    return userStats ? userStats.achievements : [];
  }

  addEventListener(eventType: string, listener: (event: GamificationEvent) => void): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType)!.push(listener);
  }

  removeEventListener(eventType: string, listener: (event: GamificationEvent) => void): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emitEvent(event: GamificationEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach(listener => listener(event));
    }
  }

  // Utility methods
  calculateLevel(experience: number): number {
    let level = 1;
    let expNeeded = 100;
    let totalExp = 0;

    while (totalExp + expNeeded <= experience) {
      totalExp += expNeeded;
      level++;
      expNeeded = Math.floor(expNeeded * 1.2);
    }

    return level;
  }

  getExperienceForLevel(level: number): number {
    let expNeeded = 100;
    let total = 0;

    for (let i = 1; i < level; i++) {
      total += expNeeded;
      expNeeded = Math.floor(expNeeded * 1.2);
    }

    return total;
  }
}

export const gamificationEngine = new GamificationEngine();
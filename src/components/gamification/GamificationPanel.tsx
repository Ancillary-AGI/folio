import React, { useState, useEffect } from 'react';
import { gamificationEngine, UserStats, Achievement, LeaderboardEntry } from '../../lib/gamification/gamificationEngine';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Trophy, Star, TrendingUp, Users, Target, Flame, Award, Zap } from 'lucide-react';

interface GamificationPanelProps {
  userId: string;
  onClose?: () => void;
}

export const GamificationPanel: React.FC<GamificationPanelProps> = ({ userId, onClose }) => {
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [allAchievements, setAllAchievements] = useState<Achievement[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [selectedTab, setSelectedTab] = useState('overview');

  useEffect(() => {
    // Load user stats
    const stats = gamificationEngine.getUserStats(userId) || gamificationEngine.getOrCreateUserStats(userId);
    setUserStats(stats);

    // Load achievements
    setAllAchievements(gamificationEngine.getAllAchievements());

    // Load leaderboard
    setLeaderboard(gamificationEngine.getLeaderboard());

    // Listen for gamification events
    const handleEvent = () => {
      const updatedStats = gamificationEngine.getUserStats(userId);
      if (updatedStats) {
        setUserStats(updatedStats);
      }
      setLeaderboard(gamificationEngine.getLeaderboard());
    };

    gamificationEngine.addEventListener('achievement_unlocked', handleEvent);
    gamificationEngine.addEventListener('level_up', handleEvent);

    return () => {
      gamificationEngine.removeEventListener('achievement_unlocked', handleEvent);
      gamificationEngine.removeEventListener('level_up', handleEvent);
    };
  }, [userId]);

  if (!userStats) {
    return (
      <Card className="w-full max-w-4xl mx-auto">
        <CardContent className="flex items-center justify-center py-8">
          <p className="text-muted-foreground">Loading gamification data...</p>
        </CardContent>
      </Card>
    );
  }

  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return 'bg-gray-500';
      case 'uncommon': return 'bg-green-500';
      case 'rare': return 'bg-blue-500';
      case 'epic': return 'bg-purple-500';
      case 'legendary': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'circuit': return '⚡';
      case 'simulation': return '🔬';
      case 'collaboration': return '🤝';
      case 'learning': return '📚';
      case 'creativity': return '💡';
      default: return '🏆';
    }
  };

  return (
    <Card className="w-full max-w-6xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="w-6 h-6 text-yellow-500" />
            Gamification Dashboard
          </div>
          {onClose && (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={selectedTab} onValueChange={setSelectedTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="achievements">Achievements</TabsTrigger>
            <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
            <TabsTrigger value="stats">Statistics</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Level and XP */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold">{userStats.level}</p>
                      <p className="text-xs text-muted-foreground">Level</p>
                    </div>
                    <Star className="w-8 h-8 text-yellow-500" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold">{userStats.totalPoints.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Total Points</p>
                    </div>
                    <Zap className="w-8 h-8 text-blue-500" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold">{userStats.streaks.current}</p>
                      <p className="text-xs text-muted-foreground">Day Streak</p>
                    </div>
                    <Flame className="w-8 h-8 text-orange-500" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* XP Progress */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Experience Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Level {userStats.level}</span>
                    <span>{userStats.experience} / {userStats.experience + userStats.experienceToNext} XP</span>
                  </div>
                  <Progress
                    value={(userStats.experience / (userStats.experience + userStats.experienceToNext)) * 100}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    {userStats.experienceToNext - userStats.experience} XP to next level
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Recent Achievements */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent Achievements</CardTitle>
              </CardHeader>
              <CardContent>
                {userStats.achievements.length === 0 ? (
                  <p className="text-muted-foreground">No achievements unlocked yet.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {userStats.achievements.slice(-4).reverse().map(achievement => (
                      <div key={achievement.id} className="flex items-center gap-3 p-3 border rounded">
                        <div className="text-2xl">{achievement.icon}</div>
                        <div className="flex-1">
                          <h4 className="font-medium">{achievement.name}</h4>
                          <p className="text-sm text-muted-foreground">{achievement.description}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge className={getRarityColor(achievement.rarity)}>
                              {achievement.rarity}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              +{achievement.points} points
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="achievements" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {allAchievements.map(achievement => {
                const isUnlocked = userStats.achievements.some(a => a.id === achievement.id);
                const progress = achievement.requirements[0]?.current || 0;
                const maxProgress = achievement.requirements[0]?.target || 1;

                return (
                  <Card key={achievement.id} className={`relative ${isUnlocked ? 'border-green-500' : ''}`}>
                    <CardContent className="pt-6">
                      <div className="flex items-start gap-3">
                        <div className="text-3xl">{achievement.icon}</div>
                        <div className="flex-1">
                          <h3 className="font-semibold">{achievement.name}</h3>
                          <p className="text-sm text-muted-foreground mb-2">{achievement.description}</p>

                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs">{getCategoryIcon(achievement.category)}</span>
                            <Badge className={getRarityColor(achievement.rarity)}>
                              {achievement.rarity}
                            </Badge>
                          </div>

                          {isUnlocked ? (
                            <Badge variant="default" className="bg-green-500">
                              <Award className="w-3 h-3 mr-1" />
                              Unlocked
                            </Badge>
                          ) : (
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs">
                                <span>Progress</span>
                                <span>{progress} / {maxProgress}</span>
                              </div>
                              <Progress value={(progress / maxProgress) * 100} className="h-2" />
                            </div>
                          )}

                          <p className="text-xs text-muted-foreground mt-2">
                            +{achievement.points} points
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="leaderboard" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Leaderboard
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {leaderboard.map(entry => (
                    <div
                      key={entry.userId}
                      className={`flex items-center justify-between p-3 rounded border ${
                        entry.userId === userId ? 'bg-blue-50 border-blue-200' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 font-semibold">
                          {entry.rank}
                        </div>
                        <div>
                          <p className="font-medium">{entry.username}</p>
                          <p className="text-sm text-muted-foreground">
                            Level {entry.level} • {entry.achievements} achievements
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{entry.score.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">points</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="stats" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Target className="w-5 h-5" />
                    Circuits Created
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{userStats.stats.circuitsCreated}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <TrendingUp className="w-5 h-5" />
                    Simulations Run
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{userStats.stats.simulationsRun}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Collaboration Sessions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{userStats.stats.collaborationSessions}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Star className="w-5 h-5" />
                    Tutorials Completed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{userStats.stats.tutorialsCompleted}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Flame className="w-5 h-5" />
                    Longest Streak
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{userStats.streaks.longest} days</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Zap className="w-5 h-5" />
                    Time Spent
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{Math.floor(userStats.stats.timeSpent / 60)}h {userStats.stats.timeSpent % 60}m</p>
                </CardContent>
              </Card>
            </div>

            {/* Multipliers */}
            <Card>
              <CardHeader>
                <CardTitle>Active Multipliers</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">
                      {userStats.multipliers.experience.toFixed(1)}x
                    </p>
                    <p className="text-sm text-muted-foreground">Experience Multiplier</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">
                      {userStats.multipliers.points.toFixed(1)}x
                    </p>
                    <p className="text-sm text-muted-foreground">Points Multiplier</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
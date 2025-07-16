import { IsIn } from 'class-validator';

// 3.4 Output DTO from DifficultyGraderService
export class GradingOutputDto {
  @IsIn(['easy', 'medium', 'hard'])
  difficultyRating: 'easy' | 'medium' | 'hard';
} 
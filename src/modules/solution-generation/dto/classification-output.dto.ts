import { IsNumber, IsOptional } from 'class-validator';

// 3.3 Output DTO from QuestionTaggerService
export class ClassificationOutputDto {
  @IsNumber()
  subject_id: number;

  @IsNumber()
  @IsOptional()
  topic_id: number | null;

  @IsNumber()
  @IsOptional()
  category_id: number | null;
} 
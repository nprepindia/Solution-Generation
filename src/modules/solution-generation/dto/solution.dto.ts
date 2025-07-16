import { IsNumber, IsString, IsArray, ValidateNested, IsOptional, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

class ReferenceDto {
  @IsString()
  book: string;

  @IsString()
  chapter: string;

  @IsNumber()
  page_number: number;

  @IsNumber()
  paragraph_number: number;
}

// 3.5 Final Response DTO.
// NOTE: The existing 'Solution' type must be updated to match this comprehensive structure.
export class Solution {
  @IsString()
  question: string;

  @IsArray()
  @IsString({ each: true })
  options: string[];

  @IsNumber()
  answer: number;

  @IsString()
  ans_description: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReferenceDto)
  references: {
    book: string;
    chapter: string;
    page_number: number;
    paragraph_number: number;
  }[];

  @IsNumber()
  subject_id: number;

  @IsNumber()
  @IsOptional()
  topic_id: number | null;

  @IsNumber()
  @IsOptional()
  category_id: number | null;

  @IsIn(['easy', 'medium', 'hard'])
  difficulty: 'easy' | 'medium' | 'hard';
  
  // Note: 'images' field is not included in the final response per the n8n 'Respond to Webhook' node.
} 
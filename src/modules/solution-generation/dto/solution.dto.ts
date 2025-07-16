import { IsNumber, IsString, IsArray, ValidateNested, IsOptional, IsIn, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

class ReferenceDto {
  @IsString()
  book: string;

  @IsString()
  chapter: string;

  @IsNumber()
  page_start: number;

  @IsNumber()
  page_end: number;
}

class VideoReferenceDto {
  @IsString()
  video_id: string;

  @IsString()
  time_start: string;

  @IsString()
  time_end: string;
}

class ImageDto {
  @IsBoolean()
  is_required: boolean;

  @IsString()
  image_description: string | null;
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
    page_start: number;
    page_end: number;
  }[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VideoReferenceDto)
  video_references: {
    video_id: string;
    time_start: string;
    time_end: string;
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
  
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images: {
    is_required: boolean;
    image_description: string | null;
  }[];
  // Note: 'images' field is not included in the final response per the n8n 'Respond to Webhook' node.
} 
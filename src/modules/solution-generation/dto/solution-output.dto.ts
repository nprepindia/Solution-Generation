import { IsNumber, IsString, IsArray, ValidateNested, IsBoolean, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

class ReferenceDto {
  @IsString()
  book_title: string;

  @IsString()
  book_id: string;

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

  @IsOptional()
  @IsString()
  image_description: string | null;
}

// 3.2 Output DTO from SolutionGeneratorService
export class SolutionOutputDto {
  @IsNumber()
  answer: number;

  @IsString()
  ans_description: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReferenceDto)
  references: {
    book_title: string;
    book_id: string;
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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images: {
    is_required: boolean;
    image_description: string | null;
  }[];
} 
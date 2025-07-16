import { IsString, IsArray, ArrayNotEmpty, IsOptional } from 'class-validator';

// Interface for image data that will be passed to Gemini
export interface ExtractedImage {
  mimeType: string;
  data: string; // base64 encoded image data
  originalUrl: string;
  altText?: string;
}

// 3.1 Input DTO for the main service (to align with the existing method)
export class ServicableQuestion {
  @IsString()
  question: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  options: string[];

  @IsOptional()
  @IsArray()
  images?: ExtractedImage[]; // Extracted images from markdown
} 
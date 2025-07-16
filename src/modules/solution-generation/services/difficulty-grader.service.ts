import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage } from '@langchain/core/messages';
import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { ServicableQuestion, GradingOutputDto, ExtractedImage } from '../dto';
import { LLMGenerationError } from '../../../common/exceptions';
import { GOOGLE_API_KEY } from '../config/service.config';

// Extended interface for questions with images
interface ServicableQuestionWithImages extends ServicableQuestion {
  images?: ExtractedImage[];
}

@Injectable()
export class DifficultyGraderService {
  private readonly logger = new Logger(DifficultyGraderService.name);
  private readonly llm: ChatGoogleGenerativeAI;

  constructor(private readonly configService: ConfigService) {
    // Initialize Gemini AI with LangChain
    if (!GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY is required');
    }

        this.llm = new ChatGoogleGenerativeAI({
      apiKey: GOOGLE_API_KEY,
      model: 'gemini-2.5-pro-preview-06-05', // Use stable model instead of preview
      temperature: 0,
      maxOutputTokens: 4096, // Reduced to prevent token exhaustion
      maxRetries: 3,
    });

    this.logger.log('DifficultyGraderService initialized with LangChain');
  }

  /**
   * Grades the difficulty level of a question
   * @param question - The question data containing question text, options, and optional images
   * @param solutionDescription - The solution description for the question
   * @returns Promise<GradingOutputDto> - Difficulty rating (easy, medium, hard)
   */
  async gradeQuestion(question: ServicableQuestionWithImages, solutionDescription: string): Promise<GradingOutputDto> {
    try {
      this.logger.log(`Grading difficulty for question: ${question.question.substring(0, 100)}...`);
      
      // Construct the user prompt following the provided template
      const textPrompt = `Question: ${question.question}

Options: ${question.options.join('\n')}

Solution: ${solutionDescription}`;

      let result;

      // Handle multimodal content (with images) vs text-only content
      if (question.images && question.images.length > 0) {
        this.logger.log(`Processing question with ${question.images.length} images using multimodal grading`);
        result = await this.generateWithImages(textPrompt, question.images);
      } else {
        this.logger.log('Processing text-only question using standard grading');
        result = await this.generateWithLangChain(textPrompt);
      }
      
      // Validate and transform the result
      const validatedResult = await this.validateAndTransformResponse(result);
      
      this.logger.log(`Difficulty graded successfully: ${validatedResult.difficultyRating}`);
      return validatedResult;
    } catch (error) {
      this.logger.error(`Failed to grade question difficulty: ${error.message}`, error.stack);
      throw new LLMGenerationError(`Failed to grade question difficulty: ${error.message}`);
    }
  }

  /**
   * Generate difficulty rating with multimodal content (text + images)
   * Uses direct model call with images
   */
  private async generateWithImages(textPrompt: string, images: ExtractedImage[]): Promise<any> {
    try {
      this.logger.log(`Generating difficulty rating with ${images.length} images`);

      // Build content array for multimodal input following LangChain format
      const contentParts: any[] = [];
      
      // System prompt with instructions
      const systemPrompt = `You are an expert Question Difficulty Grader. Your job is to look at given Question with solution and provide a difficulty rating of 'easy', 'medium', or 'hard'.

Guidelines for grading:

- If the question involves a direct recall of a fact from knowledge, mark it as easy.
- If the question requires student to do 1 level of inference to arrive at the answer, mark it as medium.
- If the question requires anything more than the above, mark it as hard.

Note: For image-based questions, consider the visual complexity and reasoning required to interpret the images.

You must respond with a valid JSON object in this exact format:
{
  "difficultyRating": "easy" | "medium" | "hard"
}`;

      // Add the combined system prompt and question text first
      const fullPrompt = `${systemPrompt}

${textPrompt}`;

      contentParts.push({
        type: "text",
        text: fullPrompt
      });
      
      // Add images using correct LangChain format for Google Gemini
      for (const image of images) {
        contentParts.push({
          type: "image_url",
          image_url: {
            url: `data:${image.mimeType};base64,${image.data}`
          }
        });
      }

      // Call the model using proper LangChain HumanMessage format
      const response = await this.llm.invoke([
        new HumanMessage({
          content: contentParts
        })
      ]);
      const responseText = response.content as string;
      
      this.logger.log('Multimodal difficulty grading response:', responseText.substring(0, 200) + '...');

      try {
        // Try to extract JSON from the response text
        let jsonString = responseText.trim();
        
        // Look for JSON object boundaries
        const jsonStart = jsonString.indexOf('{');
        const jsonEnd = jsonString.lastIndexOf('}');
        
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          jsonString = jsonString.substring(jsonStart, jsonEnd + 1);
        }

        return JSON.parse(jsonString);
      } catch (parseError) {
        this.logger.error('Failed to parse multimodal response as JSON:', responseText);
        throw new Error('Invalid JSON response from multimodal grading');
      }

    } catch (error) {
      this.logger.error(`Multimodal difficulty grading failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Generate difficulty rating using LangChain with structured output
   */
  private async generateWithLangChain(userPrompt: string): Promise<any> {
    try {
      // Construct the complete prompt with system instructions
      const systemPrompt = `You are an expert Question Difficulty Grader. Your job is to look at given Question with solution and provide a difficulty rating of 'easy', 'medium', or 'hard'.

Guidelines for grading:

- If the question involves a direct recall of a fact from knowledge, mark it as easy.
- If the question requires student to do 1 level of inference to arrive at the answer, mark it as medium.
- If the question requires anything more than the above, mark it as hard.

You must respond with a valid JSON object in this exact format:
{
  "difficultyRating": "easy" | "medium" | "hard"
}`;

      // Use LangChain's invoke method with structured output
      const response = await this.llm.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      // Log context size for debugging
      const contextTokens = this.estimateTokenCount(systemPrompt + userPrompt);
      this.logger.log(`Estimated context size: ${contextTokens} tokens`);

      const responseText = response.content as string;
      this.logger.log('LangChain difficulty grading response:', responseText.substring(0, 200) + '...');

      try {
        // Try to extract JSON from the response text
        let jsonString = responseText.trim();
        
        // Look for JSON object boundaries
        const jsonStart = jsonString.indexOf('{');
        const jsonEnd = jsonString.lastIndexOf('}');
        
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          jsonString = jsonString.substring(jsonStart, jsonEnd + 1);
        }

        return JSON.parse(jsonString);
      } catch (parseError) {
        this.logger.error('Failed to parse LangChain response as JSON:', responseText);
        throw new Error('Invalid JSON response from LangChain');
      }

    } catch (error) {
      this.logger.error(`LangChain difficulty grading failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Validate and transform the LangChain response to GradingOutputDto
   */
  private async validateAndTransformResponse(response: any): Promise<GradingOutputDto> {
    try {
      // Transform to DTO class instance
      const gradingOutput = plainToClass(GradingOutputDto, response);
      
      // Validate using class-validator
      const errors = await validate(gradingOutput);
      
      if (errors.length > 0) {
        const errorMessages = errors.map(error => 
          Object.values(error.constraints || {}).join(', ')
        ).join('; ');
        throw new Error(`Validation failed: ${errorMessages}`);
      }
      
      return gradingOutput;
    } catch (error) {
      this.logger.error(`Response validation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Estimate token count for context size monitoring
   */
  private estimateTokenCount(text: string): number {
    // Rough estimation: 1 token per 4 characters
    return Math.ceil(text.length / 4);
  }
} 
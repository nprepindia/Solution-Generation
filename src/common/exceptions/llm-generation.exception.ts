import { HttpException, HttpStatus } from '@nestjs/common';

export class LLMGenerationError extends HttpException {
  constructor(
    message: string = 'Failed to generate content using LLM',
    cause?: Error,
    context?: Record<string, any>,
  ) {
    const errorResponse = {
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error: 'LLM Generation Failed',
      message,
      context,
      timestamp: new Date().toISOString(),
    };

    super(errorResponse, HttpStatus.SERVICE_UNAVAILABLE, {
      cause,
      description: 'LLM service is temporarily unavailable or failed to generate content',
    });
  }
} 
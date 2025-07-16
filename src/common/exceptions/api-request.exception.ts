import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiRequestError extends HttpException {
  constructor(
    message: string = 'External API request failed',
    statusCode: HttpStatus = HttpStatus.BAD_GATEWAY,
    cause?: Error,
    context?: Record<string, any>,
  ) {
    const errorResponse = {
      statusCode,
      error: 'API Request Failed',
      message,
      context,
      timestamp: new Date().toISOString(),
    };

    super(errorResponse, statusCode, {
      cause,
      description: 'Failed to communicate with external API service',
    });
  }
} 
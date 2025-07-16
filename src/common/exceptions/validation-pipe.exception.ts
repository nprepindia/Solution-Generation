import { HttpException, HttpStatus } from '@nestjs/common';

export class ValidationPipeError extends HttpException {
  constructor(
    message: string = 'Validation failed',
    validationErrors?: any[],
    cause?: Error,
  ) {
    const errorResponse = {
      statusCode: HttpStatus.BAD_REQUEST,
      error: 'Validation Failed',
      message,
      validationErrors,
      timestamp: new Date().toISOString(),
    };

    super(errorResponse, HttpStatus.BAD_REQUEST, {
      cause,
      description: 'Request validation failed due to invalid input data',
    });
  }
} 
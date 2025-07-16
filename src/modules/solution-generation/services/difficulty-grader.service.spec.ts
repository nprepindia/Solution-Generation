import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DifficultyGraderService } from './difficulty-grader.service';
import { GradingOutputDto } from '../dto';
import { ServicableQuestion } from '../dto';
import { LLMGenerationError } from '../../../common/exceptions';

// Mock Gemini AI
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn(),
  })),
  SchemaType: {
    STRING: 'string',
  },
}));

describe('DifficultyGraderService', () => {
  let service: DifficultyGraderService;
  let mockModel: any;
  let mockGeminiAI: any;

  beforeEach(async () => {
    // Create mock generateContent method
    const mockGenerateContent = jest.fn();
    
    // Create mock model
    mockModel = {
      generateContent: mockGenerateContent,
    };

    // Create mock Gemini AI instance
    mockGeminiAI = {
      getGenerativeModel: jest.fn().mockReturnValue(mockModel),
    };

    // Mock the GoogleGenerativeAI constructor
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    GoogleGenerativeAI.mockImplementation(() => mockGeminiAI);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DifficultyGraderService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-api-key'),
          },
        },
      ],
    }).compile();

    service = module.get<DifficultyGraderService>(DifficultyGraderService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('gradeQuestion', () => {
    const mockQuestion: ServicableQuestion = {
      question: 'What is the normal heart rate for an adult?',
      options: [
        '50-70 bpm',
        '60-100 bpm',
        '80-120 bpm',
        '100-140 bpm',
      ],
    };

    const mockSolutionDescription = 'The normal heart rate for adults is 60-100 beats per minute at rest. This is established through medical research and is a basic vital sign measurement.';

    it('should construct proper prompt with question, options, and solution', async () => {
      // Mock successful response
      const mockResponse = {
        response: {
          text: jest.fn().mockReturnValue(JSON.stringify({
            difficultyRating: 'medium',
          })),
        },
      };

      mockModel.generateContent.mockResolvedValue(mockResponse);

      await service.gradeQuestion(mockQuestion, mockSolutionDescription);

      // Verify the model was called with the correct content structure (multimodal format)
      expect(mockModel.generateContent).toHaveBeenCalledWith({
        contents: [
          {
            parts: [
              {
                text: expect.stringContaining('You are an expert Question Difficulty Grader'),
              },
            ],
            role: 'user',
          },
        ],
      });

      const callArgs = mockModel.generateContent.mock.calls[0][0];
      const userMessage = callArgs.contents[0].parts[0].text;
      
      expect(userMessage).toContain('What is the normal heart rate for an adult?');
      expect(userMessage).toContain('50-70 bpm');
      expect(userMessage).toContain('60-100 bpm');
      expect(userMessage).toContain('80-120 bpm');
      expect(userMessage).toContain('100-140 bpm');
      expect(userMessage).toContain(mockSolutionDescription);
    });

    it('should include images in the request when provided', async () => {
      const questionWithImages: ServicableQuestion = {
        ...mockQuestion,
        images: [
          {
            mimeType: 'image/png',
            data: 'base64encodeddata',
            originalUrl: 'https://example.com/image.png',
            altText: 'Heart rate diagram',
          },
        ],
      };

      const mockResponse = {
        response: {
          text: jest.fn().mockReturnValue(JSON.stringify({
            difficultyRating: 'hard',
          })),
        },
      };

      mockModel.generateContent.mockResolvedValue(mockResponse);

      await service.gradeQuestion(questionWithImages, mockSolutionDescription);

      const callArgs = mockModel.generateContent.mock.calls[0][0];
      const contentParts = callArgs.contents[0].parts;
      
      // Should have text part + image part
      expect(contentParts).toHaveLength(2);
      expect(contentParts[0].text).toContain('You are an expert Question Difficulty Grader');
      expect(contentParts[1].inlineData).toEqual({
        mimeType: 'image/png',
        data: 'base64encodeddata',
      });
    });

    it('should return valid GradingOutputDto', async () => {
      const mockResponse = {
        response: {
          text: jest.fn().mockReturnValue(JSON.stringify({
            difficultyRating: 'medium',
          })),
        },
      };

      mockModel.generateContent.mockResolvedValue(mockResponse);

      const result = await service.gradeQuestion(mockQuestion, mockSolutionDescription);

      expect(result.difficultyRating).toBe('medium');
    });

    it('should handle different difficulty ratings', async () => {
      const testCases = ['easy', 'medium', 'hard'];

      for (const difficulty of testCases) {
        const mockResponse = {
          response: {
            text: jest.fn().mockReturnValue(JSON.stringify({
              difficultyRating: difficulty,
            })),
          },
        };

        mockModel.generateContent.mockResolvedValue(mockResponse);

        const result = await service.gradeQuestion(mockQuestion, mockSolutionDescription);
        expect(result.difficultyRating).toBe(difficulty);

        jest.clearAllMocks();
      }
    });

    it('should handle validation errors for invalid response', async () => {
      const mockResponse = {
        response: {
          text: jest.fn().mockReturnValue(JSON.stringify({
            difficultyRating: 'invalid-rating',
          })),
        },
      };

      mockModel.generateContent.mockResolvedValue(mockResponse);

      await expect(service.gradeQuestion(mockQuestion, mockSolutionDescription))
        .rejects.toThrow();
    });

    it('should handle Gemini API errors', async () => {
      const error = new Error('Gemini API error');
      mockModel.generateContent.mockRejectedValue(error);

      await expect(service.gradeQuestion(mockQuestion, mockSolutionDescription))
        .rejects.toThrow('Gemini API error');
    });

    it('should handle invalid JSON response', async () => {
      const mockResponse = {
        response: {
          text: jest.fn().mockReturnValue('invalid json'),
        },
      };

      mockModel.generateContent.mockResolvedValue(mockResponse);

      await expect(service.gradeQuestion(mockQuestion, mockSolutionDescription))
        .rejects.toThrow();
    });
  });
}); 